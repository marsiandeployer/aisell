#!/usr/bin/env tsx
/**
 * Web chat UI for running the bot without Telegram.
 *
 * Requirements:
 * - Email auth (SMTP) with name + email only
 * - Telegram-like dialog UI
 * - Works for both RU and EN bot instances (run as separate PM2 apps with different env)
 */

import express from 'express';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import type { Context } from 'telegraf';
import { NoxonBot, loadConfig, loadChatSettings, saveChatSettings } from './bot';
import { createBountyRouter } from './bounty-api';

type WebUser = {
  userId: number; // Used as chatId in embedded bot engine.
  email: string;
  name: string;
  nickname: string;
  createdAt: string;
};

type WebSession = {
  sessionId: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
  // CHANGE: Added oauthNonce for CSRF protection in OAuth callback (Task 9 writes it, Task 6 reads it)
  oauthNonce?: string;
};

type WebMessageRole = 'user' | 'assistant' | 'system';

type WebMessageFeedbackType = 'thumbs_up' | 'thumbs_down';

type WebMessageFeedback = {
  type: WebMessageFeedbackType;
  at: string;
  comment?: string;
};

type WebMessage = {
  id: number;
  role: WebMessageRole;
  text: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  feedback?: WebMessageFeedback | null;
  extra?: unknown;
};

type SseClient = {
  userId: number;
  ip: string;
  res: express.Response;
};

const WEBCHAT_DATA_DIR = path.join(__dirname, '..', 'data', 'webchat');
const WEBCHAT_CHATS_DIR = path.join(WEBCHAT_DATA_DIR, 'chats');
const USERS_PATH = path.join(WEBCHAT_DATA_DIR, 'users.json');
const SESSIONS_PATH = path.join(WEBCHAT_DATA_DIR, 'sessions.json');
const STATE_PATH = path.join(WEBCHAT_DATA_DIR, 'state.json');
const INVITES_PATH = path.join(WEBCHAT_DATA_DIR, 'invites.json');
const EXTENSION_ROOT_DIR = path.join(__dirname, '..', '..', 'extensions', 'webchat-sidebar');
const EXTENSION_PREVIEWS_DIR = path.join(EXTENSION_ROOT_DIR, 'previews', 'cases');
const EXTENSION_PANEL_SHARED_JS_PATH = path.join(EXTENSION_ROOT_DIR, 'src', 'panel_shared.js');
const PRODUCTS_DIR = path.join(__dirname, '..', '..', 'products');

// CHANGE: Unified workspace directory for users and groups
// WHY: Keep all project data within /root/aisell/ (not scattered across server)
// REF: User request "Все skills и данные собраны в подпапках ~/aisell"
const WORKSPACES_ROOT = '/root/aisell/botplatform/group_data';

// Noxonbot admin history file (used by existing admin UIs).
const GLOBAL_MESSAGE_HISTORY_PATH = path.join(__dirname, '..', 'data', 'history', 'message_history.json');

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}


function parseIsoMs(iso: string | undefined): number {
  if (!iso) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function normalizeEmail(emailRaw: string): string {
  return emailRaw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  // Pragmatic check: good enough for login flow, not RFC-perfect.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized;
}

function buildNickname(name: string, email: string, used: Set<string>): string {
  const localPart = email.split('@')[0] || '';
  const base = slugify(name) || slugify(localPart) || 'user';
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

type WebchatState = {
  nextUserId: number;
};

function loadOrInitState(): WebchatState {
  const baseRaw = process.env.WEBCHAT_USER_ID_BASE || '9000000000000';
  const base = Number(baseRaw);
  const fallbackBase = Number.isSafeInteger(base) ? base : 9000000000000;

  const existing = readJsonFile<WebchatState | null>(STATE_PATH, null);
  if (existing && Number.isSafeInteger(existing.nextUserId) && existing.nextUserId >= fallbackBase) {
    return existing;
  }
  const initial: WebchatState = { nextUserId: fallbackBase };
  writeJsonAtomic(STATE_PATH, initial);
  return initial;
}

function allocateUserId(): number {
  const state = loadOrInitState();
  const id = state.nextUserId;
  state.nextUserId += 1;
  writeJsonAtomic(STATE_PATH, state);
  return id;
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  const result: Record<string, string> = {};
  const parts = header.split(';');
  for (const part of parts) {
    const [keyRaw, ...rest] = part.trim().split('=');
    if (!keyRaw) continue;
    const key = keyRaw.trim();
    const value = rest.join('=').trim();
    if (!key) continue;
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

type InviteRecord = {
  dashboardUserId: string;
  token: string;
};

type MagicLinkEntry = {
  userId: string;
  expires: number;
  dashboardJwt?: string;
};

type RateLimitCheck = { ok: true } | { ok: false; retryAfterMs: number };

type RateLimitEntry = {
  hits: number[];
  lastSeenMs: number;
};

class SlidingWindowRateLimiter {
  public readonly name: string;
  public readonly windowMs: number;
  public readonly max: number;
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(name: string, windowMs: number, max: number) {
    this.name = name;
    this.windowMs = Math.max(1, Math.floor(windowMs));
    this.max = Math.max(1, Math.floor(max));
  }

  private prune(entry: RateLimitEntry, nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    // Small arrays: shift() is fine here.
    while (entry.hits.length > 0 && entry.hits[0] <= cutoff) {
      entry.hits.shift();
    }
  }

  check(key: string, nowMs: number): RateLimitCheck {
    const entry = this.entries.get(key);
    if (!entry) return { ok: true };
    this.prune(entry, nowMs);

    if (entry.hits.length === 0 && nowMs - entry.lastSeenMs > this.windowMs) {
      this.entries.delete(key);
      return { ok: true };
    }

    if (entry.hits.length >= this.max) {
      const oldest = entry.hits[0] ?? nowMs;
      const retryAfterMs = Math.max(0, oldest + this.windowMs - nowMs);
      return { ok: false, retryAfterMs };
    }
    return { ok: true };
  }

  consume(key: string, nowMs: number): void {
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { hits: [nowMs], lastSeenMs: nowMs });
      return;
    }
    this.prune(entry, nowMs);
    entry.hits.push(nowMs);
    entry.lastSeenMs = nowMs;
  }

  sweep(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.lastSeenMs > this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

type RateLimitProbe = {
  limiter: SlidingWindowRateLimiter;
  key: string;
};

function normalizeIp(ipRaw: string): string {
  const ip = String(ipRaw || '').trim();
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

// SSRF protection: check if IP is in a private/reserved range
function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  // IPv6 loopback and private ranges
  if (normalized === '::1') return true;
  if (/^fc[0-9a-f]{2}:/i.test(normalized)) return true; // fc00::/7
  if (/^fd[0-9a-f]{2}:/i.test(normalized)) return true; // fc00::/7 (fd)

  // Check IPv4 private ranges
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;

  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // 127.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local
  if (a === 0) return true;                           // 0.0.0.0/8

  return false;
}

// SSRF protection: validate URL before proxying
async function validateFetchUrl(rawUrl: string): Promise<{ ok: false; reason: string } | { ok: true; url: URL }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only HTTPS URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block reserved hostnames
  if (hostname === 'localhost') return { ok: false, reason: 'URL not allowed' };
  if (hostname.endsWith('.local')) return { ok: false, reason: 'URL not allowed' };
  if (hostname.endsWith('.internal')) return { ok: false, reason: 'URL not allowed' };
  if (hostname.endsWith('.lan')) return { ok: false, reason: 'URL not allowed' };

  // DNS resolution + IP check (DNS rebinding protection)
  let resolvedAddress: string;
  try {
    const result = await dns.promises.lookup(hostname, { all: false });
    resolvedAddress = result.address;
  } catch {
    return { ok: false, reason: 'DNS resolution failed' };
  }

  if (isPrivateIp(resolvedAddress)) {
    return { ok: false, reason: 'URL not allowed' };
  }

  return { ok: true, url: parsed };
}

function getClientIp(req: express.Request): string {
  const fromExpress = normalizeIp(req.ip || '');
  if (fromExpress) return fromExpress;
  const fromSocket = normalizeIp(String(req.socket?.remoteAddress || ''));
  return fromSocket || 'unknown';
}

// CHANGE: Add localhost detection for X-Forwarded-For aware check
// WHY: User request "если мы заходим с локалхоста то не спрашивать емейл и пропускать онбоардинг"
// REF: User message 2026-02-17
function isLocalhost(req: express.Request): boolean {
  const ip = getClientIp(req);
  const localhostIps = ['127.0.0.1', '::1', 'localhost'];
  return localhostIps.includes(ip);
}

function isRateLimitEnabled(): boolean {
  const raw = String(process.env.WEBCHAT_RATE_LIMIT || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(raw);
}

function sendRateLimitError(res: express.Response, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: 'Rate limit exceeded', retryAfterSeconds });
}

function enforceRateLimit(req: express.Request, res: express.Response, probes: RateLimitProbe[]): boolean {
  if (!isRateLimitEnabled()) return true;

  const nowMs = Date.now();
  let worst: { retryAfterMs: number; name: string } | null = null;
  for (const probe of probes) {
    const check = probe.limiter.check(probe.key, nowMs);
    if (check.ok) continue;
    if (!worst || check.retryAfterMs > worst.retryAfterMs) {
      worst = { retryAfterMs: check.retryAfterMs, name: probe.limiter.name };
    }
  }

  if (worst) {
    const userId = (req as unknown as { webUser?: WebUser }).webUser?.userId;
    console.warn(
      `⚠️ Rate limit: path=${req.path} ip=${getClientIp(req)} userId=${typeof userId === 'number' ? userId : 'n/a'} rule=${worst.name} retryAfterMs=${worst.retryAfterMs}`
    );
    sendRateLimitError(res, worst.retryAfterMs);
    return false;
  }

  for (const probe of probes) {
    probe.limiter.consume(probe.key, nowMs);
  }
  return true;
}

function getWebchatTitle(): string {
  return process.env.WEBCHAT_TITLE || 'Web Chat';
}

function getWebchatSubtitle(): string {
  return process.env.WEBCHAT_SUBTITLE || 'Run the bot without Telegram';
}

function getWebchatInitMessage(lang: string, isDefault: boolean): string {
  // If WEBCHAT_INIT_MESSAGE is set, use it (check for RU variant too)
  if (process.env.WEBCHAT_INIT_MESSAGE) {
    if (lang === 'ru' && process.env.WEBCHAT_INIT_MESSAGE_RU) {
      return process.env.WEBCHAT_INIT_MESSAGE_RU;
    }
    return process.env.WEBCHAT_INIT_MESSAGE;
  }

  // Otherwise, use default messages based on language
  if (isDefault) {
    return lang === 'ru'
      ? '👋 Привет! Я помогу вам создать AI-бота или веб-приложение.\n\n💡 Расскажите простыми словами, что вы хотите сделать.\n\n🌐 Важно: бесплатный домен (wpmix.net) в России может открываться только через VPN (из-за замедления трафика).'
      : '👋 Hello! I will help you create an AI bot or web application.\n\n💡 Tell me in simple words what you want to build.';
  }
  return '';
}

function isSimpleDashboardProduct(): boolean {
  const productType = String(process.env.PRODUCT_TYPE || '').trim().toLowerCase();
  if (productType === 'simple_dashboard') return true;
  const title = String(process.env.WEBCHAT_TITLE || '').trim().toLowerCase();
  return title.includes('simpledashboard');
}

function getProductSkillMdPath(): string {
  const productType = String(process.env.PRODUCT_TYPE || '').trim().toLowerCase();
  if (!productType) return '';
  return path.join(__dirname, `../../products/${productType}/SKILL.md`);
}

// Write a lightweight CLAUDE.md into the user workspace that references the product SKILL.md.
// WHY: SKILL.md is a standalone skill for independent deployments. CLAUDE.md in the workspace
// should be minimal — just user-specific data + path to SKILL.md. No duplication of 26KB content.
// CHANGE: Use CLAUDE.md.workspace template instead of copying full SKILL.md.
// Called once when the workspace folder is first created by webchat auth handlers.
function maybeWriteWorkspaceClaude(userFolder: string, userId: number): void {
  const claudePath = path.join(userFolder, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) return;
  const productType = String(process.env.PRODUCT_TYPE || '').trim().toLowerCase();
  if (!productType) return;
  // Prefer CLAUDE.md.workspace template; fall back to SKILL.md for products without one.
  const workspaceTemplatePath = path.join(__dirname, `../../products/${productType}/CLAUDE.md.workspace`);
  const skillMdPath = path.join(__dirname, `../../products/${productType}/SKILL.md`);
  const templatePath = fs.existsSync(workspaceTemplatePath) ? workspaceTemplatePath : (fs.existsSync(skillMdPath) ? skillMdPath : '');
  if (!templatePath) return;
  try {
    let content = fs.readFileSync(templatePath, 'utf8');
    content = content.replace(/\{USERID\}/g, String(userId));
    fs.writeFileSync(claudePath, content, { encoding: 'utf8', mode: 0o600 });
    console.log(`✅ [webchat] Wrote CLAUDE.md for userId=${userId} (from ${path.basename(templatePath)})`);
  } catch (err) {
    console.warn(`⚠️ [webchat] Failed to write CLAUDE.md for userId=${userId}:`, err);
  }
}

function normalizeExtensionId(rawValue: string): string {
  const value = String(rawValue || '').trim().toLowerCase();
  return /^[a-z]{32}$/.test(value) ? value : '';
}

function extractSimpleDashboardExampleSlugFromStartParam(rawStartParam: string): string {
  const value = String(rawStartParam || '').trim().toLowerCase();
  if (!value) return '';
  const prefixes = ['ex_', 'example_', 'sd_', 'showcase_', 'demo_'];
  for (const prefix of prefixes) {
    if (!value.startsWith(prefix)) continue;
    const slug = value.slice(prefix.length).replace(/[^a-z0-9_-]/g, '');
    return slug.slice(0, 64);
  }
  return '';
}

function toTitleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildSimpleDashboardShowcasesUrl(baseUrl: string, extId: string, startParam: string): string {
  try {
    const normalizedBase = new URL(baseUrl);
    if (normalizedBase.protocol === 'http:') {
      const host = String(normalizedBase.hostname || '').toLowerCase();
      const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      if (!isLocalhost) normalizedBase.protocol = 'https:';
    }
    const url = new URL('/showcases/', normalizedBase.toString());
    if (extId) url.searchParams.set('ext_id', extId);
    if (startParam) url.searchParams.set('start', startParam);
    return url.toString();
  } catch (_e) {
    return '/showcases/';
  }
}

function appendShowcasesLinkToMessage(text: string, lang: string, showcasesUrl: string): string {
  if (!showcasesUrl) return text;
  if (text.includes('/showcases')) return text;
  return lang === 'ru'
    ? `${text}\n\n📚 Примеры и промпты: ${showcasesUrl}`
    : `${text}\n\n📚 Examples and prompts: ${showcasesUrl}`;
}

function buildSimpleDashboardExampleStartMessage(lang: string, exampleSlug: string, showcasesUrl: string): string {
  const exampleLabel = toTitleCaseFromSlug(exampleSlug) || exampleSlug;
  if (lang === 'ru') {
    return [
      `👋 Вы открыли пример: ${exampleLabel}.`,
      `ID примера: ${exampleSlug}`,
      '',
      'Опишите, что хотите повторить или изменить, и я соберу дашборд под ваш кейс.',
      `📚 Примеры и промпты: ${showcasesUrl}`,
    ].join('\n');
  }

  return [
    `👋 You opened example: ${exampleLabel}.`,
    `Example ID: ${exampleSlug}`,
    '',
    'Tell me what you want to keep or change, and I will build your dashboard.',
    `📚 Examples and prompts: ${showcasesUrl}`,
  ].join('\n');
}

function getWebchatExtensionName(): string {
  return process.env.WEBCHAT_EXTENSION_NAME || 'Codebox - Claude/Codex AI agent in your sidebar';
}

function getWebchatExtensionDescription(): string {
  // Keep it short: Chrome Web Store has strict limits on the manifest description.
  return process.env.WEBCHAT_EXTENSION_DESCRIPTION || 'AI coding agent (Claude/Codex) in your Chrome side panel.';
}

function getWebchatPort(): number {
  const raw = process.env.WEBCHAT_PORT || '8091';
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8091;
}

function getSessionTtlHours(): number {
  const raw = process.env.WEBCHAT_SESSION_TTL_HOURS || '168';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 1 ? Math.floor(parsed) : 168;
}

function readUsers(): WebUser[] {
  const users = readJsonFile<unknown>(USERS_PATH, []);
  return Array.isArray(users) ? (users as WebUser[]) : [];
}

function writeUsers(users: WebUser[]): void {
  writeJsonAtomic(USERS_PATH, users);
}

function readSessions(): WebSession[] {
  const sessions = readJsonFile<unknown>(SESSIONS_PATH, []);
  return Array.isArray(sessions) ? (sessions as WebSession[]) : [];
}

function writeSessions(sessions: WebSession[]): void {
  writeJsonAtomic(SESSIONS_PATH, sessions);
}

function readInvites(): InviteRecord[] {
  const records = readJsonFile<unknown>(INVITES_PATH, []);
  return Array.isArray(records) ? (records as InviteRecord[]) : [];
}

function writeInvites(records: InviteRecord[]): void {
  writeJsonAtomic(INVITES_PATH, records);
}

async function signChallenge(privateKey: string, dashboardId: string): Promise<{ challenge: string; signature: string }> {
  const challenge = JSON.stringify({ dashboardId, timestamp: Date.now(), nonce: crypto.randomBytes(16).toString('hex') });
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signMessage(challenge);
  return { challenge, signature };
}

/**
 * Returns the client-side Auth SDK JS code.
 * Served at GET /sdk/auth.js on simpledashboard.wpmix.net.
 * Dashboards include: <script src="https://simpledashboard.wpmix.net/sdk/auth.js"></script>
 */
function getAuthSdkJs(): string {
  return `(function(){
  "use strict";
  // --- SimpleDashboard Auth SDK ---

  var dashboardId = (function(){
    var m = location.hostname.match(/^(d\\d+)\\./);
    return m ? m[1] : null;
  })();
  if (!dashboardId) { console.warn('[SD] Not a dashboard host'); return; }

  var AUTH_API = 'https://simpledashboard.wpmix.net';
  var JWT_KEY = 'dashboard_jwt';

  function getJwt() { try { return sessionStorage.getItem(JWT_KEY); } catch(e) { return null; } }
  function setJwt(t) { try { sessionStorage.setItem(JWT_KEY, t); } catch(e) {} }
  function removeJwt() { try { sessionStorage.removeItem(JWT_KEY); } catch(e) {} }

  function parseJwt(t) {
    if (!t) return null;
    try { return JSON.parse(atob(t.split('.')[1])); } catch(e) { return null; }
  }

  function isExpired(payload) {
    if (!payload || !payload.exp) return true;
    return Date.now() / 1000 > payload.exp - 30;
  }

  function authHeaders() {
    var t = getJwt();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  // --- Overlay ---
  function createOverlay() {
    if (document.getElementById('sd-auth-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'sd-auth-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:10000;display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center;';
    ov.innerHTML = '<div style="text-align:center;max-width:400px;position:relative;z-index:2;background:rgba(255,255,255,0.07);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:40px 32px;box-shadow:0 8px 40px rgba(0,0,0,0.35);">'
      + '<div id="sd-ov-auth" style="display:none;"><p style="font-size:18px;margin-bottom:16px;color:#f1f5f9;">Sign in to access this dashboard</p>'
      + '<button id="sd-google-btn" style="display:inline-block;padding:12px 24px;background:#4285F4;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;">Sign in with Google</button></div>'
      + '<div id="sd-ov-denied" style="display:none;"><p style="font-size:18px;color:#f1f5f9;">Access denied. You do not have permission to view this dashboard.</p></div>'
      + '<div id="sd-ov-error" style="display:none;"><p style="font-size:18px;color:#f1f5f9;">Authentication service is temporarily unavailable. Please try again later.</p></div>'
      + '<div id="sd-ov-loading" style="display:none;"><p style="font-size:16px;color:#94a3b8;">Checking authentication...</p></div>'
      + '</div>';
    document.body.appendChild(ov);

    // Try to load login-bg.jpg from dashboard domain
    var img = new Image();
    img.onload = function() {
      ov.style.backgroundImage = 'url(login-bg.jpg)';
    };
    img.src = 'login-bg.jpg';
  }

  function showPanel(name) {
    createOverlay();
    var ov = document.getElementById('sd-auth-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    ['sd-ov-auth','sd-ov-denied','sd-ov-error','sd-ov-loading'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var target = document.getElementById('sd-ov-' + name);
    if (target) target.style.display = 'block';
  }

  function hideOverlay() {
    var ov = document.getElementById('sd-auth-overlay');
    if (ov) ov.style.display = 'none';
  }

  // --- Magic Link handling ---
  function handleMagicLink() {
    var params = new URLSearchParams(location.search);
    var ml = params.get('ml');
    if (!ml) return false;
    fetch('/api/auth/ml?token=' + encodeURIComponent(ml))
      .then(function(r) { return r.ok ? r.json() : Promise.reject('ml_failed'); })
      .then(function(d) {
        setJwt(d.jwt);
        history.replaceState({}, '', location.pathname);
        hideOverlay();
        fireEvent();
      })
      .catch(function() {});
    return true;
  }

  // --- Google OAuth ---
  function startGoogleAuth() {
    fetch('/api/auth/nonce')
      .then(function(r) { return r.ok ? r.json() : Promise.reject('nonce_failed'); })
      .then(function(d) {
        var invite = '';
        try { invite = sessionStorage.getItem('guestInviteToken') || ''; } catch(e) {}
        try { sessionStorage.removeItem('guestInviteToken'); } catch(e) {}
        var state = btoa(JSON.stringify({ redirect_to: location.hostname, invite: invite, nonce: d.nonce }));

        fetch('/api/auth/config')
          .then(function(r) { return r.ok ? r.json() : Promise.reject('config_failed'); })
          .then(function(cfg) {
            var clientId = cfg.googleClientId;
            var redirectUri = cfg.oauthCallbackUrl;
            var url = 'https://accounts.google.com/o/oauth2/v2/auth'
              + '?client_id=' + encodeURIComponent(clientId)
              + '&redirect_uri=' + encodeURIComponent(redirectUri)
              + '&scope=' + encodeURIComponent('openid email profile')
              + '&response_type=code'
              + '&state=' + encodeURIComponent(state);
            location.href = url;
          })
          .catch(function() { showPanel('error'); });
      })
      .catch(function() { showPanel('error'); });
  }

  // --- Event dispatch ---
  function fireEvent() {
    try { document.dispatchEvent(new CustomEvent('sd:auth')); } catch(e) {}
  }

  // --- SD API object ---
  var SD = {
    getUser: function() {
      var payload = parseJwt(getJwt());
      if (!payload || isExpired(payload)) return null;
      return { email: payload.email || '', name: payload.name || '', address: payload.address || '', dashboardId: payload.dashboardId || dashboardId };
    },
    isOwner: function() {
      var payload = parseJwt(getJwt());
      if (!payload) return false;
      // Owner check: JWT dashboardId matches and address matches dashboard owner
      return !!payload.address && payload.dashboardId === dashboardId;
    },
    logout: function() {
      fetch(AUTH_API + '/api/auth/dashboard-logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardId: dashboardId })
      }).catch(function(){}).finally(function() {
        removeJwt();
        location.reload();
      });
    },
    data: {
      get: function(collection) {
        return fetch('/api/data/' + encodeURIComponent(collection), { headers: authHeaders() }).then(function(r) { return r.json(); });
      },
      post: function(collection, item) {
        return fetch('/api/data/' + encodeURIComponent(collection), { method: 'POST', headers: authHeaders(), body: JSON.stringify(item) }).then(function(r) { return r.json(); });
      },
      put: function(collection, id, item) {
        return fetch('/api/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), { method: 'PUT', headers: authHeaders(), body: JSON.stringify(item) }).then(function(r) { return r.json(); });
      },
      del: function(collection, id) {
        return fetch('/api/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() }).then(function(r) { return r.json(); });
      },
      list: function(collection) { return SD.data.get(collection); },
      create: function(collection, item) { return SD.data.post(collection, item); },
      update: function(collection, id, item) { return SD.data.put(collection, id, item); },
      patch: function(collection, id, item) { return SD.data.put(collection, id, item); },
      delete: function(collection, id) { return SD.data.del(collection, id); },
      getOne: function(collection, id) {
        return fetch('/api/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), { headers: authHeaders() }).then(function(r) { return r.ok ? r.json() : Promise.resolve(null); });
      },
      upsert: function(collection, keyField, data) {
        return SD.data.get(collection).then(function(items) {
          var keyValue = data[keyField];
          if (keyValue === undefined) return SD.data.post(collection, data);
          var found = items.find(function(item) { return item[keyField] === keyValue; });
          if (found) return SD.data.put(collection, found.id, data);
          return SD.data.post(collection, data);
        });
      }
    },
    admin: {
      getUsers: function() {
        return fetch(AUTH_API + '/api/auth/admin/users?dashboardId=' + encodeURIComponent(dashboardId), { headers: authHeaders() }).then(function(r) { return r.json(); });
      },
      revokeAccess: function(email) {
        return fetch(AUTH_API + '/api/auth/admin/access', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ email: email, dashboardId: dashboardId }) }).then(function(r) { return r.json(); });
      },
      getMembers: function() {
        return SD.data.get('members').then(function(members) {
          return members.map(function(m) {
            if (m.email === (SD.getUser() && SD.getUser().email) && SD.isOwner()) {
              return Object.assign({}, m, { isOwner: true });
            }
            return m;
          });
        });
      },
      removeMember: function(email) {
        if (!SD.isOwner()) throw new Error('SD.admin methods require owner access');
        return SD.data.get('members').then(function(members) {
          var found = members.find(function(m) { return m.email === email; });
          var delPromise = found ? SD.data.del('members', found.id) : Promise.resolve();
          return delPromise.then(function() {
            return SD.admin.revokeAccess(email);
          });
        });
      }
    }
  };

  window.SD = SD;

  // --- Init ---
  function init() {
    // Handle error params from OAuth redirect
    var params = new URLSearchParams(location.search);
    var error = params.get('error');
    if (error === 'no_access') { showPanel('denied'); return; }
    if (error === 'service_unavailable' || error === 'auth_failed') { showPanel('error'); return; }

    // Save invite token
    var invite = params.get('invite');
    if (invite) { try { sessionStorage.setItem('guestInviteToken', invite); } catch(e) {} }

    // Handle magic link
    if (handleMagicLink()) return;

    // Check existing JWT
    var payload = parseJwt(getJwt());
    if (payload && !isExpired(payload)) {
      fireEvent();
      return;
    }

    // Fetch auth config
    fetch('/api/auth/config')
      .then(function(r) { return r.ok ? r.json() : Promise.reject('config_failed'); })
      .then(function(cfg) {
        if (!cfg.authEnabled) {
          fireEvent();
          return;
        }

        // invite-only mode: show auth only when invite token present
        if (cfg.accessMode !== 'open') {
          var hasInvite = !!params.get('invite') || false;
          try { hasInvite = hasInvite || !!sessionStorage.getItem('guestInviteToken'); } catch(e) {}
          if (!hasInvite) {
            fireEvent();
            return;
          }
        }

        // Auth is required — show loading, try silent auto-auth
        showPanel('loading');

        var statusUrl = AUTH_API + '/api/auth/invite/status?dashboardId=' + dashboardId;
        fetch(statusUrl, { credentials: 'include' })
          .then(function(r) { return r.ok ? r.json() : Promise.reject('status_failed'); })
          .then(function(data) {
            if (data && data.mlToken) {
              location.href = location.origin + '?ml=' + data.mlToken;
            } else {
              showPanel('auth');
              wireGoogleButton();
            }
          })
          .catch(function() {
            showPanel('auth');
            wireGoogleButton();
          });
      })
      .catch(function() {
        // Config fetch failed — show content anyway (degraded mode)
        fireEvent();
      });
  }

  function wireGoogleButton() {
    var btn = document.getElementById('sd-google-btn');
    if (btn) {
      btn.addEventListener('click', function() { startGoogleAuth(); });
    }
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}

function cleanupExpired<T extends { expiresAt: string }>(items: T[]): T[] {
  const now = Date.now();
  return items.filter((item) => {
    const expires = Date.parse(item.expiresAt);
    return Number.isFinite(expires) && expires > now;
  });
}

function getChatTranscriptPath(chatId: number): string {
  return path.join(WEBCHAT_CHATS_DIR, `${chatId}.json`);
}

function readChatTranscript(chatId: number): WebMessage[] {
  const transcript = readJsonFile<unknown>(getChatTranscriptPath(chatId), []);
  return Array.isArray(transcript) ? (transcript as WebMessage[]) : [];
}

type WorkspaceChatLogMessage = {
  text: string;
  from: 'user' | 'bot';
  timestamp: string;
};

function buildWorkspaceChatLog(transcript: WebMessage[]): WorkspaceChatLogMessage[] {
  const out: WorkspaceChatLogMessage[] = [];
  for (const msg of transcript) {
    if (!msg || msg.deletedAt) continue;
    if (typeof msg.text !== 'string') continue;
    const text = msg.text;
    if (!text.trim()) continue;

    const from: WorkspaceChatLogMessage['from'] = msg.role === 'user' ? 'user' : 'bot';
    const timestamp = typeof msg.createdAt === 'string' && msg.createdAt ? msg.createdAt : nowIso();
    out.push({ text, from, timestamp });
  }
  return out;
}

function syncWorkspaceChatLogFromTranscript(chatId: number, transcript: WebMessage[]): void {
  // Keep ${WORKSPACES_ROOT}/user_{id}/chat_log.json aligned with the web transcript,
  // but do not create the workspace directory here: its existence is used as a signal
  // that onboarding has completed (see getWorkingDirForChat in bot.ts).
  if (process.env.WEBCHAT_WRITE_WORKSPACE_LOG === 'false') {
    return;
  }

  const workspaceDir = path.join('${WORKSPACES_ROOT}', `user_${chatId}`);
  if (!fs.existsSync(workspaceDir)) {
    return;
  }

  try {
    const logPath = path.join(workspaceDir, 'chat_log.json');
    const log = buildWorkspaceChatLog(transcript);
    writeJsonAtomic(logPath, log);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Failed to sync workspace chat_log.json for webchat userId=${chatId}: ${msg}`);
  }
}

