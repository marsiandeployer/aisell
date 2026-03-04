#!/usr/bin/env tsx
/**
 * Auth API service for SimpleDashboard Web3 authentication.
 *
 * Provides Ethereum-based authentication via ecrecover:
 *   POST /api/auth/register — server-to-server from webchat (stores owner keypair)
 *   POST /api/auth/login    — from dashboard browser (verifies signature, returns JWT)
 *   POST /api/auth/share    — server-to-server (grants access by email lookup)
 *   GET  /api/auth/health   — health check with PG status
 *
 * Standalone Express service on port 8095, backed by PostgreSQL on LXC 102.
 */

import express from 'express';
import { ethers } from 'ethers';
import pg from 'pg';
import jwt from 'jsonwebtoken';

// ─── Environment Validation (fail fast) ──────────────────────────

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
if (!INTERNAL_API_KEY) throw new Error('INTERNAL_API_KEY env var is required');

const PG_HOST = process.env.PG_HOST;
if (!PG_HOST) throw new Error('PG_HOST env var is required');

const PG_DB = process.env.PG_DB;
if (!PG_DB) throw new Error('PG_DB env var is required');

const PG_USER = process.env.PG_USER;
if (!PG_USER) throw new Error('PG_USER env var is required');

const PG_PASSWORD = process.env.PG_PASSWORD;
if (!PG_PASSWORD) throw new Error('PG_PASSWORD env var is required');

const AUTH_API_PORT = parseInt(process.env.AUTH_API_PORT || '8095', 10);

// ─── Rate Limiter (copied from webchat.ts lines 213-276) ────────

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

// ─── IP Normalization (from webchat.ts lines 283-294) ────────────

function normalizeIp(ipRaw: string): string {
  const ip = String(ipRaw || '').trim();
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function getClientIp(req: express.Request): string {
  const fromExpress = normalizeIp(req.ip || '');
  if (fromExpress) return fromExpress;
  const fromSocket = normalizeIp(String(req.socket?.remoteAddress || ''));
  return fromSocket || 'unknown';
}

// ─── PostgreSQL Connection Pool ──────────────────────────────────

const pool = new pg.Pool({
  host: PG_HOST,
  database: PG_DB,
  user: PG_USER,
  password: PG_PASSWORD,
  port: 5432,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log PG pool errors (do not crash the process)
pool.on('error', (err) => {
  console.error('[auth-api] PG pool background error:', err.message);
});

// ─── Express App Setup ───────────────────────────────────────────

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '16kb' }));

// ─── CORS Middleware ─────────────────────────────────────────────
// CHANGE: Restrict CORS to dashboard subdomain pattern only
// QUOTE(tech-spec): "CORS restricted to origins matching ^https://d\d+\.wpmix\.net$"
// REF: Decision 6

const DASHBOARD_ORIGIN_RE = /^https:\/\/d\d+\.wpmix\.net$/;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && DASHBOARD_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// ─── Rate Limiter Instances ──────────────────────────────────────

const rlRegisterIp1h = new SlidingWindowRateLimiter('register-ip-1h', 60 * 60 * 1000, 10);
const rlLoginIp1h = new SlidingWindowRateLimiter('login-ip-1h', 60 * 60 * 1000, 30);

// Periodic sweep every 10 minutes to free memory
setInterval(() => {
  const now = Date.now();
  rlRegisterIp1h.sweep(now);
  rlLoginIp1h.sweep(now);
}, 10 * 60 * 1000);

// ─── Input Validation Helpers ────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(addr: string): boolean {
  return typeof addr === 'string' && ADDRESS_RE.test(addr);
}

function isValidEmail(email: string): boolean {
  return typeof email === 'string' && email.includes('@');
}

/**
 * Validates the internal API key from the Authorization header.
 * Returns true if valid, false otherwise.
 */
function validateInternalApiKey(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  return parts[1] === INTERNAL_API_KEY;
}

/**
 * Middleware that requires a valid internal API key.
 */
function requireInternalApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!validateInternalApiKey(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * Sends a 429 rate limit response with retryAfterSeconds.
 */
function sendRateLimitError(res: express.Response, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: 'Too many requests', retryAfterSeconds });
}

// ─── Endpoints ───────────────────────────────────────────────────

/**
 * GET /api/auth/health
 * Returns service and PG connection status.
 */
app.get('/api/auth/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', pg: 'connected' });
  } catch (err) {
    console.error('[auth-api] Health check PG error:', (err as Error).message);
    res.status(503).json({ status: 'error', pg: 'error' });
  }
});