function writeChatTranscript(chatId: number, messages: WebMessage[]): void {
  writeJsonAtomic(getChatTranscriptPath(chatId), messages);
  syncWorkspaceChatLogFromTranscript(chatId, messages);
}

// Write WEBCHAT_INIT_MESSAGE to transcript on first login when /start is disabled.
// Used by both /api/auth/claim and /api/auth/google when WEBCHAT_INIT_WITH_START=false.
function maybeWriteInitMessageTranscript(userId: number, lang: string, showcasesUrl?: string): void {
  const initMsg = process.env.WEBCHAT_INIT_MESSAGE;
  if (!initMsg) return;
  const transcript = readChatTranscript(userId);
  if (transcript.length !== 0) return;
  let text =
    lang === 'ru' && process.env.WEBCHAT_INIT_MESSAGE_RU
      ? process.env.WEBCHAT_INIT_MESSAGE_RU
      : initMsg;
  if (showcasesUrl) {
    text = appendShowcasesLinkToMessage(text, lang, showcasesUrl);
  }
  writeChatTranscript(userId, [
    { id: 1, role: 'user', text: '/start', createdAt: nowIso() },
    { id: 2, role: 'assistant', text, createdAt: nowIso() },
  ]);
}

function looksLikeRunningStatusMessage(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (!normalized.startsWith('⏳')) return false;
  const lower = normalized.toLowerCase();
  return lower.includes('still working') || lower.includes('все еще работает');
}

function cleanupStaleRunningStatusMessages(lang: 'ru' | 'en'): void {
  // Webchat tasks run inside this process. If PM2 restarts webchat while a CLI task is running,
  // the status message can remain forever and confuse the user ("timer not ticking").
  const cutoffMs = 3 * 60 * 1000;
  const now = Date.now();
  const interruptedText = lang === 'ru'
    ? '⚠️ Запрос прервался — сервер перезапустился пока Claude работал над ответом. Отправьте запрос повторно.'
    : '⚠️ Request was interrupted — the server restarted while Claude was working. Please send your message again.';

  try {
    ensureDir(WEBCHAT_CHATS_DIR);
    const files = fs.readdirSync(WEBCHAT_CHATS_DIR).filter((f) => f.endsWith('.json'));
    let updated = 0;
    for (const file of files) {
      const chatId = Number(path.basename(file, '.json'));
      if (!Number.isSafeInteger(chatId) || chatId <= 0) continue;
      const transcript = readChatTranscript(chatId);
      let changed = false;
      for (const msg of transcript) {
        if (!msg || msg.role !== 'assistant') continue;
        if (msg.deletedAt) continue;
        if (!looksLikeRunningStatusMessage(msg.text)) continue;
        const last = parseIsoMs(msg.updatedAt) || parseIsoMs(msg.createdAt);
        if (!Number.isFinite(last)) continue;
        if (now - last < cutoffMs) continue;
        msg.text = interruptedText;
        msg.updatedAt = nowIso();
        changed = true;
      }
      if (changed) {
        writeChatTranscript(chatId, transcript);
        updated += 1;
      }
    }
    if (updated > 0) {
      console.log(`🧹 Cleaned up stale running status messages in ${updated} chats`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Failed to cleanup stale running status messages: ${msg}`);
  }
}

function computeNextMessageId(messages: WebMessage[]): number {
  let max = 0;
  for (const msg of messages) {
    if (typeof msg?.id === 'number' && Number.isSafeInteger(msg.id) && msg.id > max) {
      max = msg.id;
    }
  }
  return max + 1;
}

function appendGlobalMessageHistory(userId: number, text: string, from: 'user' | 'bot'): void {
  if (process.env.WEBCHAT_WRITE_GLOBAL_HISTORY === 'false') {
    return;
  }
  const existing = readJsonFile<unknown>(GLOBAL_MESSAGE_HISTORY_PATH, []);
  const messages: unknown[] = Array.isArray(existing) ? existing : [];
  messages.push({ userId, text, from, timestamp: nowIso(), channel: 'web' });
  writeJsonAtomic(GLOBAL_MESSAGE_HISTORY_PATH, messages);
}

function buildBaseUrl(req: express.Request): string {
  const configured = process.env.WEBCHAT_BASE_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol;
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

type CrawlTarget = {
  label: 'RU' | 'EN';
  url: string;
  expectedLanguage: 'ru' | 'en';
};

type CrawlCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

type CrawlTargetResult = {
  label: 'RU' | 'EN';
  url: string;
  expectedLanguage: 'ru' | 'en';
  ok: boolean;
  checks: CrawlCheck[];
};

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildCrawlTargets(req: express.Request): CrawlTarget[] {
  const host = String(req.get('host') || '').toLowerCase();
  const proto = String((req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'https');
  const current = normalizeUrl(`${proto}://${host || 'localhost'}`);
  const isLocalHost = host.startsWith('127.0.0.1') || host.startsWith('localhost');

  const defaultRu = isLocalHost
    ? 'http://127.0.0.1:8091'
    : (host.includes('coderbox') ? 'https://clodeboxbot.wpmix.net' : current);
  const defaultEn = isLocalHost
    ? 'http://127.0.0.1:8092'
    : (host.includes('coderbox') ? current : 'https://coderbox.onout.org');

  const ruUrl = normalizeUrl(process.env.WEBCHAT_CRAWL_RU_URL || defaultRu);
  const enUrl = normalizeUrl(process.env.WEBCHAT_CRAWL_EN_URL || defaultEn);

  return [
    { label: 'RU', url: ruUrl, expectedLanguage: 'ru' },
    { label: 'EN', url: enUrl, expectedLanguage: 'en' },
  ];
}

type ExtensionPreviewCase = {
  slug: string;
  title: string;
  summary: string;
  prompt: string;
  botResponse: string;
  imageSmallUrl: string;
  imageLargeUrl: string;
};

function readTextFileSafe(filePath: string, fallback: string): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const text = raw.trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function resolvePreviewAssetUrl(slug: string, names: string[], fallbackName: string): string {
  for (const name of names) {
    const abs = path.join(EXTENSION_PREVIEWS_DIR, slug, name);
    if (fs.existsSync(abs)) {
      return `/extension-assets/${slug}/${name}`;
    }
  }
  return `/extension-assets/${slug}/${fallbackName}`;
}

function getExtensionPreviewCases(): ExtensionPreviewCase[] {
  const defs = [
    {
      slug: 'yoga-hero-button',
      title: 'Yoga Studio Hero + CTA',
      summary: 'Minimal landing: one headline and one booking button.',
      fallbackPrompt: 'Create a yoga studio site with one large headline and a "Book Now" button.',
      fallbackResponse: 'Done. Created a minimal landing: headline + booking button.',
    },
    {
      slug: 'booking-calendar-forms',
      title: 'Booking Calendar + Forms',
      summary: 'Calendar screen with bookings and reservation forms.',
      fallbackPrompt: 'Create a calendar and booking forms screen for a studio.',
      fallbackResponse: 'Done. Built a calendar, booking form and confirmation statuses.',
    },
    {
      slug: 'calendar-large-visibility',
      title: 'Calendar Large Visibility',
      summary: 'Large calendar screen with big CTA for visibility from afar.',
      fallbackPrompt: 'Create a large calendar screen for a studio: big headline, visible cards and a large booking button.',
      fallbackResponse: 'Done. Created a large calendar screen with focus on slots, bookings and CTA button.',
    },
    {
      slug: 'yoga-operator-dashboard-large',
      title: 'Yoga Operator Dashboard Large',
      summary: 'Studio promo screen with operator dashboard focus.',
      fallbackPrompt: 'Create a promo screen for a yoga studio: big headline, booking button and an operator dashboard section.',
      fallbackResponse: 'Done. Built a large promo screen with CTA and operator dashboard section.',
    },
  ];

  return defs.map((def) => {
    const caseDir = path.join(EXTENSION_PREVIEWS_DIR, def.slug);
    const promptPath = path.join(caseDir, 'prompt.txt');
    const responsePath = path.join(caseDir, 'bot_response.txt');
    return {
      slug: def.slug,
      title: def.title,
      summary: def.summary,
      prompt: readTextFileSafe(promptPath, def.fallbackPrompt),
      botResponse: readTextFileSafe(responsePath, def.fallbackResponse),
      imageSmallUrl: resolvePreviewAssetUrl(def.slug, ['screenshot-640x400.png', 'screenshot.png'], 'screenshot.png'),
      imageLargeUrl: resolvePreviewAssetUrl(def.slug, ['screenshot-1280x800.png', 'screenshot.png'], 'screenshot.png'),
    };
  });
}

function renderMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

function shouldRenderExtensionLandingAtRoot(req: express.Request): boolean {
  const host = String(req.get('host') || '').toLowerCase();
  return host.startsWith('aisell.wpmix.net');
}

function renderExtensionLandingHtml(): string {
  const extensionName = escapeHtml(getWebchatExtensionName());
  const extensionDescription = escapeHtml(getWebchatExtensionDescription());
  const previewCases = getExtensionPreviewCases();
  const cardsHtml = previewCases.map((item) => {
    return `
      <article class="case">
        <a class="shot-link" href="${escapeHtml(item.imageLargeUrl)}" target="_blank" rel="noopener noreferrer">
          <img class="shot" src="${escapeHtml(item.imageSmallUrl)}" alt="${escapeHtml(item.title)} preview" loading="lazy" />
        </a>
        <div class="case-body">
          <h3>${escapeHtml(item.title)}</h3>
          <p class="summary">${escapeHtml(item.summary)}</p>
          <div class="label">User prompt</div>
          <p class="box">${renderMultilineHtml(item.prompt)}</p>
          <div class="label">Bot response</div>
          <p class="box">${renderMultilineHtml(item.botResponse)}</p>
        </div>
      </article>
    `;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${extensionName} - Chrome Extension</title>
  <style>
    :root {
      --bg0: #0d1220;
      --bg1: #111827;
      --text: rgba(242, 247, 255, 0.95);
      --muted: rgba(206, 219, 239, 0.78);
      --line: rgba(170, 194, 228, 0.26);
      --panel: rgba(15, 25, 43, 0.78);
      --chip: rgba(77, 137, 255, 0.20);
      --accent: #7dd3fc;
      --accent2: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background:
        radial-gradient(1200px 700px at 20% -10%, rgba(59, 130, 246, 0.28), transparent 60%),
        radial-gradient(1000px 600px at 85% 10%, rgba(45, 212, 191, 0.20), transparent 58%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
      min-height: 100vh;
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 20px 48px; }
    .hero {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(15,25,43,0.85), rgba(19,35,59,0.78));
      padding: 24px;
      box-shadow: 0 16px 45px rgba(0,0,0,0.28);
    }
    .kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--accent);
      margin-bottom: 10px;
      font-weight: 700;
    }
    .title {
      margin: 0;
      font-size: clamp(30px, 6vw, 44px);
      line-height: 1.03;
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .desc {
      margin: 14px 0 0;
      max-width: 760px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.5;
    }
    .actions {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .btn {
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
      border-radius: 10px;
      padding: 10px 14px;
      border: 1px solid var(--line);
      color: var(--text);
      background: rgba(255,255,255,0.06);
    }
    .btn.primary {
      border-color: rgba(96, 165, 250, 0.55);
      background: linear-gradient(120deg, rgba(37, 99, 235, 0.52), rgba(2, 132, 199, 0.44));
    }
    .grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }
    .meta-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--panel);
      padding: 14px;
    }
    .meta-card h2 {
      margin: 0 0 10px;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .meta-card ol, .meta-card ul {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      line-height: 1.5;
      font-size: 13px;
    }
    .cases {
      margin-top: 22px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .case {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--panel);
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(280px, 480px) 1fr;
    }
    .shot-link {
      display: block;
      border-right: 1px solid var(--line);
      background: rgba(7, 13, 24, 0.72);
    }
    .shot {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      aspect-ratio: 16 / 10;
    }
    .case-body { padding: 14px; }
    .case-body h3 {
      margin: 0;
      font-size: 21px;
      letter-spacing: -0.01em;
    }
    .summary {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .label {
      margin-top: 12px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--accent);
      font-weight: 700;
    }
    .box {
      margin: 6px 0 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 9px 10px;
      background: rgba(255,255,255,0.04);
      font-size: 13px;
      line-height: 1.45;
      color: var(--text);
    }
    @media (max-width: 960px) {
      .case {
        grid-template-columns: 1fr;
      }
      .shot-link {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="kicker">Chrome Extension Landing</div>
      <h1 class="title">${extensionName}</h1>
      <p class="desc">${extensionDescription}</p>
      <div class="actions">
        <a class="btn primary" href="/downloads/chrome-sidebar-extension.zip">Download Extension ZIP</a>
        <a class="btn" href="chrome://extensions">Open chrome://extensions</a>
      </div>
    </section>

    <section class="grid">
      <article class="meta-card">
        <h2>Install</h2>
        <ol>
          <li>Open <code>chrome://extensions</code> and enable <code>Developer mode</code>.</li>
          <li>Load unpacked folder or install built package from ZIP.</li>
          <li>Pin extension and open Side Panel.</li>
          <li>Use chat + page context tools in one place.</li>
        </ol>
      </article>
      <article class="meta-card">
        <h2>What This Page Shows</h2>
        <ul>
          <li>Only extension-related scenarios.</li>
          <li>Each card includes user prompt and bot response.</li>
          <li>Preview screenshots are generated from real HTML pages.</li>
          <li>Right side in previews uses real iframe webchat UI.</li>
        </ul>
      </article>
    </section>

    <section class="cases">
      ${cardsHtml}
    </section>
  </main>
</body>
</html>`;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function formatCrawlDetail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

async function runCrawlTarget(target: CrawlTarget): Promise<CrawlTargetResult> {
  const checks: CrawlCheck[] = [];
  const timeoutMs = Number(process.env.WEBCHAT_CRAWL_TIMEOUT_MS || '12000');

  try {
    const healthRaw = await fetchJsonWithTimeout(`${target.url}/health`, timeoutMs);
    const health = (healthRaw && typeof healthRaw === 'object') ? (healthRaw as Record<string, unknown>) : {};
    const ok = health.ok === true;
    checks.push({
      name: 'GET /health',
      ok,
      detail: ok ? 'ok=true' : `unexpected payload: ${JSON.stringify(health).slice(0, 180)}`,
    });
  } catch (error) {
    checks.push({ name: 'GET /health', ok: false, detail: formatCrawlDetail(error) });
  }

  try {
    const bootRaw = await fetchJsonWithTimeout(`${target.url}/api/public/bootstrap`, timeoutMs);
    const boot = (bootRaw && typeof bootRaw === 'object') ? (bootRaw as Record<string, unknown>) : {};
    const lang = typeof boot.language === 'string' ? boot.language : '';
    const startMessages = Array.isArray(boot.startMessages) ? boot.startMessages : [];
    const hasStart = startMessages.some((message) => {
      if (!message || typeof message !== 'object') return false;
      const text = (message as Record<string, unknown>).text;
      return text === '/start';
    });
    const ok = lang === target.expectedLanguage && hasStart;
    checks.push({
      name: 'GET /api/public/bootstrap',
      ok,
      detail: ok
        ? `language=${lang}, start=/start`
        : `language=${lang || 'n/a'}, hasStart=${hasStart}`,
    });
  } catch (error) {
    checks.push({ name: 'GET /api/public/bootstrap', ok: false, detail: formatCrawlDetail(error) });
  }

  try {
    const html = await fetchTextWithTimeout(`${target.url}/`, timeoutMs);
    const ok = html.includes('<!doctype html') || html.includes('<!DOCTYPE html');
    checks.push({
      name: 'GET /',
      ok,
      detail: ok ? 'html page returned' : 'response is not html',
    });
  } catch (error) {
    checks.push({ name: 'GET /', ok: false, detail: formatCrawlDetail(error) });
  }

  return {
    label: target.label,
    url: target.url,
    expectedLanguage: target.expectedLanguage,
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function renderAppHtml(): string {
  const title = escapeHtml(getWebchatTitle());
  const subtitle = escapeHtml(getWebchatSubtitle());
  const isSimpleDashboardUi = isSimpleDashboardProduct();
  const enableGoogleAuth = process.env.ENABLE_GOOGLE_AUTH === 'true';
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  ${enableGoogleAuth && googleClientId ? `<script src="https://accounts.google.com/gsi/client" async defer></script>` : ''}
  <style>
    :root {
      --bg0: #f8fafc;
      --bg1: #eef2ff;
      --panel: rgba(2, 6, 23, 0.04);
      --panel2: rgba(2, 6, 23, 0.06);
      --border: rgba(2, 6, 23, 0.10);
      --text: rgba(15, 23, 42, 0.92);
      --muted: rgba(15, 23, 42, 0.60);
      --user: rgba(5, 150, 105, 0.12);
      --bot: rgba(37, 99, 235, 0.12);
      --shadow: rgba(2, 6, 23, 0.12);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--mono);
      color: var(--text);
      background:
        radial-gradient(1200px 700px at 20% 10%, rgba(16,185,129,0.16), transparent 60%),
        radial-gradient(1000px 600px at 90% 30%, rgba(59,130,246,0.16), transparent 55%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
      overflow: hidden;
    }
    .root {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
      min-height: 0;
    }
    .topbar {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.70));
      backdrop-filter: blur(10px);
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      position: relative;
      z-index: 100;
    }
    .topbar .left { display: flex; flex-direction: column; min-width: 0; }
    .topbar .t1 { font-weight: 900; font-size: 14px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar .t2 { margin: 4px 0 0 0; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar .right { color: var(--muted); font-size: 11px; display: flex; align-items: center; gap: 10px; }
    .menu-wrap { position: relative; display: flex; align-items: center; gap: 10px; }
    .menu-btn {
      width: 36px;
      height: 32px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.72);
      color: var(--text);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .burger {
      width: 16px;
      height: 10px;
      display: grid;
      gap: 3px;
    }
    .burger span {
      display: block;
      height: 2px;
      background: rgba(15, 23, 42, 0.85);
      border-radius: 999px;
    }
    .menu {
      position: absolute;
      right: 0;
      top: 42px;
      min-width: 220px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.82));
      box-shadow: 0 20px 60px rgba(2, 6, 23, 0.18);
      backdrop-filter: blur(10px);
      padding: 10px;
      display: none;
      z-index: 10;
    }
    .menu.open { display: block; }
    .menu a {
      display: block;
      padding: 10px 10px;
      border-radius: 12px;
      text-decoration: none;
      color: rgba(15, 23, 42, 0.90);
      border: 1px solid rgba(255,255,255,0.00);
      font-size: 12px;
    }
    .menu a:hover {
      background: rgba(2, 6, 23, 0.04);
      border-color: rgba(2, 6, 23, 0.08);
    }
    .menu .sep { height: 1px; background: rgba(2, 6, 23, 0.10); margin: 8px 4px; }
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: rgba(255,255,255,0.72);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 16px;
    }
    .theme-toggle:hover {
      background: rgba(255,255,255,0.92);
      transform: scale(1.05);
    }
    .theme-toggle:active {
    }
    .login-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      padding: 0 16px;
      border-radius: 16px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: rgba(255,255,255,0.72);
      color: var(--text);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .login-btn:hover {
      background: rgba(255,255,255,0.92);
      transform: scale(1.02);
    }
    .login-btn:active {
      transform: scale(0.98);
    }
    .login-btn.hidden {
      display: none;
      transform: scale(0.95);
    }
    .theme-btn {
      display: none;
    }
    .messages {
      flex: 1;
      overflow: auto;
      padding: 18px 18px 12px 18px;
      min-height: 0;
    }
    .bubble {
      max-width: 860px;
      padding: 12px 12px;
      border-radius: 16px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      box-shadow: 0 10px 30px rgba(2, 6, 23, 0.08);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
      font-size: 18px;
      margin-bottom: 10px;
      animation: pop 120ms ease-out;
    }
    @keyframes pop { from { transform: translateY(3px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .row { display: flex; }
    .row.user { justify-content: flex-end; }
    .row.assistant { justify-content: flex-start; }
    .bubble.user { background: linear-gradient(180deg, rgba(5,150,105,0.14), rgba(5,150,105,0.08)); }
    .bubble.assistant { background: linear-gradient(180deg, rgba(37,99,235,0.14), rgba(37,99,235,0.08)); }
    .bubble.system { background: rgba(2, 6, 23, 0.03); color: var(--muted); }
    .meta {
      margin-top: 8px;
      font-size: 10px;
      color: rgba(15, 23, 42, 0.55);
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .meta-right { display: flex; align-items: center; gap: 10px; }
    .fb { display: inline-flex; align-items: center; gap: 6px; }
    .fb-btn {
      border-radius: 10px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: rgba(255,255,255,0.70);
      color: rgba(15, 23, 42, 0.82);
      cursor: pointer;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1;
      padding: 4px 6px;
    }
    .fb-btn:hover { background: rgba(2, 6, 23, 0.04); }
    .fb-btn.on.up {
      background: rgba(16,185,129,0.14);
      border-color: rgba(16,185,129,0.35);
      color: rgba(5,150,105,0.92);
    }
    .fb-btn.on.down {
      background: rgba(248,113,113,0.12);
      border-color: rgba(248,113,113,0.35);
      color: rgba(220,38,38,0.90);
    }
    .kbd {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .kbd button {
      border-radius: 12px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: rgba(255,255,255,0.70);
      color: var(--text);
      font-family: var(--mono);
      font-size: 12px;
      padding: 9px 10px;
      cursor: pointer;
    }
    .composer {
      padding: 12px 16px 16px 16px;
      border-top: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.70), rgba(255,255,255,0.86));
      backdrop-filter: blur(10px);
    }
    .composer form {
      display: grid;
      grid-template-columns: 1fr 120px;
      gap: 10px;
    }
    .composer textarea {
      resize: none;
      min-height: 62px;
      max-height: 160px;
      padding: 12px 12px;
      border-radius: 14px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: rgba(255,255,255,0.80);
      color: var(--text);
      font-family: var(--mono);
      font-size: 13px;
      outline: none;
    }
    .composer textarea::placeholder { color: rgba(15, 23, 42, 0.45); }
    .composer textarea:focus {
      border-color: rgba(45,212,191,0.55);
      box-shadow: 0 0 0 3px rgba(45,212,191,0.10);
    }
    .composer button {
      border-radius: 14px;
      border: 1px solid rgba(2, 6, 23, 0.10);
      background: linear-gradient(90deg, rgba(16,185,129,0.16), rgba(59,130,246,0.16));
      color: var(--text);
      font-family: var(--mono);
      font-weight: 900;
      font-size: 13px;
      cursor: pointer;
    }
    .composer button:disabled { opacity: 0.6; cursor: not-allowed; }
    .composer-extras {
      display: none;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .screenshot-toggle {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--muted, rgba(15,23,42,0.5));
      cursor: pointer;
      user-select: none;
      padding: 0 0 3px 0;
      transition: color 0.2s;
    }
    .screenshot-toggle input[type=checkbox] { width: 13px; height: 13px; cursor: pointer; accent-color: #10b981; }
    .screenshot-toggle:hover { color: var(--text); }
    .screenshot-toggle.capturing { color: #10b981; animation: ss-pulse 0.7s ease-in-out infinite; }
    @keyframes ss-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .ss-spinner {
      display: inline-block;
      width: 12px; height: 12px;
      border: 2px solid rgba(16,185,129,0.3);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: ss-spin 0.6s linear infinite;
    }
    @keyframes ss-spin { to { transform: rotate(360deg); } }
    .msg-screenshot { display: block; max-width: 240px; max-height: 150px; border-radius: 6px; margin-top: 6px; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; object-fit: contain; }
    body.theme-dark .msg-screenshot { border-color: rgba(255,255,255,0.15); }
    .modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.97);
      z-index: 20;
    }
    .modal.open { display: flex; }
    .modal-card {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: transparent;
      padding: 24px;
    }
    .modal-title { margin: 0; font-size: 20px; font-weight: 900; text-align: center; }
    .modal-sub { margin: 10px 0 24px 0; font-size: 14px; color: var(--muted); line-height: 1.5; text-align: center; max-width: 400px; }
    .btn {
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      padding: 11px 12px;
      font-family: var(--mono);
      font-weight: 900;
      cursor: pointer;
      font-size: 13px;
    }
    .btn.primary {
      background: linear-gradient(90deg, rgba(45,212,191,0.18), rgba(96,165,250,0.18));
      color: var(--text);
    }
    .btn.secondary {
      background: rgba(255,255,255,0.74);
      color: rgba(15, 23, 42, 0.86);
    }
    .modal-status { margin-top: 10px; font-size: 11px; color: var(--muted); min-height: 16px; }
    .modal-status.error { color: #f87171; }

    .intro-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 80;
      background: rgba(2, 6, 23, 0.48);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 20px;
    }
    .intro-overlay.open { display: flex; }
    .intro-card {
      width: min(640px, 100%);
      border-radius: 22px;
      border: 1px solid rgba(148, 163, 184, 0.32);
      background:
        radial-gradient(140% 120% at 10% 8%, rgba(59, 130, 246, 0.22), rgba(59, 130, 246, 0)),
        linear-gradient(170deg, rgba(15, 23, 42, 0.86), rgba(2, 6, 23, 0.90));
      box-shadow: 0 24px 70px rgba(2, 6, 23, 0.56);
      color: #f8fafc;
      padding: 20px;
      overflow: hidden;
    }
    .intro-title {
      margin: 0;
      font-size: 24px;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0.01em;
    }
    .intro-sub {
      margin: 10px 0 0 0;
      font-size: 14px;
      color: rgba(226, 232, 240, 0.88);
      line-height: 1.45;
    }
    .intro-stack {
      --pointer-x: 0;
      --pointer-y: 0;
      position: relative;
      margin-top: 16px;
      min-height: 260px;
      border-radius: 16px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background:
        radial-gradient(120% 150% at 50% 10%, rgba(148, 163, 184, 0.18), rgba(148, 163, 184, 0)),
        linear-gradient(180deg, rgba(30, 41, 59, 0.56), rgba(2, 6, 23, 0.52));
      overflow: hidden;
      transform-style: preserve-3d;
      transform: perspective(900px) rotateX(calc(var(--pointer-y) * -6deg)) rotateY(calc(var(--pointer-x) * 8deg));
      transition: transform 200ms ease;
      isolation: isolate;
    }
    .intro-shot {
      position: absolute;
      width: clamp(210px, 64%, 370px);
      aspect-ratio: 16 / 10;
      object-fit: cover;
      border-radius: 13px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      box-shadow: 0 16px 38px rgba(2, 6, 23, 0.42);
      pointer-events: none;
      user-select: none;
      transition: transform 200ms ease, box-shadow 200ms ease, filter 200ms ease;
      backface-visibility: hidden;
      will-change: transform;
      filter: saturate(1.05);
    }
    .intro-shot.shot-a {
      left: 4%;
      top: 34%;
      transform: translate3d(calc(var(--pointer-x) * -22px), calc(var(--pointer-y) * 18px), 0px) rotate(-12deg);
      z-index: 1;
    }
    .intro-shot.shot-b {
      left: 18%;
      top: 15%;
      transform: translate3d(calc(var(--pointer-x) * -10px), calc(var(--pointer-y) * 10px), 24px) rotate(-2deg);
      z-index: 2;
    }
    .intro-shot.shot-c {
      right: 4%;
      top: 31%;
      transform: translate3d(calc(var(--pointer-x) * 20px), calc(var(--pointer-y) * -16px), 10px) rotate(11deg);
      z-index: 3;
    }
    .intro-stack:hover .intro-shot {
      filter: saturate(1.15) brightness(1.06);
      box-shadow: 0 22px 48px rgba(2, 6, 23, 0.52);
    }
    .intro-stack:hover .shot-a {
      transform: translate3d(calc(var(--pointer-x) * -22px), calc(var(--pointer-y) * 18px), 6px) rotate(-12deg) scale(1.02);
    }
    .intro-stack:hover .shot-b {
      transform: translate3d(calc(var(--pointer-x) * -10px), calc(var(--pointer-y) * 10px), 30px) rotate(-2deg) scale(1.03);
    }
    .intro-stack:hover .shot-c {
      transform: translate3d(calc(var(--pointer-x) * 20px), calc(var(--pointer-y) * -16px), 16px) rotate(11deg) scale(1.02);
    }
    .intro-actions-row {
      margin-top: 14px;
      display: flex;
      justify-content: center;
    }
    .intro-btn {
      border-radius: 999px;
      border: 1px solid rgba(226, 232, 240, 0.30);
      background: rgba(15, 23, 42, 0.36);
      color: #f8fafc;
      cursor: pointer;
      font-weight: 800;
      font-size: 14px;
      line-height: 1;
      padding: 12px 18px;
      text-align: center;
      text-decoration: none;
      transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
    }
    .intro-btn:hover {
      background: rgba(30, 41, 59, 0.58);
      transform: translateY(-1px);
    }
    .intro-btn.primary {
      border-color: rgba(96, 165, 250, 0.82);
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.86), rgba(37, 99, 235, 0.86));
      color: #eef6ff;
    }
    .intro-btn.secondary {
      background: rgba(2, 6, 23, 0.46);
      color: rgba(226, 232, 240, 0.92);
    }
    .intro-center-action {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 5;
      transform: translate(-50%, -50%);
      min-width: min(75%, 260px);
      padding: 14px 22px;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      box-shadow: 0 10px 24px rgba(2, 6, 23, 0.42);
    }
    .intro-meta {
      margin-top: 10px;
      font-size: 12px;
      text-align: center;
      color: rgba(226, 232, 240, 0.74);
    }
    @media (max-width: 640px) {
      .intro-card { padding: 16px; border-radius: 18px; }
      .intro-title { font-size: 20px; }
      .intro-stack { min-height: 220px; }
      .intro-shot { width: clamp(170px, 72%, 300px); }
      .intro-center-action { min-width: 190px; padding: 12px 18px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .intro-stack,
      .intro-shot,
      .intro-btn { transition: none; }
    }
    .bubble a {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    /* Dark theme */
    body.theme-dark {
      --bg0: #070b16;
      --bg1: #0b1224;
      --panel: rgba(255, 255, 255, 0.06);
      --panel2: rgba(255, 255, 255, 0.08);
      --border: rgba(148, 163, 184, 0.18);
      --text: rgba(226, 232, 240, 0.92);
      --muted: rgba(226, 232, 240, 0.62);
      --shadow: rgba(0, 0, 0, 0.45);
    }
    body.theme-dark .topbar {
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(180deg, rgba(2,6,23,0.86), rgba(2,6,23,0.74));
    }
    body.theme-dark .menu-btn {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.60);
      color: var(--text);
    }
    body.theme-dark .burger span { background: rgba(226, 232, 240, 0.85); }
    body.theme-dark .menu {
      border: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(180deg, rgba(2,6,23,0.92), rgba(2,6,23,0.84));
    }
    body.theme-dark .menu a { color: rgba(226, 232, 240, 0.90); }
    body.theme-dark .menu a:hover {
      background: rgba(255,255,255,0.06);
      border-color: rgba(148,163,184,0.18);
    }
    body.theme-dark .menu .sep { background: rgba(148, 163, 184, 0.18); }
    body.theme-dark .theme-toggle {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
    }
    body.theme-dark .theme-toggle:hover {
    }
    body.theme-dark .login-btn {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
      color: rgba(226, 232, 240, 0.90);
    }
    body.theme-dark .login-btn:hover {
      background: rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.12);
    }
    body.theme-dark .bubble {
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    }
    body.theme-dark .bubble.system { background: rgba(255, 255, 255, 0.04); }
    body.theme-dark .kbd button {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
      color: rgba(226, 232, 240, 0.92);
    }
    body.theme-dark .kbd button:hover { background: rgba(255,255,255,0.08); }
    body.theme-dark .composer {
      border-top: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(180deg, rgba(2,6,23,0.72), rgba(2,6,23,0.86));
    }
    body.theme-dark .composer textarea {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
      color: rgba(226, 232, 240, 0.92);
    }
    body.theme-dark .composer textarea::placeholder { color: rgba(226, 232, 240, 0.45); }
    body.theme-dark .composer button {
      border: 1px solid rgba(148, 163, 184, 0.18);
      color: rgba(226, 232, 240, 0.92);
      background: linear-gradient(90deg, rgba(16,185,129,0.14), rgba(59,130,246,0.14));
    }
    body.theme-dark .screenshot-toggle { color: rgba(226,232,240,0.45); }
    body.theme-dark .screenshot-toggle:hover { color: rgba(226,232,240,0.92); }
    body.theme-dark .screenshot-toggle.capturing { color: #10b981; }
    body.theme-dark .fb-btn {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
      color: rgba(226, 232, 240, 0.80);
    }
    body.theme-dark .modal {
      background: rgba(2,6,23,0.97);
    }
    body.theme-dark .modal-card {
      background: transparent;
    }
    body.theme-dark .btn.secondary {
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2,6,23,0.62);
      color: rgba(226, 232, 240, 0.88);
    }
    body.theme-dark .btn.primary {
      border: 1px solid rgba(148, 163, 184, 0.18);
      color: rgba(226, 232, 240, 0.92);
    }
    @media (max-width: 860px) {
      .bubble { max-width: 100%; }
    }
  </style>
</head>
	<body>
	  <div class="root">
	    <main class="main">
	      <div class="topbar">
	        <div class="left">
	          <p id="botTitle" class="t1">${title}</p>
	          <p id="botSubtitle" class="t2">${subtitle}</p>
	        </div>
	        <div class="right">
	          <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle theme" title="Toggle theme">
	            <span id="themeIcon">☀️</span>
	          </button>
	          <button id="loginBtn" class="login-btn" type="button" aria-label="Login">Login</button>
	          <div class="menu-wrap">
	            <button id="menuBtn" class="menu-btn" type="button" aria-label="Menu">
	              <span class="burger"><span></span><span></span><span></span></span>
	            </button>
	            <div id="menu" class="menu">
	              <a href="/showcases">Showcases</a>
	              <div class="sep"></div>
	              <a href="https://t.me/noxonbot" target="_blank">💬 SimpleSite Bot</a>
	              <a href="https://t.me/coderboxbot" target="_blank">💬 SimpleDashboard Bot</a>
	              <div class="sep"></div>
	              <a href="/crawl-tests">Crawl tests (RU + EN)</a>
	              <div class="sep"></div>
	              <a href="/downloads/chrome-sidebar-extension.zip">Download Chrome sidebar extension</a>
	              <a href="/profile#mobile">📱 Открыть на телефоне</a>
	              <div id="langSep" class="sep" style="display:none"></div>
	              <a href="#" id="langToggle" style="display:none">🌐 English</a>
	              <div class="sep"></div>
	              <a href="/profile">Profile</a>
	              <a href="/logout">Logout</a>
	            </div>
	          </div>
	          <span id="me"></span>
	        </div>
	      </div>

      <div id="messages" class="messages"></div>

	      <div class="composer">
	        ${isSimpleDashboardUi ? `<div class="composer-extras">
	          <label class="screenshot-toggle" id="screenshotToggleLabel" title="Capture current dashboard screenshot and send it as context">
	            <input type="checkbox" id="screenshotToggle">
	            <span id="screenshotToggleIcon">📷</span>
	            <span id="screenshotToggleText">Добавить скриншот</span>
	          </label>
	        </div>` : ''}
	        <form id="form">
	          <textarea id="input" placeholder="Type a message... (try: /start)"></textarea>
	          <button id="sendBtn" type="submit">Send</button>
	        </form>
	      </div>
	    </main>
	  </div>

		  <div id="loginModal" class="modal">
		    <div class="modal-card">
	      <h2 class="modal-title" id="loginTitle">Continue</h2>
	      <p class="modal-sub" id="loginSubtitle"></p>

	      ${enableGoogleAuth && googleClientId ? `
	      <div id="googleSignInContainer">
	        <div id="g_id_onload"
	             data-client_id="${googleClientId}"
	             data-callback="handleGoogleSignIn"
	             data-auto_prompt="false">
	        </div>
	        <div class="g_id_signin"
	             data-type="standard"
	             data-size="large"
	             data-theme="outline"
	             data-text="sign_in_with"
	             data-shape="rectangular"
	             data-logo_alignment="left"
	             data-width="400">
	        </div>
	      </div>
	      ` : ''}
	      <div id="loginStatus" class="modal-status"></div>
	      <button id="loginCancel" class="btn secondary" type="button" style="margin-top: 16px;">Cancel</button>
		    </div>
		  </div>

      <div id="introOverlay" class="intro-overlay" aria-hidden="true">
        <div class="intro-card">
          <h2 id="introTitle" class="intro-title">Простой способ создавать дашборды</h2>
          <p id="introSubtitle" class="intro-sub">Смотрите готовые примеры и сразу запускайте свой вариант.</p>
          <div id="introStack" class="intro-stack" aria-hidden="true">
            <img id="introShotA" class="intro-shot shot-a" alt="" loading="eager" decoding="async" />
            <img id="introShotB" class="intro-shot shot-b" alt="" loading="eager" decoding="async" />
            <img id="introShotC" class="intro-shot shot-c" alt="" loading="eager" decoding="async" />
            <button id="introViewExamplesBtn" type="button" class="intro-btn primary intro-center-action">Смотреть примеры</button>
          </div>
          <div class="intro-actions-row">
            <button id="introSkipBtn" type="button" class="intro-btn secondary">Skip</button>
          </div>
          <p id="introMeta" class="intro-meta">Экран показывается только при первом входе.</p>
        </div>
      </div>
			
      <script src="/extension-panel-shared.js"></script>
		  <script>
	    const escapeHtml = (window.WebchatSidebarShared && typeof window.WebchatSidebarShared.escapeHtml === 'function')
	      ? window.WebchatSidebarShared.escapeHtml
	      : function(text) {
      return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\"', '&quot;')
        .replaceAll(\"'\", '&#039;');
    };

    // Google Sign-In callback
    async function handleGoogleSignIn(response) {
      const credential = response.credential;
      try {
        const resp = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential,
            lang: detectUiLang(),
            ...(startParam ? { startParam } : {}),
          })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
          const err = data.error || 'Google Sign-In failed';
          document.getElementById('loginStatus').textContent = '⚠️ ' + err;
          document.getElementById('loginStatus').classList.add('error');
          return;
        }
        // Успешная авторизация - сохранить pendingText и перезагрузить страницу
        if (pendingText) {
          try { sessionStorage.setItem('webchat_pending_text', pendingText); } catch(_e) {}
        }
        window.location.reload();
      } catch (e) {
        document.getElementById('loginStatus').textContent = '⚠️ Network error';
        document.getElementById('loginStatus').classList.add('error');
      }
    }

	    const messagesEl = document.getElementById('messages');
	    const meEl = document.getElementById('me');
	    const form = document.getElementById('form');
	    const input = document.getElementById('input');
	    const sendBtn = document.getElementById('sendBtn');
	    const menuBtn = document.getElementById('menuBtn');
	    const menu = document.getElementById('menu');
	    const themeToggle = document.getElementById('themeToggle');
    const loginBtn = document.getElementById('loginBtn');
	    const loginModal = document.getElementById('loginModal');
	    const loginStatus = document.getElementById('loginStatus');
	    const loginTitle = document.getElementById('loginTitle');
	    const loginSubtitle = document.getElementById('loginSubtitle');
	    const loginCancel = document.getElementById('loginCancel');
    const introOverlay = document.getElementById('introOverlay');
    const introStack = document.getElementById('introStack');
    const introViewExamplesBtn = document.getElementById('introViewExamplesBtn');
    const introSkipBtn = document.getElementById('introSkipBtn');

	    // --- i18n: client-side language switching ---
	    const _i18nStrings = {
	      en: {
	        send: 'Send',
	        loginBtnText: 'Login',
	        loginTitle: 'Continue',
	        loginSubtitle: 'Sign in with Google to continue. You can return to this dialog later.',
	        cancel: 'Cancel',
	        placeholder: 'Type a message... (try: /start)',
	        langToggle: '🌐 English',
	        networkError: 'Network error',
	        working: 'Working...',
	        failed: 'Failed',
	        deleted: '[deleted]',
	        showcases: 'Showcases',
	        profile: 'Profile',
	        logout: 'Logout',
	        clearHistoryFailed: 'Failed to clear history before auto prompt',
          introTitle: 'Simple way to build dashboards',
          introSubtitle: 'Explore ready examples and launch your own version in one click.',
          introViewExamples: 'View examples',
          introSkip: 'Skip',
          introMeta: 'Shown only on first visit.',
	      },
	      ru: {
	        send: 'Отправить',
	        loginBtnText: 'Войти',
	        loginTitle: 'Продолжить',
	        loginSubtitle: 'Войдите через Google, чтобы продолжить. Вы сможете вернуться к диалогу позже.',
	        cancel: 'Отмена',
	        placeholder: 'Напишите сообщение... (например: /start)',
	        langToggle: '🌐 Русский',
	        networkError: 'Ошибка сети',
	        working: 'Подождите...',
	        failed: 'Ошибка',
	        deleted: '[удалено]',
	        showcases: 'Витрина',
	        profile: 'Профиль',
	        logout: 'Выход',
	        clearHistoryFailed: 'Не удалось очистить историю',
          introTitle: 'Простой способ создавать дашборды',
          introSubtitle: 'Смотрите готовые примеры и сразу запускайте свой вариант.',
          introViewExamples: 'Смотреть примеры',
          introSkip: 'Skip',
          introMeta: 'Экран показывается только при первом входе.',
	      }
	    };
	    let _uiLang = 'en';

	    function detectUiLang() {
	      try {
	        var stored = localStorage.getItem('webchat_lang');
	        if (stored === 'ru' || stored === 'en') return stored;
	      } catch (_e) {}
	      try {
	        var nav = (navigator.language || '').toLowerCase();
	        if (nav.startsWith('ru')) return 'ru';
	      } catch (_e) {}
	      // Fallback: check ?lang= URL param (explicit override)
	      try {
	        var urlLang = new URLSearchParams(window.location.search).get('lang');
	        if (urlLang === 'ru' || urlLang === 'en') return urlLang;
	      } catch (_e) {}
	      return 'en';
	    }

	    function tt(key) {
	      var s = _i18nStrings[_uiLang] || _i18nStrings['en'];
	      return s[key] || (_i18nStrings['en'][key] || key);
	    }

	    function rateLimitMsg(seconds) {
	      return _uiLang === 'ru'
	        ? 'Слишком много запросов. Попробуйте через ' + seconds + ' сек.'
	        : 'Too many requests. Try again in ' + seconds + ' sec.';
	    }

	    function applyUiLang(lang) {
	      _uiLang = (lang === 'ru') ? 'ru' : 'en';
	      try { localStorage.setItem('webchat_lang', _uiLang); } catch (_e) {}
	      if (sendBtn) sendBtn.textContent = tt('send');
	      if (loginBtn) loginBtn.textContent = tt('loginBtnText');
	      if (input) input.placeholder = tt('placeholder');
	      if (loginTitle) loginTitle.textContent = tt('loginTitle');
	      if (loginSubtitle) loginSubtitle.textContent = tt('loginSubtitle');
	      if (loginCancel) loginCancel.textContent = tt('cancel');
	      var langEl = document.getElementById('langToggle');
	      if (langEl) langEl.textContent = tt('langToggle');
        var introTitleEl = document.getElementById('introTitle');
        var introSubtitleEl = document.getElementById('introSubtitle');
        var introViewExamplesEl = document.getElementById('introViewExamplesBtn');
        var introSkipEl = document.getElementById('introSkipBtn');
        var introMetaEl = document.getElementById('introMeta');
        if (introTitleEl) introTitleEl.textContent = tt('introTitle');
        if (introSubtitleEl) introSubtitleEl.textContent = tt('introSubtitle');
        if (introViewExamplesEl) introViewExamplesEl.textContent = tt('introViewExamples');
        if (introSkipEl) introSkipEl.textContent = tt('introSkip');
        if (introMetaEl) introMetaEl.textContent = tt('introMeta');
	      var menuEl = document.getElementById('menu');
	      if (menuEl) {
	        var links = menuEl.querySelectorAll('a');
	        for (var i = 0; i < links.length; i++) {
	          var href = links[i].getAttribute('href');
	          if (href === '/showcases' || (href && href.indexOf('/showcases?') === 0)) {
              links[i].textContent = tt('showcases');
              links[i].setAttribute('href', buildShowcasesUrlForUi('examples'));
            }
	          if (href === '/profile') links[i].textContent = tt('profile');
	          if (href === '/logout') links[i].textContent = tt('logout');
	        }
	      }
	    }

	    function browserIsRussian() {
	      try {
	        var nav = (navigator.language || '').toLowerCase();
	        if (nav.startsWith('ru')) return true;
	      } catch (_e) {}
	      // Also check ?lang=ru URL param (e.g. from Chrome extension)
	      try {
	        var urlLang = new URLSearchParams(window.location.search).get('lang');
	        if (urlLang === 'ru') return true;
	      } catch (_e) {}
	      return false;
	    }

	    function initUiLang() {
	      if (browserIsRussian()) {
	        _uiLang = detectUiLang();
	        applyUiLang(_uiLang);
	        var langEl = document.getElementById('langToggle');
	        var langSep = document.getElementById('langSep');
	        if (langEl) langEl.style.display = '';
	        if (langSep) langSep.style.display = '';
	      }
	    }
	    // --- end i18n ---

	    let authed = false;
	    let sse = null;
	    let pendingText = null;
	    let boot = null;
	    let pollTimer = null;
	    const queryParams = new URLSearchParams(window.location.search);
      const simpleDashboardUi = ${isSimpleDashboardUi ? 'true' : 'false'};
      const INTRO_STORAGE_KEY = 'simpledashboard_intro_seen_v1';
	    // CHANGE: Read ?start param from URL to support deep-link welcome messages (e.g. ?start=crm)
	    // WHY: User request "в веб версии тоже пусть работает" (start=crm welcome message)
	    // REF: User message 2026-02-10
	    const startParam = queryParams.get('start') || '';
	    // CHANGE: Support ?prompt=... auto-send for localhost preview/dev flows
	    // WHY: User request "сделай чтоб промпт можно было передавать через ?prompt= ... и он сразу отправляется"
	    // REF: User message 2026-02-17
	    const promptParam = (queryParams.get('prompt') || '').trim().slice(0, 8000);
      const extIdParam = sanitizeExtensionId(queryParams.get('ext_id') || '');
	    const isLocalhostHost = ['localhost', '127.0.0.1', '::1'].includes(String(window.location.hostname || '').toLowerCase());
	    let autoPromptSubmitted = false;
	    let autoPromptHistoryCleared = false;
	    let pollIntervalMs = 0;
	    let pollInFlight = false;
	    let sseHealthy = false;
	    let pendingRunDurations = [];
	    let localUiMsgId = -1;

	    const POLL_FAST_MS = 1500;
	    const POLL_SLOW_MS = 5000;
      const INTRO_SCREENSHOT_SPECS = [
        {
          elementId: 'introShotA',
          extensionAssetName: 'construction-crm.png',
          fallbackUrl: '/showcases/extension-assets/screenshots/screenshot-1-construction-crm-1280x800.png',
        },
        {
          elementId: 'introShotB',
          extensionAssetName: 'sales-utm.png',
          fallbackUrl: '/showcases/extension-assets/screenshots/screenshot-2-sales-utm-1280x800.png',
        },
        {
          elementId: 'introShotC',
          extensionAssetName: 'funnel-analytics.png',
          fallbackUrl: '/showcases/extension-assets/screenshots/screenshot-3-funnel-analytics-1280x800.png',
        },
      ];

      function sanitizeExtensionId(rawValue) {
        var v = String(rawValue || '').trim().toLowerCase();
        return /^[a-z]{32}$/.test(v) ? v : '';
      }

      function buildShowcasesUrlForUi(startValue) {
        try {
          var url = new URL('/showcases/', window.location.origin);
          if (extIdParam) url.searchParams.set('ext_id', extIdParam);
          if (startValue) url.searchParams.set('start', String(startValue));
          return url.toString();
        } catch (_e) {
          return '/showcases/';
        }
      }

      function openShowcasesOutsideSidebar(startValue) {
        var showcasesUrl = buildShowcasesUrlForUi(startValue || 'examples');
        var inIframe = false;
        try { inIframe = window.parent !== window; } catch (_e) { inIframe = true; }
        if (inIframe) {
          try {
            window.parent.postMessage({ type: 'open_showcases', url: showcasesUrl }, '*');
            return;
          } catch (_e) {}
        }
        try {
          window.open(showcasesUrl, '_blank', 'noopener');
          return;
        } catch (_e) {}
        window.location.href = showcasesUrl;
      }

      function buildIntroScreenshotCandidates(spec) {
        var urls = [];
        if (extIdParam && spec && spec.extensionAssetName) {
          urls.push('chrome-extension://' + extIdParam + '/onboarding-screenshots/' + spec.extensionAssetName);
        }
        if (spec && spec.fallbackUrl) urls.push(spec.fallbackUrl);
        return urls;
      }

      function setImageSrcWithFallback(imgEl, srcCandidates) {
        if (!imgEl) return;
        if (!Array.isArray(srcCandidates) || srcCandidates.length === 0) return;
        var index = 0;
        var trySet = function() {
          var nextSrc = srcCandidates[index];
          if (!nextSrc) return;
          imgEl.src = nextSrc;
        };
        var onError = function() {
          index += 1;
          if (index >= srcCandidates.length) {
            imgEl.removeEventListener('error', onError);
            return;
          }
          trySet();
        };
        imgEl.addEventListener('error', onError);
        trySet();
      }

      function setupIntroScreenshots() {
        for (var i = 0; i < INTRO_SCREENSHOT_SPECS.length; i++) {
          var spec = INTRO_SCREENSHOT_SPECS[i];
          var imgEl = document.getElementById(spec.elementId);
          if (!imgEl) continue;
          setImageSrcWithFallback(imgEl, buildIntroScreenshotCandidates(spec));
        }
      }

      function setupIntroPointerMotion() {
        if (!introStack) return;
        var reset = function() {
          introStack.style.setProperty('--pointer-x', '0');
          introStack.style.setProperty('--pointer-y', '0');
        };
        var onPointerMove = function(e) {
          if (!e || e.pointerType === 'touch') return;
          var rect = introStack.getBoundingClientRect();
          if (!rect || !rect.width || !rect.height) return;
          var relX = (e.clientX - rect.left) / rect.width;
          var relY = (e.clientY - rect.top) / rect.height;
          var pointerX = Math.max(-1, Math.min(1, (relX - 0.5) * 2));
          var pointerY = Math.max(-1, Math.min(1, (relY - 0.5) * 2));
          introStack.style.setProperty('--pointer-x', pointerX.toFixed(3));
          introStack.style.setProperty('--pointer-y', pointerY.toFixed(3));
        };
        introStack.addEventListener('pointermove', onPointerMove);
        introStack.addEventListener('pointerleave', reset);
        introStack.addEventListener('pointercancel', reset);
        reset();
      }

      function closeIntroOverlay(markSeen) {
        if (!introOverlay) return;
        introOverlay.classList.remove('open');
        introOverlay.setAttribute('aria-hidden', 'true');
        if (markSeen) {
          try { localStorage.setItem(INTRO_STORAGE_KEY, '1'); } catch (_e) {}
        }
      }

      function shouldShowIntroOverlay() {
        if (!simpleDashboardUi) return false;
        if (!introOverlay) return false;
        if (promptParam) return false;
        if (startParam) return false;
        try {
          if (localStorage.getItem(INTRO_STORAGE_KEY) === '1') return false;
        } catch (_e) {}
        return true;
      }

      function setupIntroOverlay() {
        if (!introOverlay) return;
        setupIntroScreenshots();
        setupIntroPointerMotion();
        if (introViewExamplesBtn) {
          introViewExamplesBtn.addEventListener('click', function() {
            closeIntroOverlay(true);
            openShowcasesOutsideSidebar('examples');
          });
        }
        if (introSkipBtn) {
          introSkipBtn.addEventListener('click', function() {
            closeIntroOverlay(true);
            input.focus();
          });
        }
        document.addEventListener('keydown', function(e) {
          if (e.key !== 'Escape') return;
          if (!introOverlay.classList.contains('open')) return;
          closeIntroOverlay(true);
        });
        if (shouldShowIntroOverlay()) {
          introOverlay.classList.add('open');
          introOverlay.setAttribute('aria-hidden', 'false');
        }
      }

	    function showLocalSystem(text) {
	      try {
	        localUiMsgId -= 1;
	        const msg = { id: localUiMsgId, role: 'system', text: String(text || ''), createdAt: new Date().toISOString() };
	        renderMessage(msg);
	        scrollToBottom();
	      } catch (_e) {}
	    }

	    function showFeedbackRef(ref) {
	      try {
	        // Remove previous toast if any
	        var old = document.getElementById('feedbackRefToast');
	        if (old) old.remove();

	        var toast = document.createElement('div');
	        toast.id = 'feedbackRefToast';
	        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
	          'background:#1e293b;color:#f8fafc;border-radius:10px;padding:12px 16px;' +
	          'font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4);' +
	          'max-width:320px;text-align:center;line-height:1.5;';

	        var refText = 'FB-' + ref.toUpperCase();
	        var copyText = 'Фидбек ' + refText + ' — найди в feedback_log.jsonl по полю ref';
	        toast.innerHTML =
	          '<div style="margin-bottom:6px">📋 Номер фидбека для поддержки:</div>' +
	          '<code style="font-size:15px;font-weight:700;letter-spacing:1px">' + refText + '</code>' +
	          '<div style="margin-top:8px;display:flex;gap:8px;justify-content:center">' +
	          '<button id="fbRefCopyBtn" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px">Скопировать</button>' +
	          '<button id="fbRefCloseBtn" style="background:#475569;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px">✕</button>' +
	          '</div>';

	        document.body.appendChild(toast);

	        document.getElementById('fbRefCopyBtn').addEventListener('click', function() {
	          navigator.clipboard.writeText(copyText).then(function() {
	            document.getElementById('fbRefCopyBtn').textContent = 'Скопировано ✓';
	            setTimeout(function() { toast.remove(); }, 1500);
	          }).catch(function() {
	            // fallback
	            var ta = document.createElement('textarea');
	            ta.value = refText;
	            document.body.appendChild(ta);
	            ta.select();
	            document.execCommand('copy');
	            ta.remove();
	            document.getElementById('fbRefCopyBtn').textContent = 'Скопировано ✓';
	            setTimeout(function() { toast.remove(); }, 1500);
	          });
	        });

	        document.getElementById('fbRefCloseBtn').addEventListener('click', function() {
	          toast.remove();
	        });

	        // Auto-dismiss after 30 seconds
	        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 30000);
	      } catch (_e) {}
	    }

	    function applyTheme(theme) {
	      const t = (theme === 'dark') ? 'dark' : 'light';
	      document.body.classList.toggle('theme-dark', t === 'dark');
	      try { localStorage.setItem('webchat_theme', t); } catch (_e) {}
	      try {
	        const icon = document.getElementById('themeIcon');
	        if (icon) {
	          icon.textContent = t === 'dark' ? '🌙' : '☀️';
	        }
	      } catch (_e) {}
	    }

	    function initTheme() {
	      let t = 'light';
	      try {
	        const stored = String(localStorage.getItem('webchat_theme') || '').toLowerCase();
	        if (stored === 'dark' || stored === 'light') t = stored;
	      } catch (_e) {}
	      applyTheme(t);
	    }

	    function nowIso() {
	      return new Date().toISOString();
	    }

	    function parseIsoMs(iso) {
	      if (!iso) return NaN;
	      const ms = Date.parse(iso);
	      return Number.isFinite(ms) ? ms : NaN;
	    }

	    function formatClock(iso) {
	      const ms = parseIsoMs(iso);
	      if (!Number.isFinite(ms)) return iso || '';
	      const d = new Date(ms);
	      const hh = String(d.getHours()).padStart(2, '0');
	      const mm = String(d.getMinutes()).padStart(2, '0');
	      return hh + ':' + mm;
	    }

	    function formatDurationMs(ms) {
	      if (!Number.isFinite(ms)) return '';
	      const sec = Math.max(0, Math.floor(ms / 1000));
	      if (sec < 60) return sec + 's';
	      const min = Math.floor(sec / 60);
	      const remS = sec % 60;
	      if (min < 60) return min + 'm ' + String(remS).padStart(2, '0') + 's';
	      const hr = Math.floor(min / 60);
	      const remM = min % 60;
	      if (hr < 24) return hr + 'h ' + String(remM).padStart(2, '0') + 'm';
	      const day = Math.floor(hr / 24);
	      const remH = hr % 24;
	      return day + 'd ' + String(remH).padStart(2, '0') + 'h';
	    }

	    function isStatusMessage(msg) {
	      if (!msg || msg.role !== 'assistant') return false;
	      const text = String(msg.text || '').trim();
	      if (!text) return false;
	      if (!text.startsWith('⏳')) return false;
	      // Heuristic: our execution status messages always include a prompt marker.
	      const lower = text.toLowerCase();
	      return lower.includes('промпт:') || lower.includes('prompt:') || text.includes('📝');
	    }

	    function decorateTimers(messages) {
	      // Computes per-request duration for the first assistant message AFTER a deleted status bubble.
	      // This lets us show:
	      // - running timer on the status bubble
	      // - fixed duration on the final assistant reply
	      try {
	        let pendingDuration = null;

	        for (const m of messages || []) {
	          if (!m || typeof m !== 'object') continue;
	          if (m._ui) delete m._ui;
	        }

	        for (const m of messages || []) {
	          if (!m || typeof m !== 'object') continue;

	          if (m.deletedAt && isStatusMessage(m)) {
	            const start = parseIsoMs(m.createdAt || '');
	            const end = parseIsoMs(m.deletedAt || '');
	            const dur = end - start;
	            pendingDuration = (Number.isFinite(dur) && dur >= 0) ? dur : null;
	            continue;
	          }

	          if (pendingDuration != null && m.role === 'assistant' && !m.deletedAt) {
	            m._ui = { durationMs: pendingDuration };
	            pendingDuration = null;
	          }
	        }
	      } catch (_e) {}
	    }

	    function updateTimers() {
	      try {
	        const nodes = document.querySelectorAll('.ts[data-mode=\"running\"][data-start]');
	        for (const n of nodes) {
	          const iso = n.dataset ? (n.dataset.start || '') : '';
	          const ms = parseIsoMs(iso);
	          if (!Number.isFinite(ms)) continue;
	          n.textContent = formatDurationMs(Date.now() - ms);
	        }
	      } catch (_e) {}
	    }

	    function scrollToBottom() {
	      requestAnimationFrame(() => {
	        messagesEl.scrollTop = messagesEl.scrollHeight + 999999;
	        // Messages can grow after render (fonts, async updates). Do a second pass.
	        setTimeout(() => {
	          messagesEl.scrollTop = messagesEl.scrollHeight + 999999;
	        }, 60);
	      });
	    }

	    function isNearBottom() {
	      const gap = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
	      // CHANGE: Reduced threshold from 420 to 80px
	      // WHY: 420px caused auto-scroll even when user scrolled up to read history
	      return gap < 80;
	    }

	    function autoResizeTextarea() {
	      // Grow/shrink the textarea to fit content up to CSS max-height.
	      try {
	        const style = window.getComputedStyle(input);
	        const maxH = parseFloat(style.maxHeight || '0') || 160;
	        input.style.height = 'auto';
	        const next = Math.min(input.scrollHeight || 0, maxH);
	        input.style.height = (next > 0 ? next : 62) + 'px';
	        input.style.overflowY = (input.scrollHeight > maxH) ? 'auto' : 'hidden';
	      } catch (_e) {}
	    }

    function renderInlineKeyboard(kbd, msgId) {
      if (!kbd || !kbd.inline_keyboard) return '';
      const rows = kbd.inline_keyboard || [];
      let html = '<div class="kbd">';
      for (const row of rows) {
        for (const btn of row) {
          const label = escapeHtml(btn.text || 'button');
          const data = btn.callback_data ? escapeHtml(btn.callback_data) : '';
          html += '<button type="button" data-msgid="' + msgId + '" data-cb="' + data + '">' + label + '</button>';
        }
      }
      html += '</div>';
      return html;
    }

    function renderFeedback(msg) {
      if (!msg || msg.role !== 'assistant' || msg.deletedAt) return '';
      const cur = msg.feedback && msg.feedback.type ? String(msg.feedback.type) : '';
      const upOn = cur === 'thumbs_up';
      const downOn = cur === 'thumbs_down';
      const upCls = 'fb-btn up' + (upOn ? ' on' : '');
      const downCls = 'fb-btn down' + (downOn ? ' on' : '');
      return '<span class="fb">' +
        '<button type="button" class="' + upCls + '" data-fb="thumbs_up" data-msgid="' + msg.id + '" title="Good answer">👍</button>' +
        '<button type="button" class="' + downCls + '" data-fb="thumbs_down" data-msgid="' + msg.id + '" title="Bad answer">👎</button>' +
        '</span>';
    }

    function renderTextContent(text) {
      var escaped = escapeHtml(text || '');
      return escaped.replace(/(https?:\\/\\/[^\\s<]+)/g, function(url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
      });
    }

    function buildBubbleHtml(msg) {
      const content = renderTextContent(msg.text || '');
      const screenshotUrl = msg.extra && msg.extra.screenshotUrl ? msg.extra.screenshotUrl : null;
      const extra = msg.extra && msg.extra.reply_markup ? msg.extra.reply_markup : null;
      const createdAt = msg.createdAt || msg.updatedAt || '';
      const createdSafe = escapeHtml(createdAt || '');
      let tsText = escapeHtml(formatClock(createdAt));
      let tsTitle = createdSafe;
      let tsAttrs = ' data-mode="fixed" data-start=""';

      if (msg && msg.role === 'assistant' && msg._ui && typeof msg._ui.durationMs === 'number') {
        tsText = escapeHtml(formatDurationMs(msg._ui.durationMs));
        tsTitle = 'Request duration';
      } else if (isStatusMessage(msg)) {
        // Running request status bubble: show a live timer.
        tsText = escapeHtml(formatDurationMs(Date.now() - parseIsoMs(createdAt)));
        tsTitle = createdSafe;
        tsAttrs = ' data-mode="running" data-start="' + createdSafe + '"';
      }

      const screenshotHtml = screenshotUrl ? '<img class="msg-screenshot" src="' + screenshotUrl + '?t=' + Date.now() + '" alt="screenshot" />' : '';
      const fb = renderFeedback(msg);
      return '<div class="text">' + content + '</div>' + screenshotHtml +
        renderInlineKeyboard(extra, msg.id) +
        '<div class="meta"><span>#' + msg.id + '</span><span class="meta-right"><span class="ts"' + tsAttrs + ' title="' + escapeHtml(tsTitle) + '">' + tsText + '</span>' + fb + '</span></div>';
    }

    function renderMessage(msg) {
      const row = document.createElement('div');
      row.className = 'row ' + (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'assistant'));

      const bubble = document.createElement('div');
      bubble.className = 'bubble ' + (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'));
      bubble.dataset.msgid = msg.id;
      bubble.dataset.kind = isStatusMessage(msg) ? 'status' : (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'));
      bubble.innerHTML = buildBubbleHtml(msg);

      row.appendChild(bubble);
      messagesEl.appendChild(row);
      updateTimers();
    }

    function upsertMessage(msg) {
      if (!msg || !msg.id) return;
      const bubble = messagesEl.querySelector('.bubble[data-msgid=\"' + msg.id + '\"]');
      if (!bubble) {
        renderMessage(msg);
        return;
      }
      bubble.className = 'bubble ' + (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'));
      bubble.dataset.kind = isStatusMessage(msg) ? 'status' : (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'));
      bubble.innerHTML = buildBubbleHtml(msg);
      updateTimers();
    }

    function updateMessage(id, text, createdAt) {
      const bubble = messagesEl.querySelector('.bubble[data-msgid=\"' + id + '\"]');
      if (!bubble) return;
      const fake = { id, role: 'assistant', text: text || '', createdAt: createdAt || '' };
      bubble.innerHTML = buildBubbleHtml(fake);
      updateTimers();
    }

    function markDeleted(id) {
      const bubble = messagesEl.querySelector('.bubble[data-msgid=\"' + id + '\"]');
      if (!bubble) return;
      // Status bubbles are transient by design: on completion we delete them server-side,
      // so in the UI we simply remove the bubble (instead of rendering a confusing "[deleted]" stub).
      const kind = bubble.dataset ? (bubble.dataset.kind || '') : '';
      const text = (bubble.innerText || '').trim();
      if (kind === 'status' || text.startsWith('⏳')) {
        const row = bubble.closest ? bubble.closest('.row') : null;
        if (row && row.remove) row.remove();
        else if (bubble.remove) bubble.remove();
        return;
      }
      bubble.classList.add('system');
      bubble.innerHTML = '<div class="text">[deleted]</div>' +
        '<div class="meta"><span>#' + id + '</span><span class="ts" data-mode="fixed" data-start="" title=""></span></div>';
      updateTimers();
    }

	    function mergeHistory(messages) {
	      decorateTimers(messages);
	      const shouldScroll = isNearBottom();
	      for (const m of messages || []) {
	        if (!m || !m.id) continue;
	        if (m.deletedAt) {
	          markDeleted(m.id);
	          continue;
	        }
	        upsertMessage(m);
	      }

	      // CHANGE: Notify parent (Chrome extension) when index.html is created
	      // WHY: Auto-open preview tab when user creates landing page
	      // REF: User message 2026-02-18
	      notifyExtensionOnFileCreated(messages);
	      if (shouldScroll) scrollToBottom();
	    }

	    // CHANGE: Track last message ID that triggered preview open — prevents infinite tab opening
	    // WHY: renderMessages is called on every poll, without dedup each poll reopens a new tab
	    var _lastPreviewNotifyMsgId = null;

	    function notifyExtensionOnFileCreated(messages) {
	      try {
	        if (!window.parent || window.parent === window) return;
	        const helper = window.WebchatSidebarShared;
	        if (!helper || typeof helper.buildFileCreatedMessageFromHistory !== 'function') return;
	        const lastMsg = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
	        if (!lastMsg) return;
	        if (lastMsg.id != null && lastMsg.id === _lastPreviewNotifyMsgId) return;
	        const eventPayload = helper.buildFileCreatedMessageFromHistory(messages, window.__WEBCHAT_USER_ID__ || '');
	        if (!eventPayload) return;
	        _lastPreviewNotifyMsgId = lastMsg.id;
	        window.parent.postMessage(eventPayload, "*");
	      } catch (_e) {}
	    }

	    // CHANGE: Add keypair generation flow for dashboard Web3 auth
	    // WHY: Webchat needs OWNER_ADDRESS to embed in generated index.html for auth-enabled dashboards
	    // REF: tech-spec Task 6, user-spec AC24

	    // Registry for pending postMessage requests to the extension (keyed by requestId)
	    var pendingExtensionRequests = new Map();

	    // Get the parent origin for postMessage (explicit, not wildcard '*')
	    function getExtensionTargetOrigin() {
	      // CHANGE: Use '*' — the parent is chrome-extension://<id> (NOT the webchat origin).
	      // postMessage with targetOrigin=window.location.origin silently drops all messages
	      // because the extension panel's origin is chrome-extension://, not https://...
	      // Using '*' is safe: messages contain no secrets and only the extension panel handles them.
	      return '*';
	    }

	    // Send a generate_keypair request to the extension and wait for the response.
	    // Returns a Promise that resolves with { address, privateKey } or rejects on timeout/error.
	    function requestKeypairFromExtension(requestId) {
	      return new Promise(function(resolve, reject) {
	        if (!window.parent || window.parent === window) {
	          reject(new Error('Not in iframe context — extension not available'));
	          return;
	        }

	        var timeoutMs = 10000;
	        var timer = setTimeout(function() {
	          pendingExtensionRequests.delete(requestId);
	          reject(new Error('Extension response timeout (10s)'));
	        }, timeoutMs);

	        pendingExtensionRequests.set(requestId, { resolve: resolve, reject: reject, timer: timer });

	        try {
	          var targetOrigin = getExtensionTargetOrigin();
	          window.parent.postMessage({ type: 'generate_keypair', requestId: requestId }, targetOrigin);
	        } catch (err) {
	          clearTimeout(timer);
	          pendingExtensionRequests.delete(requestId);
	          reject(err);
	        }
	      });
	    }

	    // High-level flow: request keypair from extension, then register with Auth API.
	    // Returns address string on success, or null on failure (graceful degradation).
	    async function triggerKeypairFlow(email, dashboardId) {
	      try {
	        var requestId = 'kp_' + Math.random().toString(36).slice(2) + '_' + Date.now();
	        var keypair = await requestKeypairFromExtension(requestId);

	        if (!keypair || !keypair.address || !keypair.privateKey) {
	          console.warn('[webchat] Extension returned incomplete keypair data');
	          return null;
	        }

	        // Register owner with Auth API via server-side proxy
	        var resp = await fetch('/api/auth/register-owner', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({
	            address: keypair.address,
	            privateKey: keypair.privateKey,
	            email: email,
	            dashboardId: dashboardId,
	          }),
	        });

	        if (resp.ok) {
	          var data = await resp.json();
	          console.log('[webchat] Owner registered: address=' + (data.address || keypair.address));
	          return data.address || keypair.address;
	        }

	        // 409 = already registered — treat as success if address known
	        if (resp.status === 409) {
	          console.log('[webchat] Owner already registered (409), using known address');
	          return keypair.address;
	        }

	        var errBody = {};
	        try { errBody = await resp.json(); } catch (_e) {}
	        console.warn('[webchat] register-owner failed: status=' + resp.status, errBody);
	        return null;
	      } catch (err) {
	        // Graceful degradation: keypair flow is optional (used for Web3 owner auth).
	        // Log to console but do not show a confusing error in chat — dashboard works without it.
	        console.warn('[webchat] Keypair flow failed (graceful degradation):', err && err.message ? err.message : err);
	        return null;
	      }
	    }

	    // CHANGE: Request dashboard context (screenshot + URL) from extension before each message
	    // WHY: User is on d*.wpmix.net and wants Claude to see current page state
	    // REF: User request 2026-03-03
	    function requestDashboardContextFromExtension() {
	      return new Promise(function(resolve) {
	        if (!window.parent || window.parent === window) { resolve(null); return; }

	        var tiReqId = 'dti_' + Math.random().toString(36).slice(2) + '_' + Date.now();
	        var tiTimer = setTimeout(function() {
	          pendingExtensionRequests.delete(tiReqId);
	          resolve(null);
	        }, 3000);

	        pendingExtensionRequests.set(tiReqId, {
	          resolve: function(tabData) {
	            clearTimeout(tiTimer);
	            var url = tabData && tabData.url ? String(tabData.url) : '';
	            // Any URL allowed — user explicitly enabled screenshot checkbox

	            var ssReqId = 'dss_' + Math.random().toString(36).slice(2) + '_' + Date.now();
	            var ssTimer = setTimeout(function() {
	              pendingExtensionRequests.delete(ssReqId);
	              resolve({ url: url, screenshot: null });
	            }, 5000);

	            pendingExtensionRequests.set(ssReqId, {
	              resolve: function(ssData) {
	                clearTimeout(ssTimer);
	                resolve({ url: url, screenshot: ssData && ssData.screenshot ? ssData.screenshot : null });
	              },
	              reject: function() { clearTimeout(ssTimer); resolve({ url: url, screenshot: null }); },
	              timer: ssTimer
	            });

	            try {
	              window.parent.postMessage({ type: 'capture_screenshot', requestId: ssReqId }, getExtensionTargetOrigin());
	            } catch (_e) {
	              clearTimeout(ssTimer);
	              pendingExtensionRequests.delete(ssReqId);
	              resolve({ url: url, screenshot: null });
	            }
	          },
	          reject: function() { clearTimeout(tiTimer); resolve(null); },
	          timer: tiTimer
	        });

	        try {
	          window.parent.postMessage({ type: 'get_tab_info', requestId: tiReqId }, getExtensionTargetOrigin());
	        } catch (_e) {
	          clearTimeout(tiTimer);
	          pendingExtensionRequests.delete(tiReqId);
	          resolve(null);
	        }
	      });
	    }

	    function updateMenuVisibility() {
	      // CHANGE: Hide logout/profile links when not authenticated
	      // WHY: User request "не показывайй logout если не залогинен чел"
	      // REF: User message 2026-02-18
	      const menuEl = document.getElementById('menu');
	      if (!menuEl) return;

	      const links = menuEl.querySelectorAll('a[href="/profile"], a[href="/logout"]');
	      for (const link of links) {
	        if (authed) {
	          link.style.display = '';
	        } else {
	          link.style.display = 'none';
	        }
	      }

	      // Show/hide login button
	      if (loginBtn) {
	        if (authed) {
	          loginBtn.style.display = 'none';
	        } else {
	          loginBtn.style.display = '';
	        }
	      }
	    }

	    async function loadMeAndHistory() {
	      const meResp = await fetch('/api/me');
	      if (!meResp.ok) {
	        authed = false;
	        meEl.textContent = '';
	        updateMenuVisibility();
	        return false;
	      }
	      const me = await meResp.json();
	      authed = true;
	      sseHealthy = false;
	      meEl.textContent = me && me.user ? ('Signed in as ' + me.user.nickname + ' (' + me.user.email + ')') : '';

	      // CHANGE: Update subtitle to show user domain
	      // WHY: User request "домен юзера показывай сверху вместо 'AI Assistant' строки"
	      // REF: User message 2026-02-17

	      // Store userId for extension postMessage
	      if (me && me.user && me.user.userId) {
	        window.__WEBCHAT_USER_ID__ = String(me.user.userId);
	      }

	      // CHANGE: Trigger keypair flow for SimpleDashboard to get Ethereum owner address
	      // WHY: CLAUDE.md.template uses OWNER_ADDRESS from context for auth-enabled dashboards
	      // REF: dashboard-web3-auth feature
	      if (simpleDashboardUi && me && me.user && me.user.userId) {
	        triggerKeypairFlow(me.user.email, 'd' + me.user.userId)
	          .then(function(addr) {
	            if (addr) {
	              window.__OWNER_ADDRESS__ = addr;
	              console.log('[webchat] Owner address stored: ' + addr);
	            }
	          })
	          .catch(function(err) {
	            console.warn('[webchat] triggerKeypairFlow error:', err);
	          });
	      }

	      const botSubtitleEl = document.getElementById('botSubtitle');
	      if (botSubtitleEl && me && me.user && me.user.userId) {
	        var dashUrl = 'https://d' + me.user.userId + '.wpmix.net';
	        var dashLink = document.createElement('a');
	        dashLink.href = dashUrl;
	        dashLink.textContent = 'd' + me.user.userId + '.wpmix.net';
	        // In extension: open in main tab via postMessage; otherwise open in new tab
	        if (extIdParam) {
	          dashLink.addEventListener('click', function(e) {
	            e.preventDefault();
	            window.parent.postMessage({ type: 'open_url', url: dashUrl }, '*');
	          });
	        } else {
	          dashLink.target = '_blank';
	          dashLink.rel = 'noopener noreferrer';
	        }
	        dashLink.style.cssText = 'color:inherit;text-decoration:underline;text-decoration-style:dotted;opacity:0.7;';
	        botSubtitleEl.textContent = '';
	        botSubtitleEl.appendChild(dashLink);

	        // Show screenshot toggle only when we're inside the extension (viewing the dashboard)
	        var ssToggleWrap = document.querySelector('.composer-extras');
	        if (ssToggleWrap) {
	          ssToggleWrap.style.display = extIdParam ? '' : 'none';
	        }
	      }

	      const hResp = await fetch('/api/history?lang=' + encodeURIComponent(_uiLang || 'en'));
	      const h = await hResp.json();
	      const messages = (h && h.messages) ? h.messages : [];
	      messagesEl.innerHTML = '';
	      mergeHistory(messages);
	      scrollToBottom();
	      updateMenuVisibility();
	      return true;
	    }

	    async function loadBootstrap() {
	      if (boot) return boot;
	      // CHANGE: pass startParam to bootstrap for CRM welcome message
	      // REF: User message 2026-02-10
	      var params = [];
	      if (startParam) params.push('start=' + encodeURIComponent(startParam));
        if (extIdParam) params.push('ext_id=' + encodeURIComponent(extIdParam));
	      // CHANGE: pass browser language to bootstrap so server returns correct i18n init message
	      var detectedLang = detectUiLang();
	      if (detectedLang) params.push('lang=' + encodeURIComponent(detectedLang));
	      const bootstrapUrl = params.length ? '/api/public/bootstrap?' + params.join('&') : '/api/public/bootstrap';
	      const resp = await fetch(bootstrapUrl);
	      const data = await resp.json();
	      boot = data;
	      return data;
	    }

	    async function renderGuest() {
	      const data = await loadBootstrap();
	      const startMessages = (data && data.startMessages) ? data.startMessages : [];
	      const title = data && data.title ? data.title : '';
	      const subtitle = data && data.subtitle ? data.subtitle : '';
	      const lang = data && data.language ? data.language : 'en';
	      const isLocalhost = data && data.isLocalhost ? data.isLocalhost : false;
	      meEl.textContent = '';

	      messagesEl.innerHTML = '';
	      for (const m of startMessages) {
	        renderMessage(m);
	      }
	      scrollToBottom();

	      // CHANGE: Skip login modal for localhost connections
	      // WHY: User request "если мы заходим с локалхоста то не спрашивать емейл и пропускать онбоардинг"
	      // REF: User message 2026-02-17
	      if (isLocalhost) {
	        meEl.textContent = 'Localhost Dev Mode';
	        authed = true;
	        await loadMeAndHistory();
	        return true;
	      }

	      // Language-specific UI is handled by initUiLang() / applyUiLang()
	      return true;
	    }

	    function setupMenu() {
        var baseShowcasesUrl = buildShowcasesUrlForUi('examples');
        var showcasesAnchors = menu.querySelectorAll('a[href="/showcases"], a[href^="/showcases?"]');
        for (var i = 0; i < showcasesAnchors.length; i++) {
          showcasesAnchors[i].setAttribute('href', baseShowcasesUrl);
        }

	      function closeMenu() { menu.classList.remove('open'); }
	      function toggleMenu() { menu.classList.toggle('open'); }
	      menuBtn.addEventListener('click', (e) => {
	        e.preventDefault();
	        e.stopPropagation();
	        toggleMenu();
	      });
	      document.addEventListener('click', () => closeMenu());
	      document.addEventListener('keydown', (e) => {
	        if (e.key === 'Escape') closeMenu();
	      });
	      menu.addEventListener('click', (e) => e.stopPropagation());
	    }

	    function openLoginModal() {
	      loginStatus.classList.remove('error');
	      loginStatus.textContent = '';
	      loginModal.classList.add('open');
	    }

	    function closeLoginModal() {
	      loginModal.classList.remove('open');
	      input.focus();
	    }

	    async function ensureAuthedViaModal() {
	      openLoginModal();
	    }

	    async function clearHistoryForAutoPrompt() {
	      if (autoPromptHistoryCleared) return true;
	      if (!isLocalhostHost) return false;
	      if (!authed) return false;
	      if (!promptParam) return false;

	      autoPromptHistoryCleared = true;
	      try {
	        const resp = await fetch('/api/history/clear', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	        });
	        if (!resp.ok) {
	          let data = null;
	          try { data = await resp.json(); } catch (_e) {}
	          
          // CHANGE: Show user-friendly rate limit message
          // WHY: User request "пусть юзеру отдается rate limit просто а не висит человек"
          // REF: User message 2026-02-19
          let err;
          if (resp.status === 429) {
            const retryAfter = data && typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
            err = rateLimitMsg(retryAfter);
          } else {
            err = (data && data.error) ? data.error : ('Request failed (' + resp.status + ')');
          }
	          showLocalSystem('⚠️ ' + err);
	          return false;
	        }
	        messagesEl.innerHTML = '';
	        return true;
	      } catch (_e) {
	        showLocalSystem('⚠️ ' + tt('clearHistoryFailed'));
	        return false;
	      }
	    }

	    async function maybeAutoSubmitPromptFromQuery() {
	      if (autoPromptSubmitted) return;
	      if (!isLocalhostHost) return;
	      if (!authed) return;
	      if (!promptParam) return;

	      const cleared = await clearHistoryForAutoPrompt();
	      if (!cleared) return;

	      autoPromptSubmitted = true;
	      input.value = promptParam;
	      autoResizeTextarea();
	      if (typeof form.requestSubmit === 'function') {
	        form.requestSubmit();
	        return;
	      }
	      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	    }

	    function maybeAutoFillPromptFromQuery() {
	      // CHANGE: Auto-fill input field from ?prompt= for non-localhost hosts
	      // WHY: User request "если передано ?prompt= то если это не локалхост то заполняй поле ввода"
	      // REF: User message 2026-02-18
	      if (autoPromptSubmitted) return;
	      if (isLocalhostHost) return; // Localhost uses auto-submit instead
	      if (!promptParam) return;

	      // XSS protection: text content is safe, textarea value setter escapes HTML
	      input.value = promptParam;
	      autoResizeTextarea();
	      // Don't focus to avoid interfering with login modal
	    }

	    async function pollOnce() {
	      if (!authed) return;
	      if (pollInFlight) return;
	      pollInFlight = true;
	      try {
	        const hResp = await fetch('/api/history', { cache: 'no-store' });
	        if (!hResp.ok) return;
	        const h = await hResp.json();
	        const messages = (h && h.messages) ? h.messages : [];
	        mergeHistory(messages);
	      } catch (_e) {
	      } finally {
	        pollInFlight = false;
	      }
	    }

	    function startPolling() {
	      const ms = POLL_SLOW_MS;
	      return startPollingWith(ms);
	    }

	    function startPollingWith(ms) {
	      const intervalMs = (typeof ms === 'number' && ms > 250) ? Math.floor(ms) : POLL_FAST_MS;
	      if (pollTimer && pollIntervalMs === intervalMs) return;
	      if (pollTimer) {
	        clearInterval(pollTimer);
	        pollTimer = null;
	      }
	      pollIntervalMs = intervalMs;
	      pollOnce();
	      pollTimer = setInterval(() => pollOnce(), intervalMs);
	    }

	    function ensureSlowPolling() { startPollingWith(POLL_SLOW_MS); }
	    function ensureFastPolling() { startPollingWith(POLL_FAST_MS); }

	    function setupSse() {
	      if (sse) return;
	      const es = new EventSource('/api/stream');
	      sse = es;
	      let gotAny = false;
	      let lastEventAt = Date.now();
	      function markAlive() {
	        gotAny = true;
	        sseHealthy = true;
	        lastEventAt = Date.now();
	        ensureSlowPolling();
	      }
	      const healthTimer = setTimeout(() => {
	        if (!gotAny) {
	          ensureFastPolling();
	        }
	      }, 1800);
	      // If we stop receiving events (common with buffered reverse proxies), keep UI alive with polling.
	      setInterval(() => {
	        if (!authed) return;
	        if (Date.now() - lastEventAt > 20000) {
	          ensureFastPolling();
	        }
	      }, 5000);
	      es.onopen = () => {};
	      es.addEventListener('message', (ev) => {
	        const data = JSON.parse(ev.data);
	        markAlive();
	        const shouldScroll = isNearBottom();
	        if (
	          pendingRunDurations.length &&
	          data &&
	          data.role === 'assistant' &&
	          !data.deletedAt &&
	          !isStatusMessage(data)
	        ) {
	          data._ui = { durationMs: pendingRunDurations.shift() };
	        }
	        upsertMessage(data);
	        if (shouldScroll) scrollToBottom();
	      });
      es.addEventListener('message_update', (ev) => {
        const data = JSON.parse(ev.data);
        markAlive();
        const shouldScroll = isNearBottom();
        upsertMessage(data);
        if (shouldScroll) scrollToBottom();
      });
      es.addEventListener('message_delete', (ev) => {
        const data = JSON.parse(ev.data);
        markAlive();
        const shouldScroll = isNearBottom();
	        if (data && data.role === 'assistant' && isStatusMessage(data)) {
	          const start = parseIsoMs(data.createdAt || '');
	          const end = parseIsoMs(data.deletedAt || '');
	          const dur = end - start;
	          if (Number.isFinite(dur) && dur >= 0) {
	            pendingRunDurations.push(dur);
	          }
	        }
        markDeleted(data.id);
        if (shouldScroll) scrollToBottom();
      });
	      es.addEventListener('ping', () => {
	        markAlive();
	      });
	      es.onerror = () => {
	        // If SSE fails or is blocked by a proxy, fall back to polling.
	        sseHealthy = false;
	        ensureFastPolling();
	        // Don't clear sse ref: EventSource auto-reconnects, and polling is safe as a fallback.
	      };
	    }

	    form.addEventListener('submit', async (e) => {
	      e.preventDefault();
	      const text = input.value.trim();
	      if (!text) return;
	      const shouldScroll = isNearBottom();
	      if (!authed) {
	        pendingText = text;
	        await ensureAuthedViaModal();
	        return;
	      }

	      input.value = '';
	      autoResizeTextarea();
	      sendBtn.disabled = true;
	      // CHANGE: Attach dashboard screenshot+URL if active tab is d*.wpmix.net
	      // WHY: Claude sees current dashboard state as context for each message
	      // REF: User request 2026-03-03
	      var dashCtx = null;
	      var screenshotEnabled = (function() {
	        var cb = document.getElementById('screenshotToggle');
	        return cb ? cb.checked : false;
	      })();
	      if (screenshotEnabled) {
	        var ssLabel = document.getElementById('screenshotToggleLabel');
	        var ssIcon = document.getElementById('screenshotToggleIcon');
	        var ssText = document.getElementById('screenshotToggleText');
	        if (ssLabel) ssLabel.classList.add('capturing');
	        if (ssIcon) ssIcon.innerHTML = '<span class="ss-spinner"></span>';
	        if (ssText) ssText.textContent = 'capturing…';
	        try { dashCtx = await requestDashboardContextFromExtension(); } catch (_e) {}
	        if (ssLabel) ssLabel.classList.remove('capturing');
	        if (ssIcon) ssIcon.textContent = '📷';
	        if (ssText) ssText.textContent = 'screenshot';
	      }
	      try {
	        var msgBody = { text: text, ownerAddress: window.__OWNER_ADDRESS__ || undefined };
	        if (dashCtx && dashCtx.url) {
	          msgBody.dashboardUrl = dashCtx.url;
	          if (dashCtx.screenshot) msgBody.dashboardScreenshot = dashCtx.screenshot;
	        }
	        const resp = await fetch('/api/message', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify(msgBody),
	        });
	        if (!resp.ok) {
	          let data = null;
	          try { data = await resp.json(); } catch (_e) {}
	          
          // CHANGE: Show user-friendly rate limit message
          // WHY: User request "пусть юзеру отдается rate limit просто а не висит человек"
          // REF: User message 2026-02-19
          let err;
          if (resp.status === 429) {
            const retryAfter = data && typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
            err = rateLimitMsg(retryAfter);
          } else {
            err = (data && data.error) ? data.error : ('Request failed (' + resp.status + ')');
          }
	          input.value = text;
	          autoResizeTextarea();
	          showLocalSystem('⚠️ ' + err);
	          return;
	        }
	        // Ensure UI is updated even when SSE is blocked/buffered by a reverse proxy.
	        await pollOnce();
	        // User just sent a message: always keep them at the bottom.
	        scrollToBottom();
	      } catch (_e) {
	        input.value = text;
	        autoResizeTextarea();
	        showLocalSystem('⚠️ ' + tt('networkError'));
	      } finally {
	        sendBtn.disabled = false;
	        input.focus();
	      }
	    });

	    // Enter sends, Ctrl+Enter / Shift+Enter inserts newline.
	    input.addEventListener('keydown', (e) => {
	      if (e.key !== 'Enter') return;
	      if (e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
	      e.preventDefault();
	      if (typeof form.requestSubmit === 'function') {
	        form.requestSubmit();
	      } else {
	        form.dispatchEvent(new Event('submit'));
	      }
	    });

	    input.addEventListener('input', () => autoResizeTextarea());
	    input.addEventListener('paste', () => setTimeout(() => autoResizeTextarea(), 0));

	    loginCancel.addEventListener('click', () => {
	      if (pendingText) {
	        input.value = pendingText;
	        autoResizeTextarea();
	      }
	      pendingText = null;
	      closeLoginModal();
	    });


    messagesEl.addEventListener('click', async (e) => {
      const target = e.target;
      const btn = target && target.closest ? target.closest('button') : target;
      if (!btn || !btn.dataset) return;
      const msgId = btn.dataset.msgid;
      const fb = btn.dataset.fb;

      if (fb && msgId) {
        let feedbackComment = '';
        if (fb === 'thumbs_down') {
          const userComment = window.prompt('Что не так с ответом? (необязательно)');
          if (userComment === null) return; // user cancelled
          feedbackComment = userComment.trim();
        }
        try {
          btn.disabled = true;
          const fbBody = { message_id: Number(msgId), feedback_type: fb };
          if (feedbackComment) fbBody.comment = feedbackComment;
          const resp = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fbBody),
          });
          if (!resp.ok) {
            let data = null;
            try { data = await resp.json(); } catch (_e) {}

          // CHANGE: Show user-friendly rate limit message
          // WHY: User request "пусть юзеру отдается rate limit просто а не висит человек"
          // REF: User message 2026-02-19
          let err;
          if (resp.status === 429) {
            const retryAfter = data && typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
            err = rateLimitMsg(retryAfter);
          } else {
            err = (data && data.error) ? data.error : ('Request failed (' + resp.status + ')');
          }
            showLocalSystem('⚠️ ' + err);
          } else if (fb === 'thumbs_down' && feedbackComment) {
            // Show support reference after negative feedback with comment
            let data = null;
            try { data = await resp.json(); } catch (_e) {}
            const ref = data && data.ref ? data.ref : null;
            if (ref) {
              showFeedbackRef(ref);
            }
          }
          // Keep UI consistent even when SSE is flaky behind a reverse proxy.
          await pollOnce();
        } catch {
          showLocalSystem('⚠️ ' + tt('networkError'));
        } finally {
          btn.disabled = false;
        }
        return;
      }

      const cb = btn.dataset.cb;
      if (!cb || !msgId) return;
      try {
        const resp = await fetch('/api/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_data: cb, message_id: Number(msgId) }),
        });
        if (!resp.ok) {
          let data = null;
          try { data = await resp.json(); } catch (_e) {}
          
          // CHANGE: Show user-friendly rate limit message
          // WHY: User request "пусть юзеру отдается rate limit просто а не висит человек"
          // REF: User message 2026-02-19
          let err;
          if (resp.status === 429) {
            const retryAfter = data && typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
            err = rateLimitMsg(retryAfter);
          } else {
            err = (data && data.error) ? data.error : ('Request failed (' + resp.status + ')');
          }
          showLocalSystem('⚠️ ' + err);
        }
      } catch {
        showLocalSystem('⚠️ ' + tt('networkError'));
      }
    });

	    // Extension context detection: when loaded inside Chrome extension sidebar iframe
	    function setupExtensionMode() {
	      var isInIframe = false;
	      try { isInIframe = window.parent !== window; } catch (_e) { isInIframe = true; }
	      if (!isInIframe) return;

	      // Switch to system font + smaller text in narrow sidebar
	      document.body.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
	      var extStyle = document.createElement('style');
	      extStyle.textContent = '.bubble { font-size: 14px !important; } .topbar .t1 { font-size: 13px !important; }';
	      document.head.appendChild(extStyle);

	      // Add "Open Showcases" + "Dev Mode" to existing hamburger menu
	      var menuEl = document.getElementById('menu');
	      if (!menuEl) return;

	      function openShowcasesFromMenu(e) {
	        if (e && typeof e.preventDefault === 'function') e.preventDefault();
	        openShowcasesOutsideSidebar('examples');
	        menuEl.classList.remove('open');
	      }

	      // Force existing /showcases menu item to open in browser tab (outside extension iframe)
	      var builtInShowcaseLinks = menuEl.querySelectorAll('a[href*="/showcases"]');
	      for (var i = 0; i < builtInShowcaseLinks.length; i++) {
	        builtInShowcaseLinks[i].setAttribute('target', '_blank');
	        builtInShowcaseLinks[i].setAttribute('rel', 'noopener');
	        builtInShowcaseLinks[i].addEventListener('click', openShowcasesFromMenu);
	      }

	      // Insert before first separator
	      var firstSep = menuEl.querySelector('.sep');

	      var showcasesLink = document.createElement('a');
	      showcasesLink.href = buildShowcasesUrlForUi('examples');
	      showcasesLink.target = '_blank';
	      showcasesLink.rel = 'noopener';
	      showcasesLink.textContent = _uiLang === 'ru' ? '📊 Открыть Showcases' : '📊 Open Showcases';
	      showcasesLink.addEventListener('click', openShowcasesFromMenu);

	      var devLink = document.createElement('a');
	      devLink.href = '#';
	      devLink.textContent = _uiLang === 'ru' ? '🔧 Dev Mode: выкл' : '🔧 Dev Mode: off';
	      devLink.addEventListener('click', function(e) {
	        e.preventDefault();
	        var isOn = devLink.dataset.devOn === '1';
	        var newState = !isOn;
	        window.parent.postMessage({ type: 'set_developer_mode', enabled: newState }, '*');
	        devLink.dataset.devOn = newState ? '1' : '0';
	        if (newState) {
	          devLink.textContent = _uiLang === 'ru' ? '🔧 Dev Mode: вкл' : '🔧 Dev Mode: on';
	        } else {
	          devLink.textContent = _uiLang === 'ru' ? '🔧 Dev Mode: выкл' : '🔧 Dev Mode: off';
	        }
	        menuEl.classList.remove('open');
	      });

	      var sep = document.createElement('div');
	      sep.className = 'sep';

	      if (firstSep) {
	        menuEl.insertBefore(showcasesLink, firstSep);
	        menuEl.insertBefore(devLink, firstSep);
	        menuEl.insertBefore(sep, firstSep);
	      } else {
	        menuEl.appendChild(sep);
	        menuEl.appendChild(showcasesLink);
	        menuEl.appendChild(devLink);
	      }

	      // Listen for messages from extension (dev mode state + keypair responses)
	      window.addEventListener('message', function(ev) {
	        if (!ev.data) return;

	        // CHANGE: Handle extension response messages for pending postMessage requests
	        // WHY: keypair generation flow uses request/response pattern via postMessage
	        // REF: tech-spec Task 6, panel.js sendResponse(requestId, data) pattern
	        if (ev.data.type === 'response' && ev.data.requestId) {
	          var pending = pendingExtensionRequests.get(ev.data.requestId);
	          if (pending) {
	            clearTimeout(pending.timer);
	            pendingExtensionRequests.delete(ev.data.requestId);
	            if (ev.data.error) {
	              pending.reject(new Error(ev.data.error));
	            } else {
	              pending.resolve(ev.data.data || {});
	            }
	          }
	          return;
	        }

	        if (ev.data.type !== 'developer_mode_changed') return;
	        var enabled = ev.data.data && ev.data.data.enabled;
	        devLink.dataset.devOn = enabled ? '1' : '0';
	        if (enabled) {
	          devLink.textContent = _uiLang === 'ru' ? '🔧 Dev Mode: вкл' : '🔧 Dev Mode: on';
	        } else {
	          devLink.textContent = _uiLang === 'ru' ? '🔧 Dev Mode: выкл' : '🔧 Dev Mode: off';
	        }
	      });
	    }

	    (async () => {
	      initTheme();
	      initUiLang();
	      setupMenu();
	      setupExtensionMode();
        setupIntroOverlay();
	      // Restore pendingText after Google auth reload
	      try {
	        var savedPending = sessionStorage.getItem('webchat_pending_text');
	        if (savedPending) {
	          sessionStorage.removeItem('webchat_pending_text');
	          pendingText = savedPending;
	        }
	      } catch(_e) {}
	      const ok = await loadMeAndHistory();
	      if (ok) {
	        // Always keep a slow polling loop as a safety net for flaky SSE/proxies.
	        ensureSlowPolling();
	        setupSse();
	        // If SSE never becomes healthy (broken proxy), polling will keep the chat live.
	        setTimeout(() => { if (!sseHealthy) ensureFastPolling(); }, 2500);
	        // Send restored pendingText after auth
	        if (pendingText) {
	          var restoredText = pendingText;
	          pendingText = null;
	          input.value = '';
	          autoResizeTextarea();
	          try {
	            var sendResp = await fetch('/api/message', {
	              method: 'POST',
	              headers: { 'Content-Type': 'application/json' },
	              body: JSON.stringify({ text: restoredText }),
	            });
	            if (!sendResp.ok) {
	              var sendData = null;
	              try { sendData = await sendResp.json(); } catch (_e2) {}
	              var sendErr = (sendData && sendData.error) ? sendData.error : ('Request failed (' + sendResp.status + ')');
	              showLocalSystem('⚠️ ' + sendErr);
	            }
	            await pollOnce();
	            scrollToBottom();
	          } catch(_e3) {}
	        }
	      } else {
	        await renderGuest();
	      }
	      await maybeAutoSubmitPromptFromQuery();
	      maybeAutoFillPromptFromQuery();
	      // Keep only "running" request timers ticking (final messages show a fixed duration).
	      setInterval(() => updateTimers(), 1000);
	      autoResizeTextarea();
	      input.focus();
	    })();

	    if (themeToggle) {
	      themeToggle.addEventListener('click', () => {
	        const currentTheme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
	        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
	        applyTheme(newTheme);
	      });
	    }

	    if (loginBtn) {
	      loginBtn.addEventListener('click', () => {
	        openLoginModal();
	      });
	    }

	    var langToggleEl = document.getElementById('langToggle');
	    if (langToggleEl) {
	      langToggleEl.addEventListener('click', function(e) {
	        e.preventDefault();
	        applyUiLang(_uiLang === 'ru' ? 'en' : 'ru');
	      });
	    }
	  </script>
	</body>
	</html>`;
	}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main(): Promise<void> {
  // Load shared env (SMTP credentials often live here).
  // Do not override existing env vars (pm2 / sourced .env.coderbox should win).
  dotenv.config({ path: '/root/space2/hababru/.env', override: false });

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 1.0,
      initialScope: {
        tags: { product: process.env.PRODUCT_TYPE || 'default' },
      },
    });
  }

  // Fail fast on missing required env vars (after dotenv.config so they can be sourced from .env).
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET required');
  if (!process.env.INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY required');

  ensureDir(WEBCHAT_DATA_DIR);
  ensureDir(WEBCHAT_CHATS_DIR);

  // Keep session store clean on startup.
  writeSessions(cleanupExpired(readSessions()));

  // Make sure admin history exists.
  if (!fs.existsSync(GLOBAL_MESSAGE_HISTORY_PATH)) {
    writeJsonAtomic(GLOBAL_MESSAGE_HISTORY_PATH, []);
  }

  const botConfig = loadConfig();
  const botLanguage = botConfig.language;
  const botEngine = new NoxonBot(botConfig, {
    skipHistoryBackupOnStart: true,
    skipTelegramHandlers: true,
  });

  // Webchat tasks run inside this process. If PM2 restarts this service while a task is running,
  // the "still working" status message can remain forever and confuse users on reload.
  cleanupStaleRunningStatusMessages(botLanguage);

  // Backfill CLAUDE.md for existing user workspaces that were created before this logic was added.
  try {
    const skillMdPath = getProductSkillMdPath();
    if (skillMdPath && fs.existsSync(skillMdPath)) {
      const dirs = fs.readdirSync(WORKSPACES_ROOT).filter((d) => d.startsWith('user_'));
      let backfilled = 0;
      for (const dir of dirs) {
        const userId = Number(dir.slice('user_'.length));
        if (!Number.isSafeInteger(userId) || userId <= 0) continue;
        maybeWriteWorkspaceClaude(path.join(WORKSPACES_ROOT, dir), userId);
        backfilled++;
      }
      if (backfilled > 0) console.log(`✅ [webchat] Backfilled CLAUDE.md check for ${backfilled} workspaces`);
    }
  } catch (err) {
    console.warn('⚠️ [webchat] CLAUDE.md backfill failed:', err);
  }
  // Run periodic cleanup every 5 minutes to catch messages that survived the startup cleanup
  // (e.g. process restarted < 3 min after the message was last updated).
  setInterval(() => cleanupStaleRunningStatusMessages(botLanguage), 5 * 60 * 1000);

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  // CHANGE: Returning guest silent re-authentication endpoint
  // WHY: Task 8 — enable returning guests to silently re-authenticate from d*.wpmix.net widget
  //      without going through Google OAuth again. The webchat_session cookie is scoped to
  //      simpledashboard.wpmix.net, so this endpoint must be on the main app (not inside the
  //      d*.wpmix.net middleware). CORS with credentials:'include' from d*.wpmix.net is the
  //      correct mechanism (Decision 3 in tech-spec).
  // REF: tech-spec Task 8, user-spec AC

  /** Allowed CORS origin pattern for dashboard subdomains */
  const CORS_DASHBOARD_ORIGIN_RE = new RegExp('^https?://(d\\d+\\.(wpmix\\.net|habab\\.ru)|cryptoforks\\.wpmix\\.net)$');

  /**
   * Apply CORS headers for dashboard-origin requests.
   * Reflects exact Origin if it matches the allowed pattern; sets Vary: Origin always.
   */
  function applyCorsForDashboardOrigin(req: express.Request, res: express.Response): void {
    res.setHeader('Vary', 'Origin');
    const origin = req.get('Origin') || '';
    if (CORS_DASHBOARD_ORIGIN_RE.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  // OPTIONS preflight for POST /api/auth/dashboard-logout
  app.options('/api/auth/dashboard-logout', (req, res) => {
    applyCorsForDashboardOrigin(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
  });

  // POST /api/auth/dashboard-logout — mark session as logged out from a specific dashboard
  app.post('/api/auth/dashboard-logout', express.json(), (req, res) => {
    applyCorsForDashboardOrigin(req, res);

    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = cookies['webchat_session'];
    if (!sid) {
      res.status(401).json({ error: 'No valid session' });
      return;
    }

    const sessions = cleanupExpired(readSessions());
    const session = sessions.find((s) => s.sessionId === sid);
    if (!session) {
      res.status(401).json({ error: 'No valid session' });
      return;
    }

    const dashboardId = typeof req.body?.dashboardId === 'string' ? req.body.dashboardId : '';
    if (!dashboardId || !/^d\d+$/.test(dashboardId)) {
      res.status(400).json({ error: 'Invalid dashboardId' });
      return;
    }

    let loggedOutSet = dashboardLogouts.get(sid);
    if (!loggedOutSet) {
      loggedOutSet = new Set();
      dashboardLogouts.set(sid, loggedOutSet);
    }
    loggedOutSet.add(dashboardId);

    console.log(`[AUDIT] dashboard-logout: sessionUserId=${session.userId} dashboardId=${dashboardId}`);
    res.status(200).json({ success: true });
  });

  // OPTIONS preflight for GET /api/auth/invite/status
  app.options('/api/auth/invite/status', (req, res) => {
    applyCorsForDashboardOrigin(req, res);
    const origin = req.get('Origin') || '';
    if (CORS_DASHBOARD_ORIGIN_RE.test(origin)) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.status(200).end();
  });

  // GET /api/auth/invite/status?dashboardId=d{N}
  // Returns { mlToken } for a returning guest with a valid session and dashboard access.
  app.get('/api/auth/invite/status', async (req, res) => {
    // Apply CORS headers (both allowed and disallowed origins — headers absent for disallowed)
    applyCorsForDashboardOrigin(req, res);

    // Rate limit: reuse rlOAuthCallbackIp10m (20 req/10min/IP) to prevent brute-force session enumeration
    const clientIp = getClientIp(req);
    if (!enforceRateLimit(req, res, [{ limiter: rlOAuthCallbackIp10m, key: clientIp }])) {
      return;
    }

    // 1. Validate dashboardId query param
    const rawDashboardId = typeof req.query['dashboardId'] === 'string' ? req.query['dashboardId'] : '';
    if (!rawDashboardId || !/^d\d+$/.test(rawDashboardId)) {
      res.status(400).json({ error: 'Invalid dashboardId' });
      return;
    }
    const dashboardId = rawDashboardId;
    const dashboardUserId = parseInt(dashboardId.slice(1), 10);

    // 2. Resolve webchat_session cookie
    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = cookies['webchat_session'];
    if (!sid) {
      res.status(401).json({ error: 'No valid session' });
      return;
    }

    const sessions = cleanupExpired(readSessions());
    const session = sessions.find((s) => s.sessionId === sid);
    if (!session) {
      res.status(401).json({ error: 'No valid session' });
      return;
    }

    // Check if user explicitly logged out from this dashboard
    const loggedOutDashboards = dashboardLogouts.get(sid);
    if (loggedOutDashboards?.has(dashboardId)) {
      res.status(401).json({ error: 'Logged out from this dashboard' });
      return;
    }

    // 3. Load guest ChatSettings and verify keypair
    const chatSettings = loadChatSettings(session.userId);
    if (!chatSettings.ownerAddress || !chatSettings.ownerPrivateKey) {
      res.status(401).json({ error: 'No keypair for this guest' });
      return;
    }

    // 4. Verify guest has dashboard_access via Auth API
    const authApiInviteUrl = (process.env.AUTH_API_URL || 'http://127.0.0.1:8095').replace(/\/+$/, '');
    const internalKey = process.env.INTERNAL_API_KEY!;

    let guestEmail: string | null = null;
    try {
      const guestUser = readUsers().find((u) => u.userId === session.userId);
      guestEmail = guestUser ? guestUser.email : null;
    } catch {
      guestEmail = null;
    }

    // Call access-list endpoint
    let hasAccess = false;
    try {
      const accessResp = await fetch(
        `${authApiInviteUrl}/api/auth/access-list?dashboardId=${encodeURIComponent(dashboardId)}`,
        {
          headers: {
            ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (accessResp.status === 200) {
        const accessBody = await accessResp.json() as { emails?: string[] };
        const emails: string[] = Array.isArray(accessBody.emails) ? accessBody.emails : [];
        if (guestEmail) {
          hasAccess = emails.map((e) => normalizeEmail(e)).includes(normalizeEmail(guestEmail));
        }
      } else {
        // Non-200 (e.g. 404 dashboard not found) → treat as no access → 401
        res.status(401).json({ error: 'No dashboard access' });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] invite/status: access-list call failed for dashboardId=${dashboardId}: ${msg}`);
      res.status(503).json({ error: 'Auth service unavailable' });
      return;
    }

    if (!hasAccess) {
      res.status(401).json({ error: 'No dashboard access' });
      return;
    }

    // 5. Sign challenge with guest's private key
    let challenge: string;
    let signature: string;
    try {
      const signed = await signChallenge(chatSettings.ownerPrivateKey, dashboardId);
      challenge = signed.challenge;
      signature = signed.signature;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] invite/status: signChallenge failed for dashboardId=${dashboardId}: ${msg}`);
      res.status(503).json({ error: 'Auth service unavailable' });
      return;
    }

    // 6. Call POST /api/auth/login to get a dashboard JWT
    let dashboardJwt: string;
    try {
      const loginResp = await fetch(`${authApiInviteUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
        },
        body: JSON.stringify({ dashboardId, challenge, signature }),
        signal: AbortSignal.timeout(10000),
      });
      if (loginResp.status !== 200) {
        const body = await loginResp.text().catch(() => '');
        console.error(`[ERROR] invite/status: login failed for dashboardId=${dashboardId}: status=${loginResp.status} body=${body}`);
        res.status(503).json({ error: 'Auth service unavailable' });
        return;
      }
      const loginBody = await loginResp.json() as { token?: string };
      if (!loginBody.token) {
        console.error(`[ERROR] invite/status: login response missing token for dashboardId=${dashboardId}`);
        res.status(503).json({ error: 'Auth service unavailable' });
        return;
      }
      dashboardJwt = loginBody.token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] invite/status: login call failed for dashboardId=${dashboardId}: ${msg}`);
      res.status(503).json({ error: 'Auth service unavailable' });
      return;
    }

    // 7. Issue ml-token (5 min TTL) carrying dashboardJwt
    const mlToken = crypto.randomBytes(32).toString('hex');
    magicLinkTokens.set(mlToken, {
      userId: String(dashboardUserId),
      expires: Date.now() + 5 * 60 * 1000,
      dashboardJwt,
    });

    console.log(`[AUDIT] invite/status: guestUserId=${session.userId} dashboardId=${dashboardId}`);

    res.status(200).json({ mlToken });
  });

  // CHANGE: Public hosting for d{userId}.wpmix.net and d{userId}.habab.ru subdomains
  // WHY: User request - "мне создался сайт d9000000000112.wpmix.net но при переходе на него открывается не моя папка"
  // REF: User message 2026-02-18
  app.use(async (req, res, next) => {
    const host = req.hostname || req.get('host') || '';
    const match = host.match(/^d(\d+)\.(wpmix\.net|habab\.ru)$/i);

    if (!match) {
      next();
      return;
    }

    const userId = match[1];
    const userFolder = `${WORKSPACES_ROOT}/user_${userId}`;

    // Check if user folder exists
    if (!fs.existsSync(userFolder)) {
      res.status(404).send(getPlaceholderHtml(userId, 'folder_not_found'));
      return;
    }

    // --- Proxy /api/auth/login → Auth API (port 8095) ---
    // BUG-FIX: d*.wpmix.net dashboard HTML calls /api/auth/login but this middleware
    // doesn't have the handler — proxy it to the Auth API.
    if (req.path === '/api/auth/login' && req.method === 'POST') {
      const authApiUrl = process.env.AUTH_API_URL || 'http://127.0.0.1:8095';
      try {
        const proxyRes = await fetch(`${authApiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(8000),
        });
        const data = await proxyRes.json();
        res.status(proxyRes.status).json(data);
      } catch {
        res.status(502).json({ error: 'Auth service unavailable' });
      }
      return;
    }

    // --- JSON CRUD API for dashboard data storage ---
    if (req.path.startsWith('/api/data/')) {
      // CHANGE: JWT enforcement for protected dashboards (Task 7)
      // WHY: Gate /api/data/ behind dashboard_jwt when ownerAddress is set,
      //      preserving backward compatibility for unprotected dashboards.
      const dataChatSettings = loadChatSettings(parseInt(userId, 10));
      if (dataChatSettings.ownerAddress) {
        const token = req.headers['authorization']?.split(' ')[1];
        let jwtPayload: { dashboardId?: string } | null = null;
        try {
          jwtPayload = jwt.verify(token as string, process.env.JWT_SECRET!) as { dashboardId?: string };
        } catch {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        if (jwtPayload.dashboardId !== 'd' + userId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      const parts = req.path.slice('/api/data/'.length).split('/');
      const collection = parts[0];
      const itemId = parts[1];

      if (!collection || !/^[a-zA-Z0-9_-]{1,64}$/.test(collection)) {
        res.status(400).json({ error: 'Invalid collection name' });
        return;
      }

      const dataDir = path.join(userFolder, 'data');
      const filePath = path.join(dataDir, `${collection}.json`);

      if (!filePath.startsWith(userFolder)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const readCollection = (): any[] => {
        if (!fs.existsSync(filePath)) return [];
        try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
        catch { return []; }
      };

      const writeCollection = (data: any[]) => {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      };

      if (req.method === 'GET') {
        if (itemId) {
          const item = readCollection().find((i: any) => i.id === itemId) ?? null;
          res.json(item);
          return;
        }
        res.json(readCollection());
        return;
      }

      if (req.method === 'POST' && !itemId) {
        const items = readCollection();
        const newItem = { ...req.body, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
        items.push(newItem);
        writeCollection(items);
        res.status(201).json(newItem);
        return;
      }

      if (req.method === 'PUT' && itemId) {
        const items = readCollection();
        const idx = items.findIndex((i: any) => i.id === itemId);
        if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
        items[idx] = { ...items[idx], ...req.body, id: itemId };
        writeCollection(items);
        res.json(items[idx]);
        return;
      }

      if (req.method === 'DELETE' && itemId) {
        const items = readCollection();
        const filtered = items.filter((i: any) => i.id !== itemId);
        writeCollection(filtered);
        res.json({ deleted: itemId });
        return;
      }

      if (req.method === 'DELETE' && !itemId) {
        writeCollection([]);
        res.json({ cleared: true });
        return;
      }

      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // --- Safe proxy endpoint /api/fetch (SSRF-protected) ---
    // WHY: Dashboard JS can't call external APIs due to CSP connect-src 'self'.
    //      This proxy validates the URL (SSRF protection), rate-limits per user, caches responses.
    if (req.path === '/api/fetch' && req.method === 'GET') {
      const now = Date.now();

      // Rate limit: 20 req/user/min
      const rlKey = `user:${userId}`;
      const rlCheck = rlFetchUser1m.check(rlKey, now);
      if (!rlCheck.ok) {
        res.status(429).json({ error: 'Rate limit exceeded', retryAfterMs: rlCheck.retryAfterMs });
        return;
      }

      const rawUrl = typeof req.query['url'] === 'string' ? req.query['url'] : '';
      if (!rawUrl) {
        res.status(400).json({ error: 'Missing url parameter' });
        return;
      }

      // Check cache
      const cached = fetchProxyCache.get(rawUrl);
      if (cached && cached.expires > now) {
        res.set('Content-Type', cached.contentType);
        res.set('X-Fetch-Proxy-Cache', 'HIT');
        res.send(cached.body);
        return;
      }

      // Validate URL (SSRF protection)
      const validation = await validateFetchUrl(rawUrl);
      if (!validation.ok) {
        res.status(400).json({ error: validation.reason });
        return;
      }

      // Consume rate limit slot only after validation passes
      rlFetchUser1m.consume(rlKey, now);

      // Fetch with timeout (10s) and redirect validation
      const FETCH_TIMEOUT_MS = 10_000;
      const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB

      let controller: AbortController | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller!.abort(), FETCH_TIMEOUT_MS);

        const fetchRes = await fetch(validation.url.toString(), {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'SimpleDashboard-Proxy/1.0' },
        });

        clearTimeout(timeoutId);
        timeoutId = undefined;

        // Re-validate final URL after redirects (DNS rebinding protection)
        const finalUrl = fetchRes.url;
        if (finalUrl !== validation.url.toString()) {
          const finalValidation = await validateFetchUrl(finalUrl);
          if (!finalValidation.ok) {
            res.status(400).json({ error: 'Redirect target not allowed' });
            return;
          }
        }

        // Read response with size limit
        const reader = fetchRes.body?.getReader();
        if (!reader) {
          res.status(502).json({ error: 'Empty response from upstream' });
          return;
        }
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            reader.cancel();
            break;
          }
          chunks.push(value);
        }
        const bodyBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        const bodyText = bodyBuffer.toString('utf8');

        const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';

        // Block binary/executable content types
        const blockedTypes = ['application/octet-stream', 'application/x-executable', 'application/x-msdownload'];
        if (blockedTypes.some(t => contentType.startsWith(t))) {
          res.status(415).json({ error: 'Response content type not allowed' });
          return;
        }

        // Cache for 30s
        fetchProxyCache.set(rawUrl, { body: bodyText, contentType, expires: now + 30_000 });

        res.status(fetchRes.status);
        res.set('Content-Type', contentType);
        res.set('X-Fetch-Proxy-Cache', 'MISS');
        res.send(bodyText);

      } catch (err: unknown) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort) {
          res.status(504).json({ error: 'Upstream request timed out' });
        } else {
          res.status(502).json({ error: 'Upstream request failed' });
        }
      }
      return;
    }

    // --- Magic link token exchange: GET /api/auth/ml?token=TOKEN ---
    // Mobile user arrives via QR code link d{userId}.wpmix.net?ml=TOKEN
    // Script injected into HTML calls this endpoint to get a JWT
    if (req.path === '/api/auth/ml' && req.method === 'GET') {
      const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
      const entry = magicLinkTokens.get(token);
      if (!entry || entry.expires < Date.now()) {
        res.status(401).json({ error: 'Invalid or expired magic link' });
        return;
      }
      if (entry.userId !== userId) {
        res.status(403).json({ error: 'Magic link is for a different dashboard' });
        return;
      }
      // Consume token — single use only
      magicLinkTokens.delete(token);

      // CHANGE: If the entry carries a pre-signed dashboardJwt (from OAuth callback), return it directly.
      // WHY: Task 6 — guest auth flow; the JWT is signed by Auth API (EC key), not by webchat.
      //      For owner mobile magic-link (no dashboardJwt), fall through to jwt.sign() as before.
      if (entry.dashboardJwt) {
        res.json({ jwt: entry.dashboardJwt });
        return;
      }

      const jwtToken = jwt.sign(
        { type: 'magic', userId, dashboardId: `d${userId}` },
        process.env.JWT_SECRET!,
        { expiresIn: '24h' }
      );
      res.json({ jwt: jwtToken });
      return;
    }

    // --- Auth config: GET /api/auth/config ---
    // SDK calls this to check if auth is enabled for this dashboard
    if (req.path === '/api/auth/config' && req.method === 'GET') {
      const configSettings = loadChatSettings(parseInt(userId, 10));
      if (configSettings.ownerAddress) {
        const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
        const oauthCallbackUrl = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
          'https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback';
        res.json({ authEnabled: true, accessMode: configSettings.accessMode || 'invite', googleClientId, oauthCallbackUrl });
      } else {
        res.json({ authEnabled: false });
      }
      return;
    }

    // --- Auth nonce: GET /api/auth/nonce ---
    // SDK calls this before redirecting to Google OAuth
    if (req.path === '/api/auth/nonce' && req.method === 'GET') {
      const nonce = crypto.randomBytes(16).toString('hex');
      oauthNonces.set(nonce, {
        dashboardId: `d${userId}`,
        expires: Date.now() + 10 * 60 * 1000,
      });
      res.json({ nonce });
      return;
    }

    // Serve static files from user folder
    const requestedPath = req.path === '/' ? 'index.html' : req.path.slice(1);
    const filepath = path.join(userFolder, requestedPath);

    // Security: prevent directory traversal
    if (!filepath.startsWith(userFolder)) {
      res.status(403).send('<h1>403 Forbidden</h1>');
      return;
    }

    // If index.html requested but doesn't exist, show placeholder
    if (requestedPath === 'index.html' && !fs.existsSync(filepath)) {
      res.send(getPlaceholderHtml(userId, 'no_index'));
      return;
    }

    // If file doesn't exist, return 404
    if (!fs.existsSync(filepath)) {
      res.status(404).send(`<h1>404 Not Found</h1><p>File not found: ${requestedPath}</p>`);
      return;
    }

    // Add CSP header for HTML files: browser fetch() only to same origin + SDK host
    // External APIs must go through /api/fetch proxy (SSRF-protected)
    if (requestedPath.endsWith('.html') || requestedPath.endsWith('.htm') || requestedPath === 'index.html') {
      res.set('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' cdn.tailwindcss.com cdn.jsdelivr.net simpledashboard.wpmix.net; " +
        "connect-src 'self' https://simpledashboard.wpmix.net; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' data:"
      );
    }

    // Serve static files directly — auth is handled by SDK (auth.js) included in dashboard HTML
    res.sendFile(filepath);
  });

  function getPlaceholderHtml(userId: string, reason: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome - d${userId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 60px 40px;
      box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
      border: 1px solid rgba(255, 255, 255, 0.18);
    }
    h1 { font-size: 3em; margin-bottom: 20px; font-weight: 700; }
    p { font-size: 1.2em; opacity: 0.9; line-height: 1.6; }
    .emoji { font-size: 4em; margin-bottom: 20px; }
    .link {
      display: inline-block;
      margin-top: 30px;
      padding: 15px 30px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      text-decoration: none;
      color: white;
      font-weight: 600;
      transition: all 0.3s ease;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }
    .link:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="emoji">🚀</div>
    <h1>Your Website Will Be Here</h1>
    <p>
      This is your personal subdomain for hosting landing pages or websites.
      Create an index.html file in the AI chat, and it will appear at this address.
    </p>
    ${reason === 'folder_not_found' ? '<p style="margin-top: 20px; opacity: 0.7; font-size: 0.9em;">User folder not created yet. Start working with the bot.</p>' : ''}
    <a href="https://noxonbot.wpmix.net" class="link">Open AI Chat →</a>
  </div>
</body>
</html>`;
  }

  const sseClients = new Set<SseClient>();

  // CHANGE: Global rate limiter for DDoS protection (higher limit for normal use)
  // WHY: User clarification - rate limit should be on AI requests, not all web requests
  // REF: User message 2026-02-17
  const rlGlobalIp1m = new SlidingWindowRateLimiter('global:ip:1m', 60 * 1000, 100);

  const rlDownloadIp1m = new SlidingWindowRateLimiter('downloads:ip:1m', 60 * 1000, 5);

  const rlAuthClaimIp10m = new SlidingWindowRateLimiter('auth_claim:ip:10m', 10 * 60 * 1000, 20);
  const rlAuthClaimIp1h = new SlidingWindowRateLimiter('auth_claim:ip:1h', 60 * 60 * 1000, 80);

  // CHANGE: AI request rate limiters - 10 requests per minute per user
  // WHY: User request "Rate limit exceeded - тут я имел в виду именно запросы к ии"
  // REF: User message 2026-02-17
  const rlMessageUser1m = new SlidingWindowRateLimiter('message:user:1m', 60 * 1000, 10);
  const rlMessageUser10s = new SlidingWindowRateLimiter('message:user:10s', 10 * 1000, 5);
  const rlMessageIp10s = new SlidingWindowRateLimiter('message:ip:10s', 10 * 1000, 20);
  const rlMessageIp10m = new SlidingWindowRateLimiter('message:ip:10m', 10 * 60 * 1000, 200);

  const rlCallbackUser10s = new SlidingWindowRateLimiter('callback:user:10s', 10 * 1000, 10);
  const rlCallbackUser10m = new SlidingWindowRateLimiter('callback:user:10m', 10 * 60 * 1000, 120);
  const rlCallbackIp10s = new SlidingWindowRateLimiter('callback:ip:10s', 10 * 1000, 40);
  const rlCallbackIp10m = new SlidingWindowRateLimiter('callback:ip:10m', 10 * 60 * 1000, 400);

  const rlFeedbackUser10s = new SlidingWindowRateLimiter('feedback:user:10s', 10 * 1000, 15);
  const rlFeedbackUser1h = new SlidingWindowRateLimiter('feedback:user:1h', 60 * 60 * 1000, 240);
  const rlFeedbackIp10s = new SlidingWindowRateLimiter('feedback:ip:10s', 10 * 1000, 60);
  const rlFeedbackIp1h = new SlidingWindowRateLimiter('feedback:ip:1h', 60 * 60 * 1000, 900);

  // Rate limiter for /api/fetch proxy (20 req / user / min)
  const rlFetchUser1m = new SlidingWindowRateLimiter('fetch:user:1m', 60 * 1000, 20);
  // Rate limiter for /api/auth/magic-link (10 links/hour/user)
  const rlMagicLinkUser1h = new SlidingWindowRateLimiter('magic-link:user:1h', 60 * 60 * 1000, 10);
  // Rate limiter for /api/auth/invite (20 invites/hour/userId)
  const rlInviteUser1h = new SlidingWindowRateLimiter('invite:user:1h', 60 * 60 * 1000, 20);
  // Rate limiter for /api/auth/callback OAuth (20 requests/10min/IP)
  const rlOAuthCallbackIp10m = new SlidingWindowRateLimiter('oauth-callback:ip:10m', 10 * 60 * 1000, 20);

  // In-memory cache for /api/fetch (TTL 30s, per-URL)
  const fetchProxyCache = new Map<string, { body: string; contentType: string; expires: number }>();

  // In-memory storage for magic link tokens (TTL 24h, lost on restart — acceptable)
  const magicLinkTokens = new Map<string, MagicLinkEntry>();

  // In-memory storage for invite tokens (no TTL — persist indefinitely until deleted)
  const inviteTokens = new Map<string, string>(); // dashboardUserId → token

  // In-memory storage for OAuth nonces (TTL 10 min, used by SDK auth flow)
  const oauthNonces = new Map<string, { dashboardId: string; expires: number }>();

  // sessionId → Set of dashboardIds user explicitly logged out from
  const dashboardLogouts = new Map<string, Set<string>>();
  // Hydrate invite tokens from disk (survive process restarts).
  for (const record of readInvites()) {
    inviteTokens.set(record.dashboardUserId, record.token);
  }

  // writeInvites is consumed by Task 5 invite handlers below.
  void writeInvites;

  const allLimiters = [
    rlGlobalIp1m,
    rlDownloadIp1m,
    rlAuthClaimIp10m,
    rlAuthClaimIp1h,
    rlMessageUser1m,
    rlMessageUser10s,
    rlMessageIp10s,
    rlMessageIp10m,
    rlCallbackUser10s,
    rlCallbackUser10m,
    rlCallbackIp10s,
    rlCallbackIp10m,
    rlFeedbackUser10s,
    rlFeedbackUser1h,
    rlFeedbackIp10s,
    rlFeedbackIp1h,
    rlFetchUser1m,
    rlMagicLinkUser1h,
    rlInviteUser1h,
    rlOAuthCallbackIp10m,
  ];

  // Prevent unbounded memory growth if we see many unique keys (IPs/userIds).
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const limiter of allLimiters) {
      limiter.sweep(now);
    }
    for (const [k, v] of magicLinkTokens) {
      if (v.expires < now) magicLinkTokens.delete(k);
    }
    for (const [k, v] of oauthNonces) {
      if (v.expires < now) oauthNonces.delete(k);
    }
    // Clean up dashboardLogouts for expired sessions
    const activeSessions = cleanupExpired(readSessions());
    for (const [sid] of dashboardLogouts) {
      if (!activeSessions.some(s => s.sessionId === sid)) {
        dashboardLogouts.delete(sid);
      }
    }
  }, 60 * 1000);
  sweepTimer.unref?.();

  function sseSend(userId: number, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of Array.from(sseClients)) {
      if (client.userId !== userId) continue;
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function ensureAuthed(req: express.Request): WebUser | null {
    // CHANGE: Check session first, only fallback to localhost auto-auth if no session
    // WHY: Tests create sessions via /api/auth/claim, but localhost auto-auth was overriding them
    // REF: test_webchat_flow.py

    // Try session-based auth first
    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = cookies.webchat_session;
    if (sid) {
      const sessions = cleanupExpired(readSessions());
      const session = sessions.find((s) => s.sessionId === sid);
      if (session) {
        const users = readUsers();
        const user = users.find((u) => u.userId === session.userId) || null;
        if (user) {
          return user;
        }
      }
    }

    // Fallback: Auto-auth localhost connections without email/session
    // WHY: User request "если мы заходим с локалхоста то не спрашивать емейл и пропускать онбоардинг"
    // REF: User message 2026-02-17
    const disableLocalhostAuth = process.env.WEBCHAT_DISABLE_LOCALHOST_AUTH === '1';
    if (isLocalhost(req) && !disableLocalhostAuth) {
      const localhostUserId = 999999999;
      const users = readUsers();
      let user = users.find((u) => u.userId === localhostUserId);
      if (!user) {
        user = {
          userId: localhostUserId,
          email: 'admin@example.com',
          name: 'admin',
          nickname: 'admin',
          createdAt: nowIso(),
        };
        users.push(user);
        writeUsers(users);
      }

      // CHANGE: Create user folder for localhost to bypass onboarding checks
      // WHY: Bot requires user folder to exist (${WORKSPACES_ROOT}/user_999999999/)
      // REF: User message 2026-02-17
      const userFolder = `${WORKSPACES_ROOT}/user_${localhostUserId}`;
      try {
        if (!fs.existsSync(userFolder)) {
          fs.mkdirSync(userFolder, { recursive: true });
          const claudeMd = `# Localhost Dev Project\n\nAuto-generated workspace for localhost testing.\n`;
          fs.writeFileSync(`${userFolder}/CLAUDE.md`, claudeMd, 'utf8');
          console.log(`✅ Created localhost user folder: ${userFolder}`);
        }
      } catch (error) {
        console.error(`❌ Failed to create localhost folder:`, error);
      }

      return user;
    }

    // No session and no localhost auto-auth - user is not authenticated
    return null;
  }

  function requireSessionPage(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const user = ensureAuthed(req);
    if (!user) {
      res.redirect('/');
      return;
    }
    (req as unknown as { webUser: WebUser }).webUser = user;
    next();
  }

  function requireSessionApi(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const user = ensureAuthed(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    (req as unknown as { webUser: WebUser }).webUser = user;
    next();
  }

  function getReqUser(req: express.Request): WebUser {
    const attached = (req as unknown as { webUser?: WebUser }).webUser;
    if (!attached) {
      throw new Error('Internal error: missing webUser');
    }
    return attached;
  }

  function createCtxHelpers(user: WebUser) {
    const chatId = user.userId;

    const getTranscript = (): WebMessage[] => readChatTranscript(chatId);
    const saveTranscript = (messages: WebMessage[]): void => writeChatTranscript(chatId, messages);

    const appendMessage = (msg: Omit<WebMessage, 'id'> & { id?: number }): WebMessage => {
      const transcript = getTranscript();
      const nextId = typeof msg.id === 'number' ? msg.id : computeNextMessageId(transcript);
      const full: WebMessage = {
        id: nextId,
        role: msg.role,
        text: msg.text,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        deletedAt: msg.deletedAt,
        feedback: msg.feedback,
        extra: msg.extra,
      };
      transcript.push(full);
      saveTranscript(transcript);
      return full;
    };

    const updateMessage = (id: number, updates: Partial<Pick<WebMessage, 'text' | 'updatedAt' | 'extra' | 'feedback'>>): WebMessage | null => {
      const transcript = getTranscript();
      const msg = transcript.find((m) => m.id === id) || null;
      if (!msg) return null;
      if (typeof updates.text === 'string') {
        msg.text = updates.text;
      }
      if (typeof updates.updatedAt === 'string') {
        msg.updatedAt = updates.updatedAt;
      }
      if (updates.extra !== undefined) {
        msg.extra = updates.extra;
      }
      if (updates.feedback !== undefined) {
        msg.feedback = updates.feedback;
      }
      saveTranscript(transcript);
      return msg;
    };

    const deleteMessage = (id: number): WebMessage | null => {
      const transcript = getTranscript();
      const msg = transcript.find((m) => m.id === id) || null;
      if (!msg) return null;
      msg.deletedAt = nowIso();
      saveTranscript(transcript);
      return msg;
    };

    const telegram = {
      editMessageText: async (_chatId: number, messageId: number, _inlineMessageId: unknown, text: string, extra?: unknown) => {
        const updated = updateMessage(messageId, { text, updatedAt: nowIso(), extra });
        if (updated) {
          sseSend(chatId, 'message_update', updated);
        }
        return true;
      },
      deleteMessage: async (_chatId: number, messageId: number) => {
        const deleted = deleteMessage(messageId);
        if (deleted) {
          sseSend(chatId, 'message_delete', deleted);
        }
        return true;
      },
      getFileLink: async (_fileId: string) => {
        throw new Error('getFileLink is not supported in webchat mode');
      },
    };

    const reply = async (text: string, extra?: unknown) => {
      const createdAt = nowIso();
      const msg = appendMessage({ role: 'assistant', text, createdAt, extra });
      appendGlobalMessageHistory(chatId, text, 'bot');
      sseSend(chatId, 'message', msg);
      return { message_id: msg.id } as unknown;
    };

    return { chatId, telegram, reply, appendMessage, updateMessage };
  }

  function buildTextCtx(user: WebUser, text: string, screenshotUrl?: string): Context {
    const { chatId, telegram, reply, appendMessage } = createCtxHelpers(user);
    const createdAt = nowIso();

    const userExtra = screenshotUrl ? { screenshotUrl } : undefined;
    const userMsg = appendMessage({ role: 'user', text, createdAt, extra: userExtra });
    appendGlobalMessageHistory(chatId, text, 'user');
    sseSend(chatId, 'message', userMsg);

    const ctx = {
      chat: { id: chatId, type: 'private' },
      from: {
        id: chatId,
        username: user.nickname,
        first_name: user.name,
        last_name: '',
        // CHANGE: Добавлен email для проверки прав в /settings
        // WHY: User request - "settings disable не безопасно сделай чтоб только i448539@gmail.com мог включать"
        // REF: User request 2026-02-18
        email: user.email,
        // CHANGE: Pass ownerAddress for SimpleDashboard auth-enabled dashboards
        // REF: dashboard-web3-auth feature
        ownerAddress: loadChatSettings(user.userId).ownerAddress || '',
      },
      message: {
        message_id: userMsg.id,
        date: Math.floor(Date.now() / 1000),
        text,
      },
      telegram,
      reply,
    };
    return ctx as unknown as Context;
  }

  function buildCallbackCtx(user: WebUser, data: string, messageId: number): Context {
    const { chatId, telegram, reply, updateMessage } = createCtxHelpers(user);
    const callbackId = crypto.randomBytes(16).toString('hex');

    const ctx = {
      chat: { id: chatId, type: 'private' },
      from: {
        id: chatId,
        username: user.nickname,
        first_name: user.name,
        last_name: '',
      },
      callbackQuery: {
        id: callbackId,
        data,
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: 'private' },
        },
      },
      telegram,
      answerCbQuery: async () => true,
      reply,
      editMessageText: async (text: string, extra?: unknown) => {
        const updated = updateMessage(messageId, { text, updatedAt: nowIso(), extra });
        if (updated) {
          sseSend(chatId, 'message_update', updated);
        }
        return true;
      },
      replyWithInvoice: async (_invoice: unknown) => {
        await reply('Payments are not supported in web mode. Use external payment link (if available).');
        return true;
      },
    };

    return ctx as unknown as Context;
  }

  // CHANGE: Global rate limiter for DDoS protection (100 per minute per IP)
  // WHY: User clarification - rate limit should be on AI requests, not all web requests
  // REF: User message 2026-02-17
  // NOTE: This runs BEFORE endpoint-specific rate limits. High limit for normal browsing.
  app.use((req, res, next) => {
    // Skip rate limiting for health check to allow monitoring
    if (req.path === '/health') {
      next();
      return;
    }

    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [{ limiter: rlGlobalIp1m, key: ip }])) {
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: nowIso(), title: getWebchatTitle() });
  });

  // CHANGE: Mount bounty API router for SimpleBounty product
  // WHY: Bounty CRUD endpoints isolated in bounty-api.ts to avoid webchat.ts bloat
  // REF: Task 2 — Campaigns & Tasks API
  app.use('/api/bounty', createBountyRouter({ workspacesRoot: WORKSPACES_ROOT, requireSessionApi }));

  // CHANGE: Serve user files from d{userid}.wpmix.net subdomain
  // WHY: User request "открывай так же по d{userid}.wpmix.net папку юзера"
  // REF: User message 2026-02-17
  // NOTE: This is public access (no auth required) - anyone can view user files by knowing userId
  app.use((req, res, next) => {
    const host = req.hostname || req.get('host') || '';
    const match = /^d(\d+)\.habab\.ru$/i.exec(host);
    if (!match) {
      next();
      return;
    }

    const userId = parseInt(match[1], 10);
    if (!userId || !Number.isFinite(userId)) {
      res.status(400).send('<h1>400 Bad Request</h1><p>Invalid user ID</p>');
      return;
    }

    const userFolder = `${WORKSPACES_ROOT}/user_${userId}`;
    if (!fs.existsSync(userFolder)) {
      res.status(404).send(`<h1>404 Not Found</h1><p>User folder not found for d${userId}.wpmix.net</p>`);
      return;
    }

    // Serve index.html if it exists
    const indexPath = path.join(userFolder, 'index.html');
    if (req.path === '/' && fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }

    // Serve specific file from user folder
    const requestedFile = req.path.slice(1); // Remove leading /
    if (requestedFile && !requestedFile.includes('..')) {
      const filePath = path.join(userFolder, requestedFile);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
        return;
      }
    }

    // Show directory listing if no index.html
    if (req.path === '/') {
      try {
        const files = fs.readdirSync(userFolder);
        const filesList = files
          .filter(f => f.endsWith('.html') || f.endsWith('.htm') || f.endsWith('.css') || f.endsWith('.js'))
          .map(f => `<li><a href="/${f}">${f}</a></li>`)
          .join('');

        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>d${userId}.wpmix.net</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    ul { list-style: none; padding: 0; }
    li { padding: 8px; border-bottom: 1px solid #eee; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>📁 User ${userId} Files</h1>
  <p>Domain: <code>d${userId}.wpmix.net</code></p>
  <p>Available files:</p>
  <ul>${filesList || '<li>No HTML/CSS/JS files found</li>'}</ul>
</body>
</html>`;
        res.send(html);
        return;
      } catch (error) {
        res.status(500).send(`<h1>500 Error</h1><p>Failed to read directory: ${error}</p>`);
        return;
      }
    }

    res.status(404).send(`<h1>404 Not Found</h1><p>File not found: ${req.path}</p>`);
  });

  // CHANGE: Serve localhost user files (e.g. hello.html created by bot)
  // WHY: User request "надо чтоб у этого hello.html роут был"
  // REF: User message 2026-02-17
  app.get('/localhost/:filename', (req, res) => {
    if (!isLocalhost(req)) {
      res.status(403).send('Access denied');
      return;
    }
    const filename = req.params.filename;
    const filepath = `${WORKSPACES_ROOT}/user_999999999/${filename}`;
    if (!fs.existsSync(filepath)) {
      res.status(404).send('File not found');
      return;
    }
    res.sendFile(filepath);
  });

  // CHANGE: Add /preview route to show index.html or directory listing from user folder
  // WHY: User request "сделай роут /preview для веб версии которая показывает папку и index.html если таковой есть в папке пользователя"
  // REF: User message 2026-02-17
  app.get('/preview', requireSessionPage, (req, res) => {
    const user = getReqUser(req);
    const userFolder = `${WORKSPACES_ROOT}/user_${user.userId}`;

    // Check if user folder exists
    if (!fs.existsSync(userFolder)) {
      res.status(404).send(`<h1>404 Not Found</h1><p>User folder not found: ${userFolder}</p>`);
      return;
    }

    // Check if index.html exists
    const indexPath = path.join(userFolder, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }

    // Show directory listing if no index.html
    try {
      const files = fs.readdirSync(userFolder);
      const filesList = files
        .filter(f => f.endsWith('.html') || f.endsWith('.htm'))
        .map(f => `<li><a href="/preview/${f}">${f}</a></li>`)
        .join('');

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Preview - User ${user.userId}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    ul { list-style: none; padding: 0; }
    li { padding: 8px; border-bottom: 1px solid #eee; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>📁 Preview Directory</h1>
  <p>User folder: <code>${userFolder}</code></p>
  <p>No index.html found. Available HTML files:</p>
  <ul>${filesList || '<li>No HTML files found</li>'}</ul>
</body>
</html>`;
      res.send(html);
    } catch (error) {
      res.status(500).send(`<h1>500 Error</h1><p>Failed to read directory: ${error}</p>`);
    }
  });

  // CHANGE: Add /preview/:filename route to serve specific files from user folder
  // WHY: Support for directory listing links in /preview route
  // REF: User message 2026-02-17
  app.get('/preview/:filename', requireSessionPage, (req, res) => {
    const user = getReqUser(req);
    const filename = req.params.filename;
    const filepath = path.join(`${WORKSPACES_ROOT}/user_${user.userId}`, filename);

    if (!fs.existsSync(filepath)) {
      res.status(404).send(`<h1>404 Not Found</h1><p>File not found: ${filename}</p>`);
      return;
    }

    res.sendFile(filepath);
  });

  app.get('/api/crawl-tests', async (req, res) => {
    const targets = buildCrawlTargets(req);
    const startedAt = Date.now();
    const results = await Promise.all(targets.map((target) => runCrawlTarget(target)));
    const ok = results.every((result) => result.ok);
    const finishedAt = Date.now();
    res.json({
      ok,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      results,
    });
  });

  app.get('/crawl-tests', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Crawl Tests</title>
  <style>
    :root {
      --bg: #f8fafc;
      --panel: #ffffff;
      --border: rgba(15,23,42,0.12);
      --text: rgba(15,23,42,0.9);
      --muted: rgba(15,23,42,0.65);
      --ok: #047857;
      --bad: #b91c1c;
      --chip: rgba(15,23,42,0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      background: var(--bg);
      color: var(--text);
      padding: 20px;
    }
    .wrap { max-width: 980px; margin: 0 auto; }
    .head { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
    .title { font-size: 18px; font-weight: 800; margin: 0; }
    .sub { margin: 8px 0 0; color: var(--muted); font-size: 12px; }
    .actions { display: flex; gap: 10px; }
    button, a.btn {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 10px;
      padding: 10px 12px;
      font: inherit;
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
    }
    .grid { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
    .card {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 14px;
      padding: 12px;
    }
    .row { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .lang { font-weight: 800; font-size: 14px; }
    .chip { background: var(--chip); border-radius: 999px; padding: 4px 8px; font-size: 11px; }
    .ok { color: var(--ok); }
    .bad { color: var(--bad); }
    .url { margin: 8px 0; word-break: break-all; font-size: 12px; color: var(--muted); }
    ul { margin: 8px 0 0; padding-left: 18px; }
    li { margin: 6px 0; font-size: 12px; }
    .meta { margin-top: 12px; color: var(--muted); font-size: 12px; }
    .error { margin-top: 12px; color: var(--bad); font-size: 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <h1 class="title">Crawl tests: RU + EN</h1>
        <p class="sub">Простая проверка веб-версий: <code>/health</code>, <code>/api/public/bootstrap</code>, <code>/</code>.</p> <!-- cyrillic-ok -->
      </div>
      <div class="actions">
        <button id="runBtn" type="button">Run crawl</button>
        <a class="btn" href="/">Back to chat</a>
      </div>
    </div>
    <div id="meta" class="meta">Ready.</div>
    <div id="error" class="error"></div>
    <div id="results" class="grid"></div>
  </div>
  <script>
    const metaEl = document.getElementById('meta');
    const errorEl = document.getElementById('error');
    const resultsEl = document.getElementById('results');
    const runBtn = document.getElementById('runBtn');

    function esc(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function renderResult(item) {
      const statusCls = item.ok ? 'ok' : 'bad';
      const statusText = item.ok ? 'PASS' : 'FAIL';
      const checks = (Array.isArray(item.checks) ? item.checks : []).map((check) => {
        const checkCls = check.ok ? 'ok' : 'bad';
        const icon = check.ok ? 'OK' : 'FAIL';
        return '<li><span class="' + checkCls + '">' + icon + '</span> ' + esc(check.name) + ' - ' + esc(check.detail) + '</li>';
      }).join('');
      return '<div class="card">' +
        '<div class="row"><span class="lang">' + esc(item.label) + '</span><span class="chip ' + statusCls + '">' + statusText + '</span></div>' +
        '<div class="url">' + esc(item.url) + '</div>' +
        '<ul>' + checks + '</ul>' +
      '</div>';
    }

    async function runCrawl() {
      runBtn.disabled = true;
      errorEl.textContent = '';
      metaEl.textContent = 'Running...';
      resultsEl.innerHTML = '';
      try {
        const response = await fetch('/api/crawl-tests');
        const payload = await response.json();
        const results = Array.isArray(payload.results) ? payload.results : [];
        resultsEl.innerHTML = results.map(renderResult).join('');
        const total = results.length;
        const passed = results.filter((item) => item && item.ok).length;
        const duration = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
        metaEl.textContent = 'Done. Passed: ' + passed + '/' + total + '. Duration: ' + duration + ' ms.';
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        errorEl.textContent = message;
        metaEl.textContent = 'Failed.';
      } finally {
        runBtn.disabled = false;
      }
    }

    runBtn.addEventListener('click', () => {
      void runCrawl();
    });

    void runCrawl();
  </script>
</body>
</html>`);
  });

  app.use('/extension-assets', express.static(EXTENSION_PREVIEWS_DIR, {
    fallthrough: false,
    maxAge: '1h',
  }));

  // Showcases gallery - serves static files from products/{product}/showcases/
  // CHANGE: Determine product by hostname
  // WHY: SimpleDashboard and SimpleSite need different showcases
  // REF: User request 2026-02-19 "почему тут шоукейсы от simplesite"
  app.get('/showcases', (req, res) => {
    const host = req.hostname || req.get('host') || '';
    // Determine product by hostname
    let product = 'simple_site'; // default
    if (host.includes('simpledashboard') || host.includes('coderbox')) {
      product = 'simple_dashboard';
    }

    const indexPath = path.join(PRODUCTS_DIR, product, 'showcases', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send(`Showcases not generated. Run: npx tsx scripts/generate_showcases_page.ts --product ${product}`);
    }
  });

  // CHANGE: Add /showcases/:slug/demo route for live demos
  // WHY: User request 2026-02-19 "давай сделаем чтоб все таки можно было посмотреть полную демку"
  // REF: User message 2026-02-19
  app.get('/showcases/:slug/demo', (req, res) => {
    const host = req.hostname || req.get('host') || '';
    let product = 'simple_site';
    if (host.includes('simpledashboard') || host.includes('coderbox')) {
      product = 'simple_dashboard';
    }

    const slug = req.params.slug;
    const demoPath = path.join(PRODUCTS_DIR, product, 'showcases', slug, 'demo.html');

    if (fs.existsSync(demoPath)) {
      res.sendFile(demoPath);
    } else {
      res.status(404).send(`Demo not found: ${slug}`);
    }
  });

  app.use('/showcases', (req, res, next) => {
    const host = req.hostname || req.get('host') || '';
    // Determine product by hostname
    let product = 'simple_site'; // default
    if (host.includes('simpledashboard') || host.includes('coderbox')) {
      product = 'simple_dashboard';
    }

    express.static(path.join(PRODUCTS_DIR, product, 'showcases'), {
      fallthrough: false,
      maxAge: '1h',
    })(req, res, next);
  });

  // --- SDK Auth JS ---
  // Serves the client-side auth SDK for dashboards.
  // Dashboards include <script src="https://simpledashboard.wpmix.net/sdk/auth.js"></script>
  app.get('/sdk/auth.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(getAuthSdkJs());
  });

  app.get('/extension-panel-shared.js', (_req, res) => {
    if (!fs.existsSync(EXTENSION_PANEL_SHARED_JS_PATH)) {
      res.status(404).type('text/plain; charset=utf-8').send('Not Found');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(EXTENSION_PANEL_SHARED_JS_PATH);
  });

  app.get('/extension', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderExtensionLandingHtml());
  });

  app.get('/extension/', (_req, res) => {
    res.redirect('/extension');
  });

	  // CHANGE: Serve pre-built extension ZIP instead of generating on the fly
  // WHY: Dynamic generator was missing web3 files, had hardcoded version 1.0.0,
  //   and included store_assets that don't belong in extension.
  //   build.js generates correct ZIP with all files + post-build linter.
  // REF: dashboard-web3-auth feature
  app.get('/downloads/chrome-sidebar-extension.zip', (req, res) => {
      const ip = getClientIp(req);
      if (!enforceRateLimit(req, res, [{ limiter: rlDownloadIp1m, key: ip }])) {
        return;
      }

      const extensionRootDir = path.join(__dirname, '..', '..', 'extensions', 'webchat-sidebar');
      const zipPath = path.join(extensionRootDir, 'out', 'webchat-sidebar.zip');

      if (!fs.existsSync(zipPath)) {
        res.status(404).json({ error: 'Extension not built yet. Run: cd extensions/webchat-sidebar && node build.js' });
        return;
      }

      const title = getWebchatTitle();
      const fileBase = slugify(title) || 'webchat';
      const fileName = `${fileBase}-chrome-sidebar-extension.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(zipPath).pipe(res);
  });

  function buildSessionCookie(req: express.Request, sessionId: string): string {
    const baseUrl = buildBaseUrl(req);
    const isHttps = baseUrl.startsWith('https://');
    const parts = [
      `webchat_session=${encodeURIComponent(sessionId)}`,
      'Path=/',
      'HttpOnly',
    ];
    if (isHttps) {
      // Required for embedding into Chrome extension side panel iframe (3rd-party cookie context).
      parts.push('SameSite=None');
      parts.push('Secure');
    } else {
      parts.push('SameSite=Lax');
    }
    return parts.join('; ');
  }

  function buildClearSessionCookie(req: express.Request): string {
    const baseUrl = buildBaseUrl(req);
    const isHttps = baseUrl.startsWith('https://');
    const parts = [
      'webchat_session=',
      'Path=/',
      'HttpOnly',
      'Max-Age=0',
    ];
    if (isHttps) {
      parts.push('SameSite=None');
      parts.push('Secure');
    } else {
      parts.push('SameSite=Lax');
    }
    return parts.join('; ');
  }

  // CHANGE: Support ?start=crm query param to show CRM welcome message
  // WHY: User request "в веб версии тоже пусть работает" (start=crm welcome message)
  // REF: User message 2026-02-10
  app.get('/api/public/bootstrap', (req, res) => {
    // CHANGE: Use client-side detected language (from ?lang= param) instead of server-side botLanguage
    // WHY: Browser language detection is more accurate for bilingual init messages
    const clientLang = typeof req.query['lang'] === 'string' ? req.query['lang'] : '';
    const lang = clientLang === 'ru' ? 'ru' : (botLanguage === 'ru' ? 'ru' : 'en');
    const startParamValue = typeof req.query['start'] === 'string' ? req.query['start'] : '';
    const extIdValue = normalizeExtensionId(typeof req.query['ext_id'] === 'string' ? req.query['ext_id'] : '');
    const simpleDashboard = isSimpleDashboardProduct();
    const exampleSlug = simpleDashboard ? extractSimpleDashboardExampleSlugFromStartParam(startParamValue) : '';
    const showcasesStartParam = exampleSlug ? `example_${exampleSlug}` : 'examples';
    const showcasesUrl = simpleDashboard
      ? buildSimpleDashboardShowcasesUrl(buildBaseUrl(req), extIdValue, showcasesStartParam)
      : '';
    const startUser: WebMessage = { id: 1, role: 'user', text: '/start', createdAt: nowIso() };
    let startBotText: string;
    if (startParamValue === 'crm') {
      startBotText = lang === 'ru'
        ? '👋 Привет! Я помогу создать CRM-систему для вашего бизнеса.\n\n🎯 AI CRM Constructor - это CRM, которая подстраивается под ваши бизнес-процессы.\n\n✅ Без лишних функций - только то, что нужно именно вам\n✅ Быстрое внедрение - 1-2 недели\n✅ Полный контроль - исходный код принадлежит вам\n\n💡 Опишите мне ваш бизнес и процессы, и я помогу создать идеальную CRM:\n\n📝 Расскажите:\n• Чем занимается ваш бизнес?\n• Какие основные этапы работы с клиентом?\n• Что нужно учитывать (клиенты, заказы, проекты)?\n• Какие интеграции нужны (Telegram, email, платежи)?'
        : '👋 Hello! I will help you create a CRM system for your business.\n\n🎯 AI CRM Constructor - a CRM that adapts to your business processes.\n\n✅ No unnecessary features - only what you need\n✅ Fast implementation - 1-2 weeks\n✅ Full control - you own the source code\n\n💡 Describe your business and processes, and I will help create the perfect CRM:\n\n📝 Tell me:\n• What does your business do?\n• What are the main stages of customer interaction?\n• What needs to be tracked (customers, orders, projects)?\n• What integrations are needed (Telegram, email, payments)?';
    } else if (exampleSlug) {
      startBotText = buildSimpleDashboardExampleStartMessage(lang, exampleSlug, showcasesUrl);
    } else {
      startBotText = getWebchatInitMessage(lang, true);
      if (simpleDashboard) {
        startBotText = appendShowcasesLinkToMessage(startBotText, lang, showcasesUrl);
      }
    }
    const startBot: WebMessage = { id: 2, role: 'assistant', text: startBotText, createdAt: nowIso() };
    // CHANGE: Return isLocalhost flag to skip auth for localhost connections
    // WHY: User request "если мы заходим с локалхоста то не спрашивать емейл и пропускать онбоардинг"
    // REF: User message 2026-02-17
    res.json({
      title: getWebchatTitle(),
      subtitle: getWebchatSubtitle(),
      language: lang,
      startMessages: [startUser, startBot],
      showcasesUrl,
      isLocalhost: isLocalhost(req),
    });
  });

  app.post('/api/auth/claim', async (req, res) => {
    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [
      { limiter: rlAuthClaimIp10m, key: ip },
      { limiter: rlAuthClaimIp1h, key: ip },
    ])) {
      return;
    }

    const nameRaw = typeof req.body?.name === 'string' ? req.body.name : '';
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email : '';
    // CHANGE: Read startParam from request body to send correct welcome message on first visit
    // WHY: User request "в веб версии тоже пусть работает" (start=crm welcome message)
    // REF: User message 2026-02-10
    const startParamRaw = typeof req.body?.startParam === 'string' ? req.body.startParam : '';
    const startParamClaim = startParamRaw.trim().slice(0, 50);
    const name = nameRaw.trim().slice(0, 80);
    const email = normalizeEmail(emailRaw);

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const users = readUsers();
    let user = users.find((u) => u.email === email) || null;
    if (!user) {
      const usedNicknames = new Set(users.map((u) => u.nickname));
      user = {
        userId: allocateUserId(),
        email,
        name,
        nickname: buildNickname(name, email, usedNicknames),
        createdAt: nowIso(),
      };
      users.push(user);
      writeUsers(users);
    } else {
      // Keep user profile fresh (best-effort; no auth, by design).
      if (user.name !== name) {
        user.name = name;
        writeUsers(users);
      }
    }

    // CHANGE: Auto-disable bwrap for i448539@gmail.com
    // WHY: User request "сделай чтоб все кто в него пишут работают в bwrap кроме i448539@gmail.com юзера"
    // REF: User message 2026-02-17
    if (email === 'i448539@gmail.com') {
      try {
        const chatId = user.userId; // userId is used as chatId in webchat
        const chatSettings = loadChatSettings(chatId);
        if (chatSettings.useBwrap !== false) {
          chatSettings.useBwrap = false;
          saveChatSettings(chatSettings);
          console.log(`✅ [webchat] Auto-disabled bwrap for ${email} (chatId=${chatId})`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to disable bwrap for ${email}: ${msg}`);
      }
    }

    const sessions = cleanupExpired(readSessions()).filter((s) => s.userId !== user!.userId);
    const sessionId = crypto.randomBytes(24).toString('hex');
    const createdAt = nowIso();
    const expiresAt = addHours(new Date(), getSessionTtlHours()).toISOString();
    sessions.push({ sessionId, userId: user.userId, createdAt, expiresAt });
    writeSessions(sessions);

    // Initialize the dialog with /start on first visit.
    // CHANGE: Use startParamClaim to send correct welcome (/start crm) when coming from CRM landing
    // WHY: User request "в веб версии тоже пусть работает" (start=crm welcome message)
    // REF: User message 2026-02-10
    const startCommand = startParamClaim ? `/start ${startParamClaim}` : '/start';
    const shouldInitWithStart = process.env.WEBCHAT_INIT_WITH_START !== 'false';
    const transcript = readChatTranscript(user.userId);
    if (shouldInitWithStart && Array.isArray(transcript) && transcript.length === 0) {
      try {
        await botEngine.processIncomingTextMessage(buildTextCtx(user, startCommand));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to init /start for webchat userId=${user.userId}: ${msg}`);
      }
    }

    // Fallback for products where /start is disabled (WEBCHAT_INIT_WITH_START=false):
    // write the configured WEBCHAT_INIT_MESSAGE directly to the transcript so the
    // chat is not empty after the first login.
    if (!shouldInitWithStart) {
      const lang = typeof req.body.lang === 'string' ? req.body.lang : botLanguage;
      const sdShowcasesUrl = isSimpleDashboardProduct() ? buildSimpleDashboardShowcasesUrl(buildBaseUrl(req), '', 'examples') : undefined;
      maybeWriteInitMessageTranscript(user.userId, lang, sdShowcasesUrl);
    }

    // Ensure user workspace folder exists and has CLAUDE.md so Claude follows product rules.
    // CHANGE: Added workspace creation + CLAUDE.md write to /api/auth/claim (was only in /api/auth/google)
    // WHY: Claude was creating dashboard.html instead of index.html because CLAUDE.md wasn't in workspace
    const userWorkspaceFolder = `${WORKSPACES_ROOT}/user_${user.userId}`;
    if (!fs.existsSync(userWorkspaceFolder)) {
      try {
        fs.mkdirSync(userWorkspaceFolder, { recursive: true });
        console.log(`✅ [webchat] Created workspace folder for ${email} (userId=${user.userId})`);
      } catch (err) {
        console.error(`❌ [webchat] Failed to create workspace folder for ${user.userId}:`, err);
      }
    }
    maybeWriteWorkspaceClaude(userWorkspaceFolder, user.userId);

    res.setHeader('Set-Cookie', buildSessionCookie(req, sessionId));
    res.json({
      ok: true,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
      },
    });
  });

  // CHANGE: Google Sign-In authentication endpoint
  // WHY: User request "давай сделаем google auth авторизацию вместо простого ввода"
  // REF: User message 2026-02-18
  app.post('/api/auth/google', async (req, res) => {
    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [
      { limiter: rlAuthClaimIp10m, key: ip },
      { limiter: rlAuthClaimIp1h, key: ip },
    ])) {
      return;
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      res.status(500).json({ error: 'Google Auth not configured' });
      return;
    }

    const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
    const startParamRaw = typeof req.body?.startParam === 'string' ? req.body.startParam : '';
    const startParamClaim = startParamRaw.trim().slice(0, 50);
    if (!credential) {
      res.status(400).json({ error: 'Missing Google credential' });
      return;
    }

    // Verify Google JWT token
    let email = '';
    let name = '';
    let emailVerified = false;

    // GOOGLE_AUTH_TEST_SECRET: test-only bypass — lets integration tests send HMAC-signed
    // JWTs instead of real Google credentials. If set but token doesn't match, fall through
    // to real Google verification so production logins still work.
    const testSecret = process.env.GOOGLE_AUTH_TEST_SECRET;
    let usedTestBypass = false;
    if (testSecret) {
      try {
        const decoded = jwt.verify(credential, testSecret, { algorithms: ['HS256'] }) as Record<string, unknown>;
        email = typeof decoded.email === 'string' ? decoded.email : '';
        name = typeof decoded.name === 'string' ? decoded.name : (typeof decoded.given_name === 'string' ? decoded.given_name : email.split('@')[0]);
        emailVerified = decoded.email_verified !== false;
        usedTestBypass = true;
      } catch {
        // not a test token — fall through to real Google verification
      }
    }
    if (!usedTestBypass) {
      try {
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (!payload) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
        email = payload.email || '';
        name = payload.name || payload.given_name || email.split('@')[0];
        emailVerified = payload.email_verified || false;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Google token verification failed: ${msg}`);
        res.status(401).json({ error: 'Google authentication failed' });
        return;
      }
    }

    if (!emailVerified) {
      res.status(401).json({ error: 'Email not verified by Google' });
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      res.status(400).json({ error: 'Invalid email from Google' });
      return;
    }

    // Find or create user
    const users = readUsers();
    let user = users.find((u) => u.email === normalizedEmail) || null;
    if (!user) {
      const usedNicknames = new Set(users.map((u) => u.nickname));
      user = {
        userId: allocateUserId(),
        email: normalizedEmail,
        name: name.trim().slice(0, 80),
        nickname: buildNickname(name, normalizedEmail, usedNicknames),
        createdAt: nowIso(),
      };
      users.push(user);
      writeUsers(users);
    } else {
      // Update name if changed
      const trimmedName = name.trim().slice(0, 80);
      if (user.name !== trimmedName) {
        user.name = trimmedName;
        writeUsers(users);
      }
    }

    // Auto-disable bwrap for i448539@gmail.com
    if (normalizedEmail === 'i448539@gmail.com') {
      try {
        const chatId = user.userId;
        const chatSettings = loadChatSettings(chatId);
        if (chatSettings.useBwrap !== false) {
          chatSettings.useBwrap = false;
          saveChatSettings(chatSettings);
          console.log(`✅ [webchat] Auto-disabled bwrap for ${normalizedEmail} via Google Auth (chatId=${chatId})`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to disable bwrap for ${normalizedEmail}: ${msg}`);
      }
    }

    // Ensure user workspace folder exists so d{userId}.wpmix.net doesn't 500
    const userWorkspaceFolder = `${WORKSPACES_ROOT}/user_${user.userId}`;
    if (!fs.existsSync(userWorkspaceFolder)) {
      try {
        fs.mkdirSync(userWorkspaceFolder, { recursive: true });
        console.log(`✅ [webchat] Created workspace folder for ${normalizedEmail} (userId=${user.userId})`);
      } catch (err) {
        console.error(`❌ [webchat] Failed to create workspace folder for ${user.userId}:`, err);
      }
    }
    maybeWriteWorkspaceClaude(userWorkspaceFolder, user.userId);

    // Create session
    const sessions = cleanupExpired(readSessions()).filter((s) => s.userId !== user!.userId);
    const sessionId = crypto.randomBytes(24).toString('hex');
    const createdAt = nowIso();
    const expiresAt = addHours(new Date(), getSessionTtlHours()).toISOString();
    sessions.push({ sessionId, userId: user.userId, createdAt, expiresAt });
    writeSessions(sessions);

    // Initialize with /start on first visit
    const startCommand = startParamClaim ? `/start ${startParamClaim}` : '/start';
    const shouldInitWithStart = process.env.WEBCHAT_INIT_WITH_START !== 'false';
    const transcript = readChatTranscript(user.userId);
    if (shouldInitWithStart && Array.isArray(transcript) && transcript.length === 0) {
      try {
        await botEngine.processIncomingTextMessage(buildTextCtx(user, startCommand));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to init /start for webchat userId=${user.userId}: ${msg}`);
      }
    }

    // Fallback for products where /start is disabled (WEBCHAT_INIT_WITH_START=false):
    // write the configured WEBCHAT_INIT_MESSAGE directly to the transcript so the
    // chat is not empty after the first login.
    if (!shouldInitWithStart) {
      const lang = typeof req.body.lang === 'string' ? req.body.lang : botLanguage;
      const sdShowcasesUrl = isSimpleDashboardProduct() ? buildSimpleDashboardShowcasesUrl(buildBaseUrl(req), '', 'examples') : undefined;
      maybeWriteInitMessageTranscript(user.userId, lang, sdShowcasesUrl);
    }

    res.setHeader('Set-Cookie', buildSessionCookie(req, sessionId));
    res.json({
      ok: true,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
      },
    });
  });

  // Backward-compatible alias (old login form). No email is sent.
  app.post('/api/auth/request-link', async (_req, res) => {
    res.status(410).json({ error: 'Deprecated. Use /api/auth/claim.' });
  });

  // CHANGE: Add keypair registration endpoint for dashboard Web3 auth
  // WHY: Webchat needs to register owner address with Auth API when creating auth-enabled dashboards
  // REF: tech-spec Task 6, user-spec AC24
  const AUTH_API_URL = (process.env.AUTH_API_URL || 'http://127.0.0.1:8095').replace(/\/+$/, '');
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY!;
  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  app.post('/api/auth/register-owner', requireSessionApi, async (req, res) => {
    const addressRaw = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
    const privateKeyRaw = typeof req.body?.privateKey === 'string' ? req.body.privateKey.trim() : '';
    const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const dashboardIdRaw = typeof req.body?.dashboardId === 'string' ? req.body.dashboardId.trim() : '';

    // Validate required fields
    if (!addressRaw) {
      res.status(400).json({ error: 'Address is required' });
      return;
    }
    if (!ADDRESS_RE.test(addressRaw)) {
      res.status(400).json({ error: 'Invalid address format: must be 0x followed by 40 hex characters' });
      return;
    }
    if (!privateKeyRaw) {
      res.status(400).json({ error: 'privateKey is required' });
      return;
    }
    if (!emailRaw) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    if (!dashboardIdRaw) {
      res.status(400).json({ error: 'dashboardId is required' });
      return;
    }

    // Call Auth API server-to-server
    const authApiRegisterUrl = `${AUTH_API_URL}/api/auth/register`;
    try {
      const authResp = await fetch(authApiRegisterUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          address: addressRaw,
          privateKey: privateKeyRaw,
          email: emailRaw,
          dashboardId: dashboardIdRaw,
        }),
        signal: AbortSignal.timeout(10000),
      });

      let authBody: Record<string, unknown> = {};
      try {
        authBody = await authResp.json() as Record<string, unknown>;
      } catch {
        authBody = {};
      }

      if (authResp.status === 201) {
        console.log(`✅ [webchat] register-owner success: address=${addressRaw}, dashboardId=${dashboardIdRaw}`);

        // Persist address + private key in local ChatSettings
        const user = getReqUser(req);
        const chatSettings = loadChatSettings(user.userId);
        chatSettings.ownerAddress = addressRaw;
        chatSettings.ownerPrivateKey = privateKeyRaw;
        saveChatSettings(chatSettings);

        res.status(200).json({ address: authBody.address || addressRaw });
        return;
      }

      // Proxy error status from Auth API (409 conflict, 400 bad request, etc.)
      console.warn(`⚠️ [webchat] register-owner: Auth API returned ${authResp.status}: ${JSON.stringify(authBody)}`);
      res.status(authResp.status).json(authBody);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [webchat] register-owner: Auth API call failed: ${msg}`);
      res.status(503).json({ error: 'Auth service unavailable' });
    }
  });

  app.get('/auth/verify', (_req, res) => {
    res.status(410).send('Disabled');
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', buildClearSessionCookie(req));
    res.redirect('/');
  });

  // CHANGE: Delete account endpoint — removes user folder, user record, all sessions
  // WHY: User request "удалить аккаунт" from profile page
  app.post('/api/delete-account', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    // Delete workspace folder
    const userFolder = path.join(WORKSPACES_ROOT, `user_${user.userId}`);
    if (fs.existsSync(userFolder)) {
      fs.rmSync(userFolder, { recursive: true, force: true });
    }
    // Remove user from users.json
    const users = readUsers().filter((u) => u.userId !== user.userId);
    writeUsers(users);
    // Remove all sessions for this user
    const sessions = cleanupExpired(readSessions()).filter((s) => s.userId !== user.userId);
    writeSessions(sessions);
    // Invalidate all magic link tokens for this user
    const userIdStr = String(user.userId);
    for (const [k, v] of magicLinkTokens) {
      if (v.userId === userIdStr) magicLinkTokens.delete(k);
    }
    // Clear session cookie
    res.setHeader('Set-Cookie', buildClearSessionCookie(req));
    res.json({ ok: true });
  });

  // CHANGE: Generate mobile magic link for dashboard owner
  // WHY: Owner wants to open own dashboard on mobile (no extension) via QR code
  app.post('/api/auth/magic-link', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const rlCheck = rlMagicLinkUser1h.check(String(user.userId), Date.now());
    if (!rlCheck.ok) {
      res.status(429).json({ error: 'Too many magic links generated. Try again later.' });
      return;
    }
    rlMagicLinkUser1h.consume(String(user.userId), Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    magicLinkTokens.set(token, { userId: String(user.userId), expires });
    const url = `https://d${user.userId}.wpmix.net?ml=${token}`;
    res.json({ url, expiresIn: '24h', expiresAt: new Date(expires).toISOString() });
  });

  // CHANGE: Generate invite link for dashboard owner (guests use it to register on owner's dashboard)
  // WHY: Task 5 — invite flow; owners can share their dashboard with guests via invite URL
  app.post('/api/auth/invite', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const rlCheck = rlInviteUser1h.check(String(user.userId), Date.now());
    if (!rlCheck.ok) {
      res.status(429).json({ error: 'Too many invites generated. Try again later.' });
      return;
    }
    rlInviteUser1h.consume(String(user.userId), Date.now());
    const chatSettings = loadChatSettings(user.userId);
    if (!chatSettings.ownerAddress) {
      res.status(403).json({ error: 'Dashboard not protected. Complete keypair setup first.' });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    inviteTokens.set(String(user.userId), token);
    writeInvites(Array.from(inviteTokens.entries()).map(([dashboardUserId, t]) => ({ dashboardUserId, token: t })));
    res.json({ url: `https://d${user.userId}.wpmix.net?invite=${token}` });
  });

  // CHANGE: Revoke (replace) invite link for dashboard owner
  // WHY: Task 5 — owner can invalidate a leaked invite by generating a fresh token; no rate limit consumed
  app.post('/api/auth/invite/revoke', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const chatSettings = loadChatSettings(user.userId);
    if (!chatSettings.ownerAddress) {
      res.status(403).json({ error: 'Dashboard not protected. Complete keypair setup first.' });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    inviteTokens.set(String(user.userId), token);
    writeInvites(Array.from(inviteTokens.entries()).map(([dashboardUserId, t]) => ({ dashboardUserId, token: t })));
    res.json({ url: `https://d${user.userId}.wpmix.net?invite=${token}` });
  });

  // CHANGE: OAuth authorization-code callback for guest dashboard access
  // WHY: Task 6 — central OAuth callback handler; validates nonce, exchanges code for identity,
  //      registers/finds guest keypair, validates invite, calls share+login, issues ml-token
  // REF: work/multi-user-auth/tasks/6.md
  app.get('/api/auth/google-dashboard-callback', async (req, res) => {
    // --- Rate limit by client IP ---
    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [{ limiter: rlOAuthCallbackIp10m, key: ip }])) {
      return;
    }

    // --- Parse and validate state parameter ---
    const stateRaw = typeof req.query['state'] === 'string' ? req.query['state'] : '';
    let stateObj: { redirect_to?: string; invite?: string; nonce?: string } = {};
    try {
      stateObj = JSON.parse(Buffer.from(stateRaw, 'base64').toString('utf8'));
    } catch {
      res.status(400).send('Invalid state parameter');
      return;
    }

    const redirectTo = typeof stateObj.redirect_to === 'string' ? stateObj.redirect_to.trim() : '';
    if (!redirectTo) {
      res.status(400).send('Missing redirect_to in state');
      return;
    }

    // --- Validate redirect_to against allowlist ---
    const REDIRECT_TO_RE = /^d\d+\.wpmix\.net$/;
    if (!REDIRECT_TO_RE.test(redirectTo)) {
      console.warn(`[WARN] google-dashboard-callback: invalid redirect_to="${redirectTo}" ip=${ip}`);
      res.status(400).send('Invalid redirect_to domain');
      return;
    }

    // Safe redirect target established — all further errors redirect there
    const safeRedirectBase = `https://${redirectTo}`;

    // Extract dashboardUserId from redirect_to: d{N}.wpmix.net → N
    const dashboardUserIdStr = redirectTo.match(/^d(\d+)\.wpmix\.net$/)![1];
    const dashboardUserId = Number(dashboardUserIdStr);
    const dashboardId = `d${dashboardUserIdStr}`;

    const nonce = typeof stateObj.nonce === 'string' ? stateObj.nonce : '';
    const inviteToken = typeof stateObj.invite === 'string' ? stateObj.invite : '';
    const codeRaw = typeof req.query['code'] === 'string' ? req.query['code'] : '';

    try {
      // --- Validate CSRF nonce against session or oauthNonces Map ---
      const testSecret = process.env.GOOGLE_AUTH_TEST_SECRET;
      const isTestNonce = testSecret && nonce === 'test-nonce';
      if (!isTestNonce) {
        // Check oauthNonces Map first (SDK auth flow)
        const mapEntry = nonce ? oauthNonces.get(nonce) : undefined;
        if (mapEntry && mapEntry.expires > Date.now()) {
          // Valid nonce from SDK — consume it
          oauthNonces.delete(nonce);
        } else {
          // Fallback: check session-based nonce (legacy server-injection flow)
          const cookies = parseCookieHeader(req.headers.cookie);
          const sid = cookies['webchat_session'];
          const sessions = cleanupExpired(readSessions());
          const session = sessions.find((s) => s.sessionId === sid);
          const sessionNonce = session?.oauthNonce;
          if (!nonce || !sessionNonce || nonce !== sessionNonce) {
            res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
            return;
          }
        }
      }
      // NOTE: test bypass — if GOOGLE_AUTH_TEST_SECRET is set and state.nonce === 'test-nonce',
      // skip session nonce validation to allow integration tests to run without a real session.

      // --- Exchange authorization code for identity ---
      let email = '';
      let name = '';

      let usedTestBypass = false;
      if (testSecret) {
        // GOOGLE_AUTH_TEST_SECRET bypass: accept HMAC-signed JWT as code (same as POST /api/auth/google)
        // If verification fails, fall through to real OAuth code exchange.
        try {
          const decoded = jwt.verify(codeRaw, testSecret, { algorithms: ['HS256'] }) as Record<string, unknown>;
          email = typeof decoded.email === 'string' ? decoded.email : '';
          name = typeof decoded.name === 'string' ? decoded.name : (typeof decoded.given_name === 'string' ? decoded.given_name : email.split('@')[0]);
          const emailVerified = decoded.email_verified !== false;
          if (!emailVerified) {
            res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
            return;
          }
          usedTestBypass = true;
        } catch {
          // not a test token — fall through to real Google OAuth code exchange
        }
      }
      if (!usedTestBypass) {
        // Production: exchange OAuth authorization code for Google ID token
        const googleClientId = process.env.GOOGLE_CLIENT_ID;
        const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
          'https://simpledashboard.wpmix.net/api/auth/google-dashboard-callback';
        if (!googleClientId || !googleClientSecret) {
          console.error('[ERROR] google-dashboard-callback: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured');
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
        try {
          const oauthClient = new OAuth2Client(googleClientId, googleClientSecret, redirectUri);
          const { tokens } = await oauthClient.getToken(codeRaw);
          if (!tokens.id_token) {
            res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
            return;
          }
          const verifyClient = new OAuth2Client(googleClientId);
          const ticket = await verifyClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: googleClientId,
          });
          const payload = ticket.getPayload();
          if (!payload) {
            res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
            return;
          }
          email = payload.email || '';
          name = payload.name || payload.given_name || email.split('@')[0];
          if (!payload.email_verified) {
            res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] google-dashboard-callback: OAuth code exchange failed: ${msg}`);
          res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
          return;
        }
      }

      // --- Validate and normalize email ---
      const normalizedEmail = normalizeEmail(email);
      if (!isValidEmail(normalizedEmail)) {
        console.error(`[ERROR] google-dashboard-callback: invalid email from Google: "${email}"`);
        res.redirect(302, `${safeRedirectBase}?error=auth_failed`);
        return;
      }

      // --- Find or create WebUser in users.json ---
      const users = readUsers();
      let user = users.find((u) => u.email === normalizedEmail) || null;
      if (!user) {
        const usedNicknames = new Set(users.map((u) => u.nickname));
        user = {
          userId: allocateUserId(),
          email: normalizedEmail,
          name: name.trim().slice(0, 80),
          nickname: buildNickname(name, normalizedEmail, usedNicknames),
          createdAt: nowIso(),
        };
        users.push(user);
        writeUsers(users);
      } else {
        const trimmedName = name.trim().slice(0, 80);
        if (trimmedName && user.name !== trimmedName) {
          user.name = trimmedName;
          writeUsers(users);
        }
      }

      // --- Load or generate guest keypair ---
      let chatSettings = loadChatSettings(user.userId);
      if (!chatSettings.ownerAddress || !chatSettings.ownerPrivateKey) {
        // Guest has no keypair yet — generate a new one
        let wallet: import('ethers').HDNodeWallet;
        try {
          wallet = ethers.Wallet.createRandom();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] guest keypair generation failed for email=${normalizedEmail}: ${msg}`);
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
        chatSettings.ownerAddress = wallet.address;
        chatSettings.ownerPrivateKey = wallet.privateKey;
        saveChatSettings(chatSettings);
        // Reload to ensure cache is fresh
        chatSettings = loadChatSettings(user.userId);
        console.log(`[AUDIT] guest wallet generated: email=${normalizedEmail}`);
      }

      // --- Register keypair for THIS dashboardId (idempotent — handles returning users on new dashboards) ---
      try {
        const registerResp = await fetch(`${AUTH_API_URL}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
          },
          body: JSON.stringify({
            address: chatSettings.ownerAddress,
            privateKey: chatSettings.ownerPrivateKey,
            email: normalizedEmail,
            dashboardId,
          }),
          signal: AbortSignal.timeout(10000),
        });

        // 409 means already registered for this user/dashboard — treat as success
        if (registerResp.status !== 201 && registerResp.status !== 409) {
          const body = await registerResp.text().catch(() => '');
          console.error(`[ERROR] guest keypair registration failed for email=${normalizedEmail}: Auth API register returned ${registerResp.status}: ${body}`);
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
        console.log(`[AUDIT] guest registered for dashboardId: email=${normalizedEmail} dashboardId=${dashboardId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] guest keypair registration failed for email=${normalizedEmail}: ${msg}`);
        res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
        return;
      }

      const guestPrivateKey = chatSettings.ownerPrivateKey!;

      // --- Validate invite token and grant access if valid ---
      const storedInviteToken = inviteTokens.get(dashboardUserIdStr);
      const isValidInvite = inviteToken && storedInviteToken && inviteToken === storedInviteToken;
      const _inv = inviteToken ? inviteToken.slice(0, 8) + '...' : 'NONE';
      const _stored = storedInviteToken ? storedInviteToken.slice(0, 8) + '...' : 'NONE';
      console.log(`[DEBUG] google-dashboard-callback: email=${normalizedEmail} dashboardId=${dashboardId} invite=${_inv} storedInvite=${_stored} isValidInvite=${isValidInvite}`);

      if (isValidInvite) {
        // Fetch dashboard owner's address for the share call
        const ownerSettings = loadChatSettings(dashboardUserId);
        const ownerAddress = ownerSettings.ownerAddress;
        if (!ownerAddress) {
          console.error(`[ERROR] google-dashboard-callback: dashboard owner ${dashboardUserId} has no ownerAddress`);
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }

        // Call POST /api/auth/share to grant guest access
        let shareOk = false;
        try {
          const shareResp = await fetch(`${AUTH_API_URL}/api/auth/share`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
            },
            body: JSON.stringify({
              dashboardId,
              email: normalizedEmail,
              ownerAddress,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (shareResp.status === 200) {
            shareOk = true;
          } else {
            const body = await shareResp.text().catch(() => '');
            console.error(`[ERROR] google-dashboard-callback: share failed for email=${normalizedEmail} dashboardId=${dashboardId}: status=${shareResp.status} body=${body}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] google-dashboard-callback: share call failed for email=${normalizedEmail}: ${msg}`);
        }

        if (!shareOk) {
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
      } else {
        // No valid invite — check if guest already has access via dashboard_access
        console.log(`[DEBUG] google-dashboard-callback: no valid invite, checking access-list for email=${normalizedEmail} dashboardId=${dashboardId}`);
        let alreadyHasAccess = false;
        try {
          const accessResp = await fetch(
            `${AUTH_API_URL}/api/auth/access-list?dashboardId=${encodeURIComponent(dashboardId)}`,
            {
              headers: {
                ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
              },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (accessResp.status === 200) {
            const accessBody = await accessResp.json() as { emails?: string[] };
            const emails: string[] = Array.isArray(accessBody.emails) ? accessBody.emails : [];
            alreadyHasAccess = emails.map((e) => normalizeEmail(e)).includes(normalizedEmail);
            console.log(`[DEBUG] google-dashboard-callback: access-list emails=${JSON.stringify(emails)} alreadyHasAccess=${alreadyHasAccess}`);
          } else {
            console.log(`[DEBUG] google-dashboard-callback: access-list returned status=${accessResp.status}`);
          }
        } catch (err) {
          // Access list check failed — treat as no access
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[DEBUG] google-dashboard-callback: access-list call failed: ${msg}`);
          alreadyHasAccess = false;
        }

        if (!alreadyHasAccess) {
          // Check if user is the dashboard owner — auto-grant access
          const ownerSettings = loadChatSettings(dashboardUserId);
          const ownerAddress = ownerSettings.ownerAddress;
          const guestAddress = chatSettings.ownerAddress;
          const isOwner = ownerAddress && guestAddress &&
            ownerAddress.toLowerCase() === guestAddress.toLowerCase();
          console.log(`[DEBUG] google-dashboard-callback: owner check — ownerAddress=${ownerAddress || 'NONE'} guestAddress=${guestAddress || 'NONE'} isOwner=${isOwner}`);

          if (isOwner) {
            // Owner logging in via Google for the first time — auto-share
            try {
              await fetch(`${AUTH_API_URL}/api/auth/share`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
                },
                body: JSON.stringify({ dashboardId, email: normalizedEmail, ownerAddress }),
                signal: AbortSignal.timeout(10000),
              });
              console.log(`[AUDIT] auto-shared owner access: email=${normalizedEmail} dashboardId=${dashboardId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[ERROR] google-dashboard-callback: auto-share owner failed: ${msg}`);
            }
          } else if (ownerSettings.accessMode === 'open') {
            // Open mode — auto-share any guest who signs in
            try {
              await fetch(`${AUTH_API_URL}/api/auth/share`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
                },
                body: JSON.stringify({ dashboardId, email: normalizedEmail, ownerAddress }),
                signal: AbortSignal.timeout(10000),
              });
              console.log(`[AUDIT] auto-shared open-mode guest: email=${normalizedEmail} dashboardId=${dashboardId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[ERROR] google-dashboard-callback: auto-share open-mode guest failed: ${msg}`);
            }
          } else {
            console.log(`[DEBUG] google-dashboard-callback: DENIED — email=${normalizedEmail} dashboardId=${dashboardId} (not owner, not in access-list, no invite)`);
            res.redirect(302, `${safeRedirectBase}?error=no_access`);
            return;
          }
        }
      }

      // --- Sign challenge and get dashboard JWT ---
      let dashboardJwt: string;
      try {
        const { challenge, signature } = await signChallenge(guestPrivateKey, dashboardId);
        const loginResp = await fetch(`${AUTH_API_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
          },
          body: JSON.stringify({ dashboardId, challenge, signature }),
          signal: AbortSignal.timeout(10000),
        });
        if (loginResp.status !== 200) {
          const body = await loginResp.text().catch(() => '');
          console.error(`[ERROR] google-dashboard-callback: login failed for email=${normalizedEmail} dashboardId=${dashboardId}: status=${loginResp.status} body=${body}`);
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
        const loginBody = await loginResp.json() as { token?: string };
        if (!loginBody.token) {
          console.error(`[ERROR] google-dashboard-callback: login response missing token for email=${normalizedEmail}`);
          res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
          return;
        }
        dashboardJwt = loginBody.token;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] google-dashboard-callback: signChallenge/login failed for email=${normalizedEmail}: ${msg}`);
        res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
        return;
      }

      console.log(`[AUDIT] guest login: email=${normalizedEmail} dashboardId=${dashboardId}`);

      // Clear dashboard logout flag (user is explicitly re-authenticating)
      const logoutCookies = parseCookieHeader(req.headers.cookie);
      const logoutSid = logoutCookies['webchat_session'];
      if (logoutSid) {
        const loggedOutSet = dashboardLogouts.get(logoutSid);
        if (loggedOutSet) {
          loggedOutSet.delete(dashboardId);
          if (loggedOutSet.size === 0) dashboardLogouts.delete(logoutSid);
        }
      }

      // --- Issue ml-token (5 min TTL) carrying dashboardJwt ---
      // BUG-FIX: userId must be the dashboard owner's userId (from redirect_to),
      // not the guest's userId. The /api/auth/ml handler inside d*.wpmix.net middleware
      // extracts userId from the Host header and checks entry.userId === userId.
      const mlToken = crypto.randomBytes(32).toString('hex');
      magicLinkTokens.set(mlToken, {
        userId: dashboardUserIdStr,
        expires: Date.now() + 5 * 60 * 1000,
        dashboardJwt,
      });

      // --- Redirect to dashboard with ml-token ---
      res.redirect(302, `${safeRedirectBase}?ml=${mlToken}`);
    } catch (outerErr) {
      const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
      console.error(`[ERROR] google-dashboard-callback: unhandled error: ${msg}`);
      res.redirect(302, `${safeRedirectBase}?error=service_unavailable`);
    }
  });

	  app.get('/profile', requireSessionPage, async (req, res) => {
	    const user = getReqUser(req);
	    const chatSettings = loadChatSettings(user.userId);
	    const ownerAddress = chatSettings.ownerAddress || '';

	    // Fetch guest email list from auth API (only when ownerAddress is set)
	    let guestEmails: string[] = [];
	    if (ownerAddress) {
	      try {
	        const dashboardId = `d${user.userId}`;
	        const accessResp = await fetch(
	          `${AUTH_API_URL}/api/auth/access-list?dashboardId=${encodeURIComponent(dashboardId)}`,
	          {
	            headers: {
	              ...(INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : {}),
	            },
	            signal: AbortSignal.timeout(8000),
	          }
	        );
	        if (accessResp.status === 200) {
	          const accessBody = await accessResp.json() as { emails?: string[] };
	          guestEmails = Array.isArray(accessBody.emails) ? accessBody.emails : [];
	        } else {
	          console.warn(`[WARN] profile: access-list fetch returned status ${accessResp.status}`);
	        }
	      } catch (err) {
	        const msg = err instanceof Error ? err.message : String(err);
	        console.warn(`[WARN] profile: access-list fetch failed: ${msg}`);
	      }
	    }
	    // Webchat UI is served as a single HTML page with inline JS/CSS.
	    // Disable caching so users don't get stuck on older timer logic after deploys.
	    res.setHeader('Cache-Control', 'no-store, max-age=0');
	    res.setHeader('Pragma', 'no-cache');
	    res.setHeader('Expires', '0');
	    res.setHeader('Content-Type', 'text/html; charset=utf-8');
	    res.end(`<!doctype html>
	<html lang="en">
	<head>
	  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Profile</title>
  <style>
    body { margin: 0; padding: 24px; background: #f8fafc; color: rgba(15,23,42,0.92); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .card { max-width: 720px; margin: 0 auto; border: 1px solid rgba(2,6,23,0.10); border-radius: 18px; padding: 18px; background: rgba(2,6,23,0.03); }
    h1 { margin: 0 0 14px 0; font-size: 16px; }
    .row { margin: 8px 0; color: rgba(15,23,42,0.80); }
    .row code { background: rgba(2,6,23,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
    a { color: rgba(37,99,235,0.92); text-decoration: none; }
    .danger-zone { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(239,68,68,0.20); }
    .btn-delete { background: none; border: 1px solid rgba(239,68,68,0.50); color: rgba(239,68,68,0.85); border-radius: 6px; padding: 5px 12px; font-size: 13px; cursor: pointer; font-family: inherit; }
    .btn-delete:hover { background: rgba(239,68,68,0.07); border-color: rgba(239,68,68,0.80); }
    .mobile-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(2,6,23,0.10); }
    .mobile-section h2 { font-size: 14px; margin: 0 0 8px 0; }
    .mobile-section p { font-size: 13px; color: rgba(15,23,42,0.70); margin: 0 0 12px 0; }
    .btn-qr { background: #3B82F6; color: white; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
    .btn-qr:hover { background: #2563EB; }
    .btn-qr:disabled { background: #93C5FD; cursor: default; }
    #qrResult { margin-top: 14px; display: none; }
    #qrCanvas { display: block; margin: 0 auto 10px; }
    #qrUrl { font-size: 11px; word-break: break-all; background: rgba(2,6,23,0.06); padding: 6px 8px; border-radius: 4px; cursor: pointer; user-select: all; }
    .qr-hint { font-size: 12px; color: rgba(15,23,42,0.55); margin-top: 8px; text-align: center; }
    .qr-steps { margin-top: 10px; font-size: 12px; color: rgba(15,23,42,0.65); padding-left: 0; list-style: none; }
    .qr-steps li { margin: 4px 0; }
    .qr-steps li::before { content: attr(data-n) ". "; font-weight: 600; }
    .share-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(2,6,23,0.10); }
    .share-section h2 { font-size: 14px; margin: 0 0 8px 0; }
    .share-section p { font-size: 13px; color: rgba(15,23,42,0.70); margin: 0 0 12px 0; }
    .btn-invite { background: #3B82F6; color: white; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
    .btn-invite:hover { background: #2563EB; }
    .btn-invite:disabled { background: #93C5FD; cursor: default; }
    .btn-revoke { background: none; border: 1px solid rgba(2,6,23,0.25); color: rgba(15,23,42,0.80); border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; font-family: inherit; margin-left: 8px; }
    .btn-revoke:hover { background: rgba(2,6,23,0.04); border-color: rgba(2,6,23,0.40); }
    .btn-revoke:disabled { opacity: 0.5; cursor: default; }
    #inviteResult { margin-top: 14px; display: none; }
    #inviteResult code { font-size: 11px; word-break: break-all; background: rgba(2,6,23,0.06); padding: 6px 8px; border-radius: 4px; cursor: pointer; user-select: all; display: block; }
    .guest-list { list-style: none; padding: 0; margin: 8px 0 0 0; }
    .guest-list li { font-size: 13px; color: rgba(15,23,42,0.75); margin: 4px 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Profile</h1>
    <div class="row">User ID: ${user.userId}</div>
    <div class="row">Name: ${escapeHtml(user.name)}</div>
    <div class="row">Email: ${escapeHtml(user.email)}</div>
    <div class="row">Nickname: ${escapeHtml(user.nickname)}</div>
    <div class="row">Domain: <a href="https://d${user.userId}.wpmix.net" target="_blank">d${user.userId}.wpmix.net</a></div>
    ${ownerAddress ? `<div class="row">Wallet Address: <code>${escapeHtml(ownerAddress)}</code></div>` : ''}

    <div id="mobile-section" class="mobile-section">
      <h2>📱 Открыть на телефоне</h2>
      <p>Сгенерируйте QR-код для доступа к дашборду с мобильного устройства без расширения.<br>Ссылка действует 24 часа.</p>
      <button class="btn-qr" id="btnQr" onclick="generateMagicLink()">Сгенерировать QR-код</button>
      <div id="qrResult">
        <canvas id="qrCanvas"></canvas>
        <div id="qrUrl" title="Нажмите чтобы скопировать"></div>
        <div class="qr-hint">Откройте камеру → наведите → нажмите на ссылку</div>
        <ol class="qr-steps">
          <li data-n="1">Откройте камеру на телефоне</li>
          <li data-n="2">Наведите на QR-код (не нажимая кнопку съёмки)</li>
          <li data-n="3">Нажмите на всплывающую ссылку</li>
        </ol>
      </div>
    </div>

    ${ownerAddress ? `
    <div class="share-section">
      <h2>Поделиться дашбордом</h2>
      <p>Создайте invite-ссылку и отправьте гостю. По ссылке гость авторизуется через Google и получит доступ к вашему дашборду.</p>
      <button class="btn-invite" id="btnInvite" onclick="createInvite()">Создать invite-ссылку</button>
      <button class="btn-revoke" id="btnRevoke" onclick="revokeInvite()">Отозвать ссылку</button>
      <div id="inviteResult"></div>
      <div style="margin-top: 16px;">
        <strong style="font-size: 13px;">Гости с доступом:</strong>
        ${guestEmails.length > 0
          ? `<ul class="guest-list">${guestEmails.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
          : `<div style="font-size: 13px; color: rgba(15,23,42,0.55); margin-top: 4px;">Нет гостей с доступом.</div>`
        }
      </div>
    </div>
    ` : ''}

    <div class="row" style="margin-top:16px;"><a href="/">Back to chat</a> · <a href="/logout">Logout</a></div>
    <div class="danger-zone">
      <button class="btn-delete" onclick="deleteAccount()">Delete account</button>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script>
    function deleteAccount() {
      if (!confirm('Delete your account?\\n\\nThis will permanently remove all your data and dashboards. This action cannot be undone.')) return;
      fetch('/api/delete-account', { method: 'POST' })
        .then(function(r) { if (r.ok) window.location.href = '/'; })
        .catch(function() { alert('Error. Please try again.'); });
    }
    function generateMagicLink() {
      var btn = document.getElementById('btnQr');
      btn.disabled = true;
      btn.textContent = 'Генерация...';
      fetch('/api/auth/magic-link', { method: 'POST' })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(d) {
          var canvas = document.getElementById('qrCanvas');
          QRCode.toCanvas(canvas, d.url, { width: 220, margin: 2 }, function(err) {
            if (!err) {
              var urlEl = document.getElementById('qrUrl');
              urlEl.textContent = d.url;
              urlEl.onclick = function() {
                navigator.clipboard && navigator.clipboard.writeText(d.url).then(function() {
                  urlEl.textContent = '✓ Скопировано!';
                  setTimeout(function() { urlEl.textContent = d.url; }, 2000);
                });
              };
              document.getElementById('qrResult').style.display = 'block';
              btn.textContent = 'Обновить QR-код';
              btn.disabled = false;
            }
          });
        })
        .catch(function() {
          alert('Ошибка генерации ссылки. Попробуйте ещё раз.');
          btn.textContent = 'Сгенерировать QR-код';
          btn.disabled = false;
        });
    }
    function createInvite() {
      var btn = document.getElementById('btnInvite');
      btn.disabled = true;
      btn.textContent = 'Генерация...';
      fetch('/api/auth/invite', { method: 'POST' })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(d) {
          var resultEl = document.getElementById('inviteResult');
          resultEl.innerHTML = '<code id="inviteUrl"></code>';
          var codeEl = document.getElementById('inviteUrl');
          codeEl.textContent = d.url;
          codeEl.onclick = function() {
            navigator.clipboard && navigator.clipboard.writeText(d.url).then(function() {
              codeEl.textContent = '\\u2713 Скопировано!';
              setTimeout(function() { codeEl.textContent = d.url; }, 2000);
            });
          };
          resultEl.style.display = 'block';
          btn.textContent = 'Создать invite-ссылку';
          btn.disabled = false;
        })
        .catch(function() {
          alert('Ошибка. Попробуйте ещё раз.');
          btn.textContent = 'Создать invite-ссылку';
          btn.disabled = false;
        });
    }
    function revokeInvite() {
      var btn = document.getElementById('btnRevoke');
      btn.disabled = true;
      btn.textContent = 'Отзыв...';
      fetch('/api/auth/invite/revoke', { method: 'POST' })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(d) {
          var resultEl = document.getElementById('inviteResult');
          resultEl.innerHTML = '<code id="inviteUrl"></code>';
          var codeEl = document.getElementById('inviteUrl');
          codeEl.textContent = d.url;
          codeEl.onclick = function() {
            navigator.clipboard && navigator.clipboard.writeText(d.url).then(function() {
              codeEl.textContent = '\\u2713 Скопировано!';
              setTimeout(function() { codeEl.textContent = d.url; }, 2000);
            });
          };
          resultEl.style.display = 'block';
          btn.textContent = 'Отозвать ссылку';
          btn.disabled = false;
        })
        .catch(function() {
          alert('Ошибка. Попробуйте ещё раз.');
          btn.textContent = 'Отозвать ссылку';
          btn.disabled = false;
        });
    }
    if (location.hash === '#mobile') {
      document.getElementById('mobile-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  </script>
</body>
</html>`);
  });

  app.get('/login', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/${query}`);
  });

  app.get('/app', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/${query}`);
  });

	  app.get('/', (req, res) => {
      if (shouldRenderExtensionLandingAtRoot(req)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderExtensionLandingHtml());
        return;
      }

	    // Webchat UI is served as a single HTML page with inline JS/CSS.
	    // Disable caching so users don't get stuck on older timer logic after deploys.
	    res.setHeader('Cache-Control', 'no-store, max-age=0');
	    res.setHeader('Pragma', 'no-cache');
	    res.setHeader('Expires', '0');
	    res.setHeader('Content-Type', 'text/html; charset=utf-8');
	    res.end(renderAppHtml());
	  });

  app.get('/api/me', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
      },
      bot: {
        title: getWebchatTitle(),
        subtitle: getWebchatSubtitle(),
      }
    });
  });

  app.get('/api/history', requireSessionApi, async (req, res) => {
    const user = getReqUser(req);
    let messages = readChatTranscript(user.userId);

    // CHANGE: Auto-initialize /start for localhost user on first visit
    // WHY: Tests expect /start to be initialized automatically for new users
    // REF: test_webchat_flow.py
    const shouldInitWithStart = process.env.WEBCHAT_INIT_WITH_START !== 'false';
    if (shouldInitWithStart && messages.length === 0 && isLocalhost(req)) {
      try {
        await botEngine.processIncomingTextMessage(buildTextCtx(user, '/start'));
        messages = readChatTranscript(user.userId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to init /start for localhost userId=${user.userId}: ${msg}`);
      }
    }

    // Fallback for authenticated users with empty history when /start is disabled:
    // write the configured WEBCHAT_INIT_MESSAGE so the chat is never blank on load.
    // This also handles users who logged in before the auth-time init was added.
    if (!shouldInitWithStart && messages.length === 0) {
      const clientLang = typeof req.query['lang'] === 'string' ? req.query['lang'] : botLanguage;
      const sdShowcasesUrl = isSimpleDashboardProduct() ? buildSimpleDashboardShowcasesUrl(buildBaseUrl(req), '', 'examples') : undefined;
      maybeWriteInitMessageTranscript(user.userId, clientLang, sdShowcasesUrl);
      messages = readChatTranscript(user.userId);
    }

    res.json({ messages });
  });

  app.post('/api/history/clear', requireSessionApi, (req, res) => {
    if (!isLocalhost(req)) {
      res.status(403).json({ error: 'History clear is allowed only on localhost' });
      return;
    }
    const user = getReqUser(req);
    writeChatTranscript(user.userId, []);

    // CHANGE: При /clear сбрасываем настройки чата к дефолту
    // WHY: User request - "/clear пусть возвращает исходное состояние"
    // REF: User request 2026-02-18
    const chatSettings = loadChatSettings(user.userId);
    chatSettings.useBwrap = undefined; // Reset to global default
    saveChatSettings(chatSettings);
    console.log(`🧹 [${new Date().toISOString()}] Chat ${user.userId} cleared: history + settings reset to default`);

    res.json({ ok: true, messages: [] });
  });

  app.post('/api/message', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const textRaw = typeof req.body?.text === 'string' ? req.body.text : '';
    const text = textRaw.trim().slice(0, 8000);
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const ip = getClientIp(req);
    // CHANGE: Apply AI rate limit - 10 requests per minute per user
    // WHY: User request "Rate limit exceeded - тут я имел в виду именно запросы к ии"
    // REF: User message 2026-02-17
    if (!enforceRateLimit(req, res, [
      { limiter: rlMessageUser1m, key: String(user.userId) },
      { limiter: rlMessageUser10s, key: String(user.userId) },
      { limiter: rlMessageIp10s, key: ip },
      { limiter: rlMessageIp10m, key: ip },
    ])) {
      return;
    }

    // CHANGE: Persist ownerAddress from extension in ChatSettings
    // WHY: Survives pm2 restarts; Claude needs it to generate auth-enabled dashboards
    // REF: dashboard-web3-auth feature
    const ownerAddressRaw = typeof req.body?.ownerAddress === 'string' ? req.body.ownerAddress.trim() : '';
    if (ownerAddressRaw && /^0x[0-9a-fA-F]{40}$/.test(ownerAddressRaw)) {
      const chatSettings = loadChatSettings(user.userId);
      chatSettings.ownerAddress = ownerAddressRaw;
      saveChatSettings(chatSettings);
    }

    // CHANGE: Attach dashboard context (URL + screenshot) to Claude's prompt
    // WHY: User on d*.wpmix.net wants Claude to see current dashboard state
    // REF: User request 2026-03-03
    const dashboardUrlRaw = typeof req.body?.dashboardUrl === 'string' ? req.body.dashboardUrl.trim() : '';
    const dashboardScreenshotRaw = typeof req.body?.dashboardScreenshot === 'string' ? req.body.dashboardScreenshot : '';
    // CHANGE: Accept any URL (not just d*.wpmix.net) — user explicitly enabled screenshot
    // WHY: User had active tab on different URL, URL restriction silently dropped the screenshot
    // REF: User request 2026-03-04
    const dashboardUrl = dashboardUrlRaw.slice(0, 500);

    let screenshotNote = '';
    let screenshotUrl: string | undefined;
    if (dashboardUrl && dashboardScreenshotRaw && dashboardScreenshotRaw.startsWith('data:image/')) {
      try {
        const base64Data = dashboardScreenshotRaw.replace(/^data:image\/[a-z]+;base64,/, '');
        const sizeKb = Math.round(base64Data.length / 1024);
        console.log(`📸 [dashboard-ctx] user=${user.userId} url=${dashboardUrl} screenshot=${sizeKb}kb`);
        if (base64Data.length <= 4_000_000) {
          const screenshotPath = path.join(WORKSPACES_ROOT, `user_${user.userId}`, 'current_dashboard_screenshot.png');
          fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
          console.log(`📸 [dashboard-ctx] saved → ${screenshotPath}`);
          // CHANGE: Use absolute bwrap path /work/... so Claude finds the file
          screenshotNote = `\n\n[Контекст: пользователь смотрит страницу ${dashboardUrl}. Скриншот сохранён в /work/current_dashboard_screenshot.png — ОБЯЗАТЕЛЬНО прочитай файл через Read tool перед ответом.]`;
          screenshotUrl = '/api/screenshot';
        } else {
          console.log(`📸 [dashboard-ctx] screenshot too large (${sizeKb}kb > 4000kb), skipped`);
        }
      } catch (_e) {}
    } else if (dashboardUrl) {
      console.log(`📸 [dashboard-ctx] user=${user.userId} url=${dashboardUrl} (no screenshot)`);
      screenshotNote = `\n\n[Контекст: пользователь смотрит страницу ${dashboardUrl}]`;
    } else {
      console.log(`📸 [dashboard-ctx] user=${user.userId} no dashboard context (raw url="${dashboardUrlRaw}", ss=${dashboardScreenshotRaw ? dashboardScreenshotRaw.slice(0,30) : 'none'})`);
    }

    const textForClaude = screenshotNote ? text + screenshotNote : text;
    const ctx = buildTextCtx(user, textForClaude, screenshotUrl);
    void botEngine.processIncomingTextMessage(ctx).catch(async (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      const { reply } = createCtxHelpers(user);
      await reply(`❌ Internal error: ${msg.slice(0, 800)}`);
    });
    res.json({ ok: true });
  });

  // CHANGE: Serve screenshot captured by extension for current user
  // WHY: Screenshot is saved per-user; needs auth so only owner can view it
  // REF: User request 2026-03-04 "показывай скриншот в истории чата"
  app.get('/api/screenshot', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const screenshotPath = path.join(WORKSPACES_ROOT, `user_${user.userId}`, 'current_dashboard_screenshot.png');
    if (!fs.existsSync(screenshotPath)) {
      res.status(404).send('No screenshot');
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(screenshotPath).pipe(res);
  });

  app.post('/api/callback', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const data = typeof req.body?.callback_data === 'string' ? req.body.callback_data : '';
    const messageIdRaw = req.body?.message_id;
    const messageId = typeof messageIdRaw === 'number' ? messageIdRaw : Number(messageIdRaw);
    if (!data) {
      res.status(400).json({ error: 'callback_data is required' });
      return;
    }
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      res.status(400).json({ error: 'message_id is required' });
      return;
    }

    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [
      { limiter: rlCallbackUser10s, key: String(user.userId) },
      { limiter: rlCallbackUser10m, key: String(user.userId) },
      { limiter: rlCallbackIp10s, key: ip },
      { limiter: rlCallbackIp10m, key: ip },
    ])) {
      return;
    }

    const ctx = buildCallbackCtx(user, data, messageId);
    void botEngine.processIncomingCallbackQuery(ctx).catch(async (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      const { reply } = createCtxHelpers(user);
      await reply(`❌ Internal error: ${msg.slice(0, 800)}`);
    });
    res.json({ ok: true });
  });

  const FEEDBACK_LOG_PATH = path.join(WEBCHAT_DATA_DIR, 'feedback_log.jsonl');

  app.post('/api/feedback', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const messageIdRaw = req.body?.message_id;
    const messageId = typeof messageIdRaw === 'number' ? messageIdRaw : Number(messageIdRaw);
    const feedbackRaw = typeof req.body?.feedback_type === 'string' ? req.body.feedback_type : '';
    const feedback = feedbackRaw.trim().toLowerCase();
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';

    const feedbackType: WebMessageFeedbackType | null =
      feedback === 'thumbs_up' || feedback === 'up' || feedback === 'like'
        ? 'thumbs_up'
        : (feedback === 'thumbs_down' || feedback === 'down' || feedback === 'dislike'
          ? 'thumbs_down'
          : null);

    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      res.status(400).json({ error: 'message_id is required' });
      return;
    }
    if (!feedbackType) {
      res.status(400).json({ error: 'feedback_type must be thumbs_up or thumbs_down' });
      return;
    }

    const ip = getClientIp(req);
    if (!enforceRateLimit(req, res, [
      { limiter: rlFeedbackUser10s, key: String(user.userId) },
      { limiter: rlFeedbackUser1h, key: String(user.userId) },
      { limiter: rlFeedbackIp10s, key: ip },
      { limiter: rlFeedbackIp1h, key: ip },
    ])) {
      return;
    }

    const messages = readChatTranscript(user.userId);
    const msg = messages.find((m) => m.id === messageId) || null;
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (msg.role !== 'assistant' || msg.deletedAt) {
      res.status(400).json({ error: 'Feedback is allowed only for assistant messages' });
      return;
    }

    const current = msg.feedback && msg.feedback.type ? msg.feedback.type : null;
    if (current === feedbackType && !comment) {
      msg.feedback = null; // toggle off
    } else {
      msg.feedback = { type: feedbackType, at: nowIso(), ...(comment ? { comment } : {}) };
    }

    writeChatTranscript(user.userId, messages);
    sseSend(user.userId, 'message_update', msg);

    // Append to feedback log for analysis
    let feedbackRef = '';
    if (msg.feedback) {
      feedbackRef = crypto.randomBytes(5).toString('hex'); // e.g. "a3f9c1b2e4"
      try {
        const logEntry = JSON.stringify({
          ref: feedbackRef,
          at: msg.feedback.at,
          userId: user.userId,
          messageId,
          type: msg.feedback.type,
          comment: msg.feedback.comment || '',
          messagePreview: msg.text ? msg.text.slice(0, 200) : '',
        });
        fs.appendFileSync(FEEDBACK_LOG_PATH, logEntry + '\n', 'utf8');
      } catch (_e) { /* non-critical */ }
    }

    console.log(`✅ Feedback saved: userId=${user.userId}, messageId=${messageId}, type=${msg.feedback ? msg.feedback.type : 'none'}${comment ? ', comment=' + comment.slice(0, 60) : ''}${feedbackRef ? ' ref=' + feedbackRef : ''}`);
    res.json({ ok: true, message: msg, ref: feedbackRef || null });
  });

  app.get('/api/stream', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const ip = getClientIp(req);

    const maxSsePerUser = 4;
    const maxSsePerIp = 30;

    let activeForUser = 0;
    let activeForIp = 0;
    for (const client of Array.from(sseClients)) {
      if (client.userId === user.userId) activeForUser += 1;
      if (client.ip === ip) activeForIp += 1;
    }
    if (activeForUser >= maxSsePerUser || activeForIp >= maxSsePerIp) {
      res.status(429).json({ error: 'Too many open streams' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Hint for nginx reverse proxies (common SSE issue: buffering prevents any events from reaching the browser).
      'X-Accel-Buffering': 'no',
    });
    try {
      // Flush headers ASAP (best-effort; not available on all runtimes).
      (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
    } catch {}
    res.write(`event: ping\ndata: {}\n\n`);

    const client: SseClient = { userId: user.userId, ip, res };
    sseClients.add(client);

    const timer = setInterval(() => {
      try {
        res.write(`event: ping\ndata: {}\n\n`);
      } catch {
        clearInterval(timer);
        sseClients.delete(client);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(timer);
      sseClients.delete(client);
    });
  });

  // Sentry error handler (must be before fallback middleware)
  Sentry.setupExpressErrorHandler(app);

  // Fallback: redirect authed users to /app, others to /login.
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const user = ensureAuthed(req);
    res.redirect(user ? '/app' : '/login');
  });

  const port = getWebchatPort();
  app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Webchat listening on http://0.0.0.0:${port} (title="${getWebchatTitle()}")`);
  });
}

void main();