/**
 * POST /api/auth/register
 * Server-to-server: stores owner keypair and dashboard mapping.
 *
 * Body: { address, email, privateKey, dashboardId }
 * Requires: Authorization: Bearer <INTERNAL_API_KEY>
 * Returns: 201 { address, dashboardId }
 */
app.post('/api/auth/register', requireInternalApiKey, async (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // Rate limiting
  const rlCheck = rlRegisterIp1h.check(ip, now);
  if (!rlCheck.ok) {
    sendRateLimitError(res, rlCheck.retryAfterMs);
    return;
  }
  rlRegisterIp1h.consume(ip, now);

  const { address, email, privateKey, dashboardId } = req.body;

  // Input validation
  if (!isValidAddress(address)) {
    res.status(400).json({ error: 'Invalid address format. Expected 0x followed by 40 hex characters.' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format.' });
    return;
  }
  if (!privateKey || typeof privateKey !== 'string') {
    res.status(400).json({ error: 'privateKey is required.' });
    return;
  }
  if (!dashboardId || typeof dashboardId !== 'string') {
    res.status(400).json({ error: 'dashboardId is required.' });
    return;
  }

  try {
    // Normalize address to checksummed format
    const normalizedAddress = ethers.getAddress(address);

    // Step 1: Insert user
    const userResult = await pool.query(
      'INSERT INTO users (address, email, private_key) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id',
      [normalizedAddress, email, privateKey]
    );

    if (userResult.rows.length === 0) {
      // Email already exists (ON CONFLICT hit)
      res.status(409).json({
        error: 'Email already registered',
        message: 'Напишите в support@onout.org', // cyrillic-ok
      });
      return;
    }

    // Step 2: Insert dashboard
    await pool.query(
      'INSERT INTO dashboards (dashboard_id, owner_address) VALUES ($1, $2) ON CONFLICT (dashboard_id) DO NOTHING',
      [dashboardId, normalizedAddress]
    );

    // Step 3: Grant owner access
    await pool.query(
      'INSERT INTO dashboard_access (dashboard_id, address, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [dashboardId, normalizedAddress, normalizedAddress]
    );

    console.log(`[auth-api] Registered: ${normalizedAddress} for dashboard ${dashboardId}`);
    res.status(201).json({ address: normalizedAddress, dashboardId });
  } catch (err) {
    console.error('[auth-api] Register PG error:', (err as Error).message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

/**
 * POST /api/auth/login
 * From dashboard browser: verifies Ethereum signature, returns JWT.
 *
 * Body: { signature, challenge, dashboardId }
 * Returns: 200 { token }
 */
app.post('/api/auth/login', async (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // Rate limiting
  const rlCheck = rlLoginIp1h.check(ip, now);
  if (!rlCheck.ok) {
    sendRateLimitError(res, rlCheck.retryAfterMs);
    return;
  }
  rlLoginIp1h.consume(ip, now);

  const { signature, challenge, dashboardId } = req.body;

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'signature is required.' });
    return;
  }
  if (!challenge || typeof challenge !== 'string') {
    res.status(400).json({ error: 'challenge is required.' });
    return;
  }
  if (!dashboardId || typeof dashboardId !== 'string') {
    res.status(400).json({ error: 'dashboardId is required.' });
    return;
  }

  // Challenge validation order per spec:
  // 1. Parse JSON
  let parsed: { dashboardId?: string; timestamp?: number; nonce?: string };
  try {
    parsed = JSON.parse(challenge);
  } catch {
    res.status(400).json({ error: 'Challenge is not valid JSON.' });
    return;
  }

  // 2. Check required fields
  if (!parsed.dashboardId || !parsed.nonce) {
    res.status(400).json({ error: 'Challenge missing required fields: dashboardId, timestamp, nonce.' });
    return;
  }

  // 3. Check timestamp is a number
  if (typeof parsed.timestamp !== 'number') {
    res.status(400).json({ error: 'Challenge timestamp must be a number.' });
    return;
  }

  // 4. Check timestamp freshness (401, not 400 — structurally valid but timed out)
  if (Date.now() - parsed.timestamp > 5 * 60 * 1000) {
    res.status(401).json({ error: 'Unauthorized', reason: 'Challenge expired' });
    return;
  }

  // Verify signature via ecrecover
  let recoveredAddress: string;
  try {
    recoveredAddress = ethers.verifyMessage(challenge, signature);
    recoveredAddress = ethers.getAddress(recoveredAddress);
  } catch {
    // Malformed signature — not a valid ecrecover input
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Check access in database
  try {
    const result = await pool.query(
      'SELECT 1 FROM dashboard_access WHERE dashboard_id = $1 AND address = $2',
      [dashboardId, recoveredAddress]
    );

    if (result.rows.length === 0) {
      // Valid signature but address not in access list for this dashboard
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Issue JWT
    const token = jwt.sign(
      { address: recoveredAddress, dashboardId },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log(`[auth-api] Login: ${recoveredAddress} for dashboard ${dashboardId}`);
    res.json({ token });
  } catch (err) {
    console.error('[auth-api] Login PG error:', (err as Error).message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

/**
 * POST /api/auth/share
 * Server-to-server: grants a second user access to a dashboard by email lookup.
 *
 * Body: { dashboardId, email, ownerAddress }
 * Requires: Authorization: Bearer <INTERNAL_API_KEY>
 * Returns: 200 { address, email }
 */
app.post('/api/auth/share', requireInternalApiKey, async (req, res) => {
  const { dashboardId, email, ownerAddress } = req.body;

  // Input validation
  if (!dashboardId || typeof dashboardId !== 'string') {
    res.status(400).json({ error: 'dashboardId is required.' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email format.' });
    return;
  }
  if (!isValidAddress(ownerAddress)) {
    res.status(400).json({ error: 'Invalid ownerAddress format.' });
    return;
  }

  try {
    const normalizedOwner = ethers.getAddress(ownerAddress);

    // Step 1: Look up target user by email
    const userResult = await pool.query(
      'SELECT address FROM users WHERE email = $1',
      [email]
    );
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found', message: 'Пользователь не зарегистрирован' }); // cyrillic-ok
      return;
    }
    const targetAddress = userResult.rows[0].address as string;

    // Step 2: Verify ownerAddress is the dashboard owner
    const dashResult = await pool.query(
      'SELECT owner_address FROM dashboards WHERE dashboard_id = $1',
      [dashboardId]
    );
    if (dashResult.rows.length === 0) {
      res.status(404).json({ error: 'Dashboard not found' });
      return;
    }
    const actualOwner = dashResult.rows[0].owner_address as string;
    if (ethers.getAddress(actualOwner) !== normalizedOwner) {
      res.status(403).json({ error: 'Forbidden', message: 'Only the dashboard owner can share access.' });
      return;
    }

    // Step 3: Grant access
    await pool.query(
      'INSERT INTO dashboard_access (dashboard_id, address, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [dashboardId, targetAddress, normalizedOwner]
    );

    console.log(`[auth-api] Share: ${normalizedOwner} shared dashboard ${dashboardId} with ${email} (${targetAddress})`);
    res.json({ address: targetAddress, email });
  } catch (err) {
    console.error('[auth-api] Share PG error:', (err as Error).message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

/**
 * GET /api/auth/access-list
 * Server-to-server: returns all guest emails that have access to a dashboard.
 *
 * Query params: dashboardId — the dashboard identifier (required, non-empty string)
 * Requires: Authorization: Bearer <INTERNAL_API_KEY>
 * Returns: 200 { emails: string[] } — list of guest emails (empty array if none found)
 */
app.get('/api/auth/access-list', requireInternalApiKey, async (req, res) => {
  const dashboardId = req.query.dashboardId;

  // Input validation: dashboardId must be a non-empty string
  if (typeof dashboardId !== 'string' || !dashboardId) {
    res.status(400).json({ error: 'dashboardId query parameter is required.' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT u.email FROM dashboard_access da JOIN users u ON da.address = u.address WHERE da.dashboard_id = $1',
      [dashboardId]
    );

    const emails = result.rows.map(r => r.email as string);
    console.log(`[auth-api] Access-list: dashboard ${dashboardId} has ${emails.length} guest(s)`);
    res.json({ emails });
  } catch (err) {
    console.error('[auth-api] Access-list PG error:', (err as Error).message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

// ─── Start Server ────────────────────────────────────────────────

app.listen(AUTH_API_PORT, () => {
  console.log(`[auth-api] Auth API listening on port ${AUTH_API_PORT}`);
  console.log(`[auth-api] PG target: ${PG_HOST}/${PG_DB}`);
  console.log(`[auth-api] CORS: ${DASHBOARD_ORIGIN_RE}`);
});
