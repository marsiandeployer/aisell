// @ts-nocheck
// NOTE: This file is being migrated from JS to TS incrementally.
// We keep runtime behavior identical and rely on `tsx` in prod; strict typing will be restored after the refactor is complete.

// CHANGE: Add web admin server for browsing author and bot dialogs.
// WHY: Need admin access to all dialogs with authors and created bots, restricted by IP.
// QUOTE(ТЗ): "сделай в вебадминке ссылки на все диалоги с авторами и внутри ссылки на все диалоги созданных ботов . короче чтоб я все диалоги мог читать разреши только доступ с ip 212.193.45.174 и 89.185.84.184  (и запиши в ~/ CLAUDE.md его как \"мой ip\") остальным пиши доступ по ip заперщен."
// REF: user request 2026-01-28
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import conversationStore from './conversationStore';
const {
    renderNoxonLeadsBody,
    renderNoxonMessagesBody,
    renderNoxonReferralsBody,
    renderNoxonOnboardingBody
} = require('../shared/admin/noxonPages');

dotenv.config({ path: path.join(__dirname, '.env') });

const BASE_PATH = '/admin';
const STATIC_PATH = `${BASE_PATH}/static`;
const DATA_DIR = path.join(__dirname, 'user_data');
const LEGACY_CONVERSATIONS_PATH = path.join(DATA_DIR, 'conversations.json');
const BOTS_PATH = path.join(__dirname, 'bots_database', 'bots.json');
import { readAiSettings, writeAiSettings, getHydraConfig } from './aiSettings';
const STATIC_DIR = path.join(__dirname, 'admin_static');
const TAILWIND_PATH = path.join(STATIC_DIR, 'tailwind.min.css');
const ACCESS_DENIED_MESSAGE = 'доступ по ip заперщен.';

// Noxonbot data paths (read-only): show onboarding leads / messages / referrals inside Bananzabot admin.
const NOXON_DATA_DIR = path.join(__dirname, '..', 'noxonbot', 'data');
const NOXON_LEADS_PATH = path.join(NOXON_DATA_DIR, 'onboarding', 'onboarding_leads.json');
const NOXON_MESSAGE_HISTORY_PATH = path.join(NOXON_DATA_DIR, 'history', 'message_history.json');
const NOXON_REFERRALS_PATH = path.join(NOXON_DATA_DIR, 'referrals', 'user_referrals.json');
const NOXON_ONBOARDING_STATES_PATH = path.join(NOXON_DATA_DIR, 'onboarding', 'onboarding_states.json');
const CRM_FOLLOWUPS_PATH = path.join(DATA_DIR, 'crm_followups.json');
const TELEGRAM_SENDER_PATH = '/root/space2/hababru/telegram_sender.py';
const TELEGRAM_FOLDER_LINKER_PATH = path.join(__dirname, 'scripts', 'telegram_add_to_folder.py');
const CRM_FOLDER_NAME = 'bananza';
const execFileAsync = promisify(execFile);
const BANANZABOT_LINK = 'https://t.me/bananza_bot';
const CRM_FOLLOWUP_MAX_CHARS = 600;

// CHANGE: Import TestRunner and promptManager for E2E testing system
// WHY: Need to run tests and manage system prompts via API
// REF: E2E testing system implementation
const TestRunner = require('./tests/testRunner');
const promptManager = require('./tests/promptManager');

let lastAiNotice = null;

const CRM_STATUS_ORDER = ['new', 'in_progress', 'followup_ready', 'contacted', 'won', 'lost'];
const CRM_STATUS_LABELS = {
    new: 'New',
    in_progress: 'In progress',
    followup_ready: 'Follow-up ready',
    contacted: 'Contacted',
    won: 'Won',
    lost: 'Lost'
};

function normalizeCrmStatus(status) {
    const normalized = typeof status === 'string' ? status.trim() : '';
    return CRM_STATUS_ORDER.includes(normalized) ? normalized : 'new';
}

function readCrmState() {
    if (!fs.existsSync(CRM_FOLLOWUPS_PATH)) {
        return {};
    }
    try {
        const parsed = readJsonFile(CRM_FOLLOWUPS_PATH);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeCrmState(state) {
    const dir = path.dirname(CRM_FOLLOWUPS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CRM_FOLLOWUPS_PATH, JSON.stringify(state, null, 2));
}

function buildAuthorPath(userId) {
    return `${BASE_PATH}/authors/${encodeURIComponent(String(userId))}`;
}

function normalizeReturnPath(returnTo, userId) {
    const fallback = buildAuthorPath(userId);
    if (typeof returnTo !== 'string') return fallback;
    const trimmed = returnTo.trim();
    if (!trimmed) return fallback;
    if (!trimmed.startsWith(BASE_PATH)) return fallback;
    return trimmed;
}

function setAiNotice(type, message) {
    lastAiNotice = {
        type,
        message,
        createdAt: Date.now()
    };
}

function getAiNotice() {
    if (!lastAiNotice) {
        return null;
    }
    const maxAgeMs = 5 * 60 * 1000;
    if (Date.now() - lastAiNotice.createdAt > maxAgeMs) {
        lastAiNotice = null;
        return null;
    }
    return lastAiNotice;
}

// CHANGE: Allow localhost/127.0.0.1 for local API requests and testing.
// WHY: nginx may not pass IP headers for local requests, causing API to return 403.
// QUOTE(ТЗ): "API endpoint не отвечает - нет данных от /api/authors/29165285 потому что там бан по айп и разреши обращатся по локале"
// REF: user request 2026-01-28
// CHANGE: Add server IP and missing allowed IP from README
// WHY: Allow API access from server itself for testing and from all authorized IPs
// REF: user request - "доступ по ip заперщен. - тут разреши наш айпишник то (твой)"
const allowedIps = new Set([
    '212.193.45.174',    // User IP 1
    '89.185.84.184',     // User IP 2
    '80.211.131.142',    // Additional authorized IP (from README)
    '78.47.125.10',      // Server IP (this server)
    '127.0.0.1',         // Localhost IPv4
    'localhost',         // Localhost hostname
    '::1'                // Localhost IPv6
]);

const portRaw = process.env.BANANZABOT_ADMIN_PORT;
if (!portRaw) {
    throw new Error('BANANZABOT_ADMIN_PORT is required');
}
const adminPort = Number(portRaw);
if (!Number.isInteger(adminPort) || adminPort <= 0) {
    throw new Error('BANANZABOT_ADMIN_PORT must be a valid port number');
}

if (!fs.existsSync(BOTS_PATH)) {
    throw new Error(`Missing bots database file: ${BOTS_PATH}`);
}
if (!fs.existsSync(TAILWIND_PATH)) {
    throw new Error(`Missing Tailwind CSS file: ${TAILWIND_PATH}`);
}

const tailwindCss = fs.readFileSync(TAILWIND_PATH, 'utf8');

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// CHANGE: Validate array inputs to avoid silent fallbacks on missing data.
// WHY: Enforce fail-fast behavior and avoid masking invalid dialog data.
// QUOTE(ТЗ): "!!!!No fallbacks strict policy!!!: do not invent default values to mask missing data."
// REF: /root/CLAUDE.md
function assertArray(value, contextLabel) {
    if (!Array.isArray(value)) {
        throw new Error(`${contextLabel} must be an array`);
    }
    return value;
}

function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

function readJsonFileOrDefault(filePath, defaultValue) {
    try {
        if (!fs.existsSync(filePath)) {
            return { value: defaultValue, error: `Missing file: ${filePath}` };
        }
        return { value: readJsonFile(filePath), error: null };
    } catch (error) {
        return { value: defaultValue, error: error.message };
    }
}

function readLegacyConversationsIfExists() {
    if (!fs.existsSync(LEGACY_CONVERSATIONS_PATH)) {
        return null;
    }
    const legacy = readJsonFile(LEGACY_CONVERSATIONS_PATH);
    if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy)) {
        return null;
    }
    return legacy;
}

function loadAllConversationsForAdmin() {
    // Prefer the per-user folder layout. Fall back to legacy monolithic file if needed.
    const fromDir = conversationStore.readAllMainConversations();
    if (fromDir && typeof fromDir === 'object' && Object.keys(fromDir).length > 0) {
        return fromDir;
    }
    const legacy = readLegacyConversationsIfExists();
    if (!legacy) {
        return {};
    }
    // Legacy file could contain non-author keys (e.g. test sessions). Keep index clean.
    const filtered = {};
    for (const [key, value] of Object.entries(legacy)) {
        if (!/^\d+$/.test(key)) {
            continue;
        }
        filtered[key] = value;
    }
    return filtered;
}

function loadAuthorConversation(userId) {
    const filePath = conversationStore.getMainConversationPath(userId);
    const convo = conversationStore.readJsonIfExists(filePath);
    if (convo && typeof convo === 'object') {
        return convo;
    }
    const legacy = readLegacyConversationsIfExists();
    return legacy ? legacy[userId] : null;
}

function parseFormBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString('utf8');
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                const params = new URLSearchParams(body);
                const result = {};
                for (const [key, value] of params.entries()) {
                    result[key] = value;
                }
                resolve(result);
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function normalizeBaseUrl(baseUrl) {
    if (typeof baseUrl !== 'string') {
        return '';
    }
    return baseUrl.replace(/\/+$/, '');
}

async function fetchHydraModels() {
    let config;
    try {
        config = getHydraConfig();
    } catch (error) {
        return { models: [], error: error.message };
    }
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        return { models: [], error: 'HYDRA_BASE_URL not configured' };
    }
    try {
        const response = await axios.get(`${baseUrl}/models`, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: 10000,
            proxy: false,
            maxRedirects: 0
        });
        if (response.status !== 200) {
            return { models: [], error: `Hydra returned ${response.status}` };
        }
        const payload = response.data;
        if (payload && Array.isArray(payload.data)) {
            const models = payload.data
                .map(model => (model && typeof model === 'object' ? model.id : model))
                .filter(Boolean);
            return { models: models.sort(), error: null };
        }
        return { models: [], error: null };
    } catch (error) {
        return { models: [], error: `Hydra models error: ${error.message}` };
    }
}

async function fetchHydraProfile() {
    let config;
    try {
        config = getHydraConfig();
    } catch (error) {
        return { profile: null, error: error.message };
    }
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        return { profile: null, error: 'HYDRA_BASE_URL not configured' };
    }
    try {
        const response = await axios.get(`${baseUrl}/users/profile`, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: 10000,
            proxy: false,
            maxRedirects: 0
        });
        if (response.status !== 200) {
            return { profile: null, error: `Hydra returned ${response.status}` };
        }
        return { profile: response.data, error: null };
    } catch (error) {
        return { profile: null, error: `Hydra profile error: ${error.message}` };
    }
}

async function verifyHydraApiKey(rawApiKey) {
    const key = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
    if (!key) {
        throw new Error('Hydra API key is required');
    }
    const config = getHydraConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        throw new Error('HYDRA_BASE_URL not configured');
    }
    const startedAt = Date.now();
    const response = await axios.get(`${baseUrl}/users/profile`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 20000,
        proxy: false,
        maxRedirects: 0,
        validateStatus: () => true
    });
    if (response.status !== 200) {
        const payload = response.data;
        const detail = payload && (payload.detail || payload.error || payload.message);
        throw new Error(typeof detail === 'string' ? detail : `Hydra returned ${response.status}`);
    }
    const profile = response.data && typeof response.data === 'object' ? response.data : {};
    return {
        latencyMs: Date.now() - startedAt,
        profile
    };
}

async function redeemHydraCode(code) {
    if (!code) {
        throw new Error('redeem code is required');
    }
    const config = getHydraConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        throw new Error('HYDRA_BASE_URL not configured');
    }
    const response = await axios.post(
        `${baseUrl}/users/redeem`,
        { code },
        {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: 30000,
            proxy: false,
            maxRedirects: 0,
            validateStatus: () => true
        }
    );
    if (response.status === 200) {
        return response.data;
    }
    const payload = response.data;
    const detail = payload && (payload.detail || payload.error);
    throw new Error(typeof detail === 'string' ? detail : `Hydra returned ${response.status}`);
}

async function testHydraApi(model) {
    if (!model) {
        throw new Error('Model is required');
    }
    const config = getHydraConfig();
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        throw new Error('HYDRA_BASE_URL not configured');
    }
    const startedAt = Date.now();
    const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
            model,
            messages: [
                { role: 'system', content: 'You are a ping bot.' },
                { role: 'user', content: 'ping' }
            ],
            temperature: 0,
            max_tokens: 10
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            timeout: 15000,
            proxy: false,
            maxRedirects: 0,
            validateStatus: () => true
        }
    );
    if (response.status !== 200) {
        const payload = response.data;
        const detail = payload && (payload.detail || payload.error || payload.message);
        throw new Error(typeof detail === 'string' ? detail : `Hydra returned ${response.status}`);
    }
    const reply = response.data && response.data.choices && response.data.choices[0]
        ? response.data.choices[0].message && response.data.choices[0].message.content
        : null;
    const latencyMs = Date.now() - startedAt;
    return {
        model,
        latencyMs,
        reply: typeof reply === 'string' ? reply.trim() : ''
    };
}

function getMessagesInfo(convo, contextLabel) {
    if (!convo || typeof convo !== 'object') {
        return { messages: null, error: `${contextLabel} is not an object` };
    }
    if (!Array.isArray(convo.messages)) {
        return { messages: null, error: `${contextLabel} messages are not an array` };
    }
    return { messages: convo.messages, error: null };
}

function truncateText(value, maxLength) {
    if (value === null || value === undefined) {
        return '';
    }
    const text = String(value);
    if (text.length <= maxLength) {
        return text;
    }
    const sliceLength = Math.max(0, maxLength - 3);
    return `${text.slice(0, sliceLength)}...`;
}

function enforceCrmFollowupPolicy(rawText) {
    const normalized = typeof rawText === 'string'
        ? rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        : '';
    let text = normalized;
    if (!text) {
        text = 'Привет! Я создатель Bananzabot. Вижу, что вы начали настройку бота, но не завершили её. Напишите, что осталось сделать, и я помогу быстро запустить.';
    }

    const hasBananzaUrl = /https?:\/\/t\.me\/bananza_bot/i.test(text);
    if (!hasBananzaUrl) {
        text = `${text}\n\nBananzabot: ${BANANZABOT_LINK}`;
    }

    if (text.length <= CRM_FOLLOWUP_MAX_CHARS) {
        return text;
    }

    const linkSuffix = `\n\nBananzabot: ${BANANZABOT_LINK}`;
    const maxBodyLength = Math.max(80, CRM_FOLLOWUP_MAX_CHARS - linkSuffix.length - 3);
    const shortBody = text.slice(0, maxBodyLength).trimEnd();
    return `${shortBody}...${linkSuffix}`;
}

function normalizeUsername(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    return text.startsWith('@') ? text : `@${text}`;
}

function normalizeName(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text ? text : null;
}

function buildDisplayName(firstName, lastName, fullName) {
    const normalizedFull = normalizeName(fullName);
    if (normalizedFull) {
        return normalizedFull;
    }
    const normalizedFirst = normalizeName(firstName);
    const normalizedLast = normalizeName(lastName);
    if (normalizedFirst && normalizedLast) {
        return `${normalizedFirst} ${normalizedLast}`;
    }
    return normalizedFirst || normalizedLast || null;
}

function extractUsernameFromChat(chatData) {
    if (!Array.isArray(chatData)) {
        return null;
    }
    for (const entry of chatData) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        if (entry.userInfo && entry.userInfo.username) {
            const normalized = normalizeUsername(entry.userInfo.username);
            if (normalized) {
                return normalized;
            }
        }
        if (entry.username) {
            const normalized = normalizeUsername(entry.username);
            if (normalized) {
                return normalized;
            }
        }
    }
    return null;
}

function extractProfileFromChat(chatData) {
    if (!Array.isArray(chatData)) {
        return null;
    }
    for (const entry of chatData) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const userInfo = entry.userInfo && typeof entry.userInfo === 'object' ? entry.userInfo : null;
        const username = normalizeUsername(userInfo && userInfo.username);
        const name = buildDisplayName(
            userInfo && userInfo.firstName,
            userInfo && userInfo.lastName,
            userInfo && userInfo.fullName
        );
        if (username || name) {
            return { username, name };
        }
        const legacyUsername = normalizeUsername(entry.username);
        if (legacyUsername) {
            return { username: legacyUsername, name: null };
        }
    }
    return null;
}

function extractProfileFromFile(profile) {
    if (!profile || typeof profile !== 'object') {
        return null;
    }
    const username = normalizeUsername(profile.username);
    const name = buildDisplayName(profile.firstName, profile.lastName, profile.fullName);
    if (username || name) {
        return { username, name };
    }
    return null;
}

function findAuthorProfile(userId, botNames, botDirs) {
    const candidates = [];
    if (Array.isArray(botNames)) {
        candidates.push(...botNames);
    }
    if (!candidates.length && Array.isArray(botDirs)) {
        candidates.push(...botDirs);
    }
    if (!candidates.length) {
        return null;
    }

    for (const botName of candidates) {
        const botDir = path.join(DATA_DIR, botName);
        if (!fs.existsSync(botDir)) {
            continue;
        }
        const profilePath = path.join(botDir, `${userId}.json`);
        if (fs.existsSync(profilePath)) {
            const profile = readJsonFile(profilePath);
            const extracted = extractProfileFromFile(profile);
            if (extracted) {
                return extracted;
            }
        }
        const chatPath = path.join(botDir, `chat_${userId}.json`);
        if (fs.existsSync(chatPath)) {
            const chatData = readJsonFile(chatPath);
            const extracted = extractProfileFromChat(chatData);
            if (extracted) {
                return extracted;
            }
        }
    }

    return null;
}

function buildCrmLeads(conversations, bots, crmState) {
    const botDirs = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
            .map(entry => entry.name)
        : [];
    const botsByUser = new Map();
    for (const bot of bots) {
        const ownerId = bot && bot.user_id !== undefined ? String(bot.user_id) : null;
        const name = bot && typeof bot.nameprompt === 'string' ? bot.nameprompt : null;
        if (!ownerId || !name) continue;
        if (!botsByUser.has(ownerId)) {
            botsByUser.set(ownerId, []);
        }
        botsByUser.get(ownerId).push(name);
    }

    const leads = [];
    for (const [userId, convo] of Object.entries(conversations)) {
        const { messages } = getMessagesInfo(convo, `Conversation for user ${userId}`);
        if (!messages || !messages.length) continue;
        const firstUserMessage = messages.find(message => message && message.role === 'user' && typeof message.content === 'string' && message.content.trim());
        if (!firstUserMessage) continue;
        const stage = typeof convo.stage === 'string' ? convo.stage : 'n/a';
        if (stage === 'bot_created') continue;
        const lastMessage = messages[messages.length - 1];
        let profile = findAuthorProfile(userId, botsByUser.get(userId) || [], botDirs);

        // CHANGE: Fallback to userInfo from conversation if no bot profile exists
        // WHY: New users don't have bot_* folders yet, but we have userInfo from /start
        // REF: User report - username missing in CRM
        if (!profile && convo && typeof convo === 'object') {
            const userInfo = convo.userInfo && typeof convo.userInfo === 'object' ? convo.userInfo : null;
            if (userInfo) {
                const uname = typeof userInfo.username === 'string' ? userInfo.username : null;
                const firstName = typeof userInfo.firstName === 'string' ? userInfo.firstName : null;
                const lastName = typeof userInfo.lastName === 'string' ? userInfo.lastName : null;
                const fullName = typeof userInfo.fullName === 'string' ? userInfo.fullName : null;
                const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || null;
                if (uname || name) {
                    profile = { username: uname ? `@${uname}` : null, name };
                }
            }
        }

        const crm = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
        leads.push({
            userId,
            username: profile && profile.username ? profile.username : null,
            name: profile && profile.name ? profile.name : null,
            stage: formatStageLabel(stage),
            firstMessage: firstUserMessage.content.trim(),
            lastTimestamp: lastMessage && typeof lastMessage.timestamp === 'string' ? lastMessage.timestamp : null,
            messageCount: messages.length,
            crmStatus: normalizeCrmStatus(crm.status),
            followupText: typeof crm.followupText === 'string' ? crm.followupText : '',
            note: typeof crm.note === 'string' ? crm.note : '',
            nextFollowupAt: typeof crm.nextFollowupAt === 'string' ? crm.nextFollowupAt : '',
            sentCount: Number.isInteger(crm.sentCount) ? crm.sentCount : 0,
            lastSentAt: typeof crm.lastSentAt === 'string' ? crm.lastSentAt : null,
            folderAddedAt: typeof crm.folderAddedAt === 'string' ? crm.folderAddedAt : null,
            folderAddError: typeof crm.folderAddError === 'string' ? crm.folderAddError : null,
            qualification: crm.qualification && typeof crm.qualification === 'object' ? crm.qualification : null
        });
    }

    leads.sort((a, b) => {
        const aWeight = CRM_STATUS_ORDER.indexOf(a.crmStatus);
        const bWeight = CRM_STATUS_ORDER.indexOf(b.crmStatus);
        if (aWeight !== bWeight) return aWeight - bWeight;
        return (Date.parse(b.lastTimestamp || '') || 0) - (Date.parse(a.lastTimestamp || '') || 0);
    });

    return leads;
}

async function generateCrmFollowupText(lead) {
    const hasKnownUsername = typeof lead.username === 'string' && lead.username.trim().length > 0;
    if (process.env.BANANZABOT_CRM_FAKE_AI === '1') {
        if (hasKnownUsername) {
            return enforceCrmFollowupPolicy('Здравствуйте, я Александр, создатель Bananzabot (@bananza_bot). Вижу, что вы начали настройку бота, но не завершили. Подскажите, что помешало продолжить, и я помогу быстро довести запуск до результата.');
        }
        return enforceCrmFollowupPolicy('Здравствуйте! Это команда @bananza_bot. Видим, что вы начали настройку бота, но остановились. Вернитесь в диалог @bananza_bot и напишите, что не получилось, чтобы мы помогли завершить запуск.');
    }
    const { apiKey, baseUrl } = getHydraConfig();
    const model = readAiSettings().prompt_model || readAiSettings().bot_model;

    // CHANGE: Load full conversation history for context-aware follow-up generation
    // WHY: User requested follow-ups to consider full communication history including previous follow-ups
    // REF: user request - "фоловапы могут перегенерироватся же с учетом и моей истории общения"
    const convo = loadAuthorConversation(lead.userId);
    const messages = convo && Array.isArray(convo.messages) ? convo.messages : [];
    const conversationHistory = messages
        .filter(m => m && typeof m.content === 'string')
        .map(m => {
            const role = m.role === 'user' ? 'USER' : 'ASSISTANT/BOT';
            const timestamp = m.timestamp ? new Date(m.timestamp).toLocaleString('ru-RU') : '';
            return `[${timestamp}] ${role}: ${m.content.trim()}`;
        })
        .join('\n');

    // CHANGE: Include qualification info in follow-up generation prompt
    // WHY: Adjust tone and content based on lead quality (commercial vs non-commercial)
    // REF: user request - "Generate AI follow-up - должен учитывать квалификацию"
    let qualificationContext = '';
    if (lead.qualification) {
        const verdict = lead.qualification.verdict;
        const reason = lead.qualification.reason || '';
        if (verdict === 'commercial') {
            qualificationContext = `\nКвалификация: КОММЕРЧЕСКИЙ лид (перспективный). ${reason}\nТон: профессиональный, активный, подчеркни ценность для бизнеса.`;
        } else if (verdict === 'non_commercial') {
            qualificationContext = `\nКвалификация: НЕКОММЕРЧЕСКИЙ лид. ${reason}\nТон: нейтральный, не навязчивый, просто предложи помощь.`;
        } else if (verdict === 'unclear') {
            qualificationContext = `\nКвалификация: НЕЯСНО. ${reason}\nТон: осторожный, задай уточняющие вопросы о цели использования.`;
        }
    }

    const senderContext = hasKnownUsername
        ? `Режим контакта: username известен (${lead.username}).\n` +
          `Пиши как личное сообщение от Александра, создателя @bananza_bot.\n` +
          `Не добавляй подпись вида "Пишите мне ...": не проси писать лично менеджеру.\n` +
          `Можно предложить продолжить в @bananza_bot, но без формулировок про "напишите мне".\n`
        : `Режим контакта: username отсутствует.\n` +
          `Пиши от имени сервиса @bananza_bot (не от лица Александра).\n` +
          `В конце добавь: "Вы можете ответить тут или написать разработчику @onoutnoxon Александр".\n`;

    const prompt = `Сгенерируй сообщение от создателя Bananzabot по этому образцу:\n\n` +
        `"Добрый день,\n\n` +
        `меня зовут Александр, я создатель Bananzabot. Увидел, что вы начинали делать бота.\n\n` +
        `Я собираю обратную связь по использованию Бананзы, тк хочу его улучшить. Могли бы поделиться, как вам конструктор, все ли понятно? Нужна ли сейчас какая то помощь, чтобы его доделать?\n\n` +
        `Если для работы понадобится сложная доработка или особые функции, мы занимаемся и разработкой на заказ — можем помочь всё реализовать.\n\n` +
        `По созданию бота могу проконсультировать бесплатно.\n\n` +
        `Bananzabot: https://t.me/bananza_bot"\n\n` +
        `Контекст:\n` +
        `- Пользователь попробовал создать бота, но не завершил\n` +
        `- Мы собираем обратную связь для улучшения конструктора\n` +
        `- Предлагаем бесплатную консультацию по созданию бота\n` +
        `- Занимаемся коммерческой разработкой на заказ (если нужна сложная доработка)\n` +
        senderContext +
        qualificationContext + `\n` +
        `Требования:\n` +
        `- Структура как в образце: приветствие, представление, цель обращения, вопросы, предложение помощи\n` +
        `- Максимум 500 символов\n` +
        `- Используй абзацы (разделяй двойным переносом строки)\n` +
        `- Вежливый, мягкий, не навязчивый тон\n` +
        `- Упомяни бесплатную консультацию\n` +
        `- Без markdown\n` +
        `- Не используй фразу "Пишите мне"\n` +
        `- ВАЖНО: Учитывай предыдущую историю общения, не повторяй уже отправленные сообщения\n` +
        `\nДанные лида:\n` +
        `user_id=${lead.userId}\n` +
        `username=${lead.username || 'missing'}\n` +
        `stage=${lead.stage}\n` +
        `first_message=${truncateText(lead.firstMessage || '', 500)}\n` +
        (conversationHistory ? `\nИстория общения:\n${truncateText(conversationHistory, 3000)}\n` : '');

    const requestPayload = {
        model,
        messages: [
            { role: 'system', content: 'Ты Александр, создатель Bananzabot. Пишешь вежливо, структурировано, с абзацами. Собираешь обратную связь, предлагаешь бесплатную консультацию. Не повторяешься. Тон: мягкий, дружелюбный, не навязчивый.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 600
    };

    const requestStartTime = Date.now();
    let response;
    try {
        response = await axios.post(
            `${normalizeBaseUrl(baseUrl)}/chat/completions`,
            requestPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 20000
            }
        );
    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;
        const { logHydraRequest } = require('./hydraLogger.ts');
        logHydraRequest({
            caller: 'generateCrmFollowupText',
            context: { userId: lead.userId, operation: 'followup' },
            request: requestPayload,
            response: { success: false, error: error.message, latencyMs }
        });
        throw error;
    }

    const latencyMs = Date.now() - requestStartTime;
    const text = response && response.data && response.data.choices && response.data.choices[0]
        ? response.data.choices[0].message && response.data.choices[0].message.content
        : '';
    if (!text || typeof text !== 'string') {
        const { logHydraRequest } = require('./hydraLogger.ts');
        logHydraRequest({
            caller: 'generateCrmFollowupText',
            context: { userId: lead.userId, operation: 'followup' },
            request: requestPayload,
            response: { success: false, error: 'Empty response from AI', latencyMs, data: response?.data }
        });
        throw new Error('AI follow-up generation returned empty response');
    }

    // Log successful request
    const { logHydraRequest } = require('./hydraLogger.ts');
    logHydraRequest({
        caller: 'generateCrmFollowupText',
        context: { userId: lead.userId, operation: 'followup' },
        request: requestPayload,
        response: {
            success: true,
            data: response.data,
            latencyMs,
            usage: response.data.usage
        }
    });

    return enforceCrmFollowupPolicy(text.trim());
}

async function sendCrmFollowupViaBananzaBot(userId, messageText) {
    const token = typeof process.env.TELEGRAM_BOT_TOKEN === 'string' ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is required for @bananza_bot follow-up delivery');
    }
    const chatIdText = String(userId || '').trim();
    if (!/^-?\d+$/.test(chatIdText)) {
        throw new Error('bananza bot delivery requires numeric user_id');
    }
    const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
            chat_id: Number(chatIdText),
            text: messageText,
            disable_web_page_preview: true
        },
        { timeout: 20000 }
    );
    const payload = response && response.data ? response.data : null;
    if (!payload || payload.ok !== true) {
        const description = payload && payload.description ? payload.description : 'Unknown Telegram Bot API error';
        throw new Error(`@bananza_bot send failed: ${description}`);
    }
}

// CHANGE: Add lead qualification via LLM analysis of full conversation
// WHY: Need to filter non-commercial leads (CS GO stores, gambling, etc.) quickly
// REF: user request 2026-02-11
async function generateQualificationResult(userId, messages) {
    if (process.env.BANANZABOT_CRM_FAKE_AI === '1') {
        return { verdict: 'commercial', reason: 'Fake AI mode: assumed commercial.', analyzedAt: new Date().toISOString() };
    }
    const { apiKey, baseUrl } = getHydraConfig();
    const model = readAiSettings().prompt_model || readAiSettings().bot_model;

    const conversationText = messages
        .filter(m => m && typeof m.content === 'string')
        .map(m => `[${m.role === 'user' ? 'USER' : 'BOT'}]: ${m.content.trim()}`)
        .join('\n');

    const prompt = `Проанализируй диалог пользователя с Telegram-ботом Bananzabot (сервис создания ботов для бизнеса).
Твоя задача — определить, является ли этот пользователь коммерчески перспективным лидом.

Верни ответ СТРОГО в формате JSON (без markdown, без лишнего текста):
{
  "verdict": "commercial" | "non_commercial" | "unclear",
  "reason": "короткое объяснение на русском (1-2 предложения)",
  "flags": ["список тревожных сигналов, если есть"]
}

Признаки НЕкоммерческого/нежелательного лида:
- Магазины CS GO, игровых читов, нелегального ПО
- Казино, гемблинг, ставки
- Спам-боты, рассылки без согласия
- Скам/фишинг/мошенничество
- Тесты, демо, исследования без реального бизнеса
- Студенческие проекты без бюджета
- Явно нецелевой запрос

Признаки коммерческого лида:
- Реальный бизнес с продуктом/услугой
- Конкретное описание бизнес-задачи
- Упоминание клиентов, продаж, сервиса
- Готовность платить или вопросы о тарифах
- Профессиональная сфера (e-commerce, услуги, образование и т.д.)

Диалог:
${truncateText(conversationText, 3000)}`;

    const requestPayload = {
        model,
        messages: [
            { role: 'system', content: 'Ты аналитик CRM, отвечаешь только валидным JSON без markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 300
    };

    const requestStartTime = Date.now();
    let response;
    try {
        response = await axios.post(
            `${normalizeBaseUrl(baseUrl)}/chat/completions`,
            requestPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 20000
            }
        );
    } catch (error) {
        const latencyMs = Date.now() - requestStartTime;
        // Log failed request
        const { logHydraRequest } = require('./hydraLogger.ts');
        logHydraRequest({
            caller: 'generateQualificationResult',
            context: { userId, operation: 'qualification' },
            request: requestPayload,
            response: { success: false, error: error.message, latencyMs }
        });
        throw error;
    }

    const latencyMs = Date.now() - requestStartTime;
    const rawText = response && response.data && response.data.choices && response.data.choices[0]
        ? response.data.choices[0].message && response.data.choices[0].message.content
        : null;
    if (!rawText || typeof rawText !== 'string') {
        const { logHydraRequest } = require('./hydraLogger.ts');
        logHydraRequest({
            caller: 'generateQualificationResult',
            context: { userId, operation: 'qualification' },
            request: requestPayload,
            response: { success: false, error: 'Empty response from AI', latencyMs, data: response?.data }
        });
        throw new Error('Qualification AI returned empty response');
    }

    let parsed;
    try {
        parsed = JSON.parse(rawText.trim());
    } catch {
        // Try to extract JSON from response if model added extra text
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`Qualification AI returned non-JSON: ${rawText.slice(0, 200)}`);
        }
        parsed = JSON.parse(match[0]);
    }

    const validVerdicts = ['commercial', 'non_commercial', 'unclear'];
    const verdict = validVerdicts.includes(parsed.verdict) ? parsed.verdict : 'unclear';
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    const flags = Array.isArray(parsed.flags) ? parsed.flags.filter(f => typeof f === 'string') : [];

    if (!reason) {
        throw new Error('Qualification AI returned empty reason');
    }

    // Log successful request
    const { logHydraRequest } = require('./hydraLogger.ts');
    logHydraRequest({
        caller: 'generateQualificationResult',
        context: { userId, operation: 'qualification' },
        request: requestPayload,
        response: {
            success: true,
            data: response.data,
            latencyMs,
            usage: response.data.usage
        }
    });

    return { verdict, reason, flags, analyzedAt: new Date().toISOString() };
}

// CHANGE: Support both username and user_id for CRM follow-up sending
// WHY: User reported that sending works only with username, not with user_id
// REF: user request - "в общем я понял отправляется только если есть подключеный никнейм а елси айди то не отправляется"
async function sendCrmFollowup(recipient, messageText, options = {}) {
    const target = String(recipient || '').trim().replace(/^@/, '');
    if (!target) {
        throw new Error('recipient is required');
    }
    const viaBananzaBot = Boolean(options.viaBananzaBot);
    if (process.env.BANANZABOT_CRM_DRY_RUN === '1') {
        return {
            sent: true,
            folderAdded: !viaBananzaBot,
            dryRun: true,
            via: viaBananzaBot ? 'bananza_bot' : 'personal'
        };
    }

    // Check if target is numeric user_id or username
    // telegram_sender.py handles numeric IDs without @ prefix
    const isNumericId = /^-?\d+$/.test(target);

    if (viaBananzaBot) {
        if (!isNumericId) {
            throw new Error('@bananza_bot delivery requires numeric user_id');
        }
        await sendCrmFollowupViaBananzaBot(target, messageText);
        return {
            sent: true,
            folderAdded: false,
            folderAddError: null,
            dryRun: false,
            recipient: target,
            via: 'bananza_bot'
        };
    }

    const formattedTarget = isNumericId ? target : `@${target}`;

    await execFileAsync('python3', [TELEGRAM_SENDER_PATH, `напиши ${formattedTarget} ${messageText}`], { timeout: 45000 });

    let folderAdded = false;
    let folderAddError = null;
    try {
        // For folder linking keep numeric IDs as-is; usernames must keep @ prefix.
        const folderTarget = isNumericId ? target : `@${target}`;
        await execFileAsync('python3', [TELEGRAM_FOLDER_LINKER_PATH, folderTarget, CRM_FOLDER_NAME], { timeout: 45000 });
        folderAdded = true;
    } catch (error) {
        // CHANGE: Make folder add error non-critical and brief
        // WHY: User may not have access_hash for some contacts, but message was sent successfully
        // REF: user error - "Could not resolve peer for '@miranda_esim'"
        folderAddError = 'не удалось добавить в папку (контакт недоступен в Pyrogram)';
        console.log(`[CRM Follow-up] Folder add warning for ${formattedTarget}:`, error.message || error);
    }

    return { sent: true, folderAdded, folderAddError, dryRun: false, recipient: target, via: 'personal' };
}

function appendCrmFollowupToAuthorHistory(userId, recipient, followupText, deliveryVia = 'personal') {
    const existing = loadAuthorConversation(userId);
    if (!existing || typeof existing !== 'object') {
        throw new Error(`Conversation for user ${userId} not found`);
    }

    const convo = { ...existing };
    const messages = Array.isArray(convo.messages) ? [...convo.messages] : [];
    const recipientText = String(recipient || '').trim();
    const who = deliveryVia === 'bananza_bot'
        ? `@bananza_bot -> ${recipientText || userId}`
        : (recipientText ? (recipientText.startsWith('@') ? recipientText : `@${recipientText}`) : 'unknown');
    messages.push({
        role: 'assistant',
        content: `[CRM follow-up sent to ${who}]\n${followupText}`,
        timestamp: new Date().toISOString()
    });
    convo.messages = messages;
    conversationStore.writeJsonAtomic(conversationStore.getMainConversationPath(userId), convo);
}

function formatTimestamp(timestamp) {
    if (!timestamp) {
        return 'n/a';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return String(timestamp);
    }
    // Format as: Feb 16, 20:25
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month} ${day}, ${hours}:${minutes}`;
}

function formatStageLabel(stage) {
    if (!stage || typeof stage !== 'string') {
        return 'n/a';
    }
    if (stage === 'awaiting_token_or_test' || stage === 'awaiting_token' || stage === 'prompt_generated' || stage === 'testing') {
        return 'Testing';
    }
    return stage;
}

// CHANGE: Render qualification verdict badge with color coding
// WHY: Visual indicator of lead commercial potential in CRM table
// REF: user request 2026-02-11
function renderQualificationBadge(qualification) {
    if (!qualification || typeof qualification !== 'object') {
        return '';
    }
    const verdict = qualification.verdict;
    const reason = typeof qualification.reason === 'string' ? qualification.reason : '';
    const flags = Array.isArray(qualification.flags) && qualification.flags.length > 0
        ? ` | ⚑ ${qualification.flags.join(', ')}`
        : '';
    const analyzedAt = typeof qualification.analyzedAt === 'string'
        ? ` (${formatTimestamp(qualification.analyzedAt)})`
        : '';

    let colorClass = 'bg-gray-100 text-gray-700 border-gray-300';
    let label = 'Неясно';
    if (verdict === 'commercial') {
        colorClass = 'bg-green-100 text-green-800 border-green-300';
        label = '✓ Коммерческий';
    } else if (verdict === 'non_commercial') {
        colorClass = 'bg-red-100 text-red-700 border-red-300';
        label = '✗ Некоммерческий';
    }

    return `<div class="rounded border ${colorClass} px-2 py-1 text-xs">
      <div class="font-semibold">${escapeHtml(label)}${escapeHtml(analyzedAt)}</div>
      <div class="mt-0.5 break-words">${escapeHtml(reason)}${escapeHtml(flags)}</div>
    </div>`;
}

// CHANGE: Respect proxy headers for real client IP (Cloudflare + nginx).
// WHY: Ensure IP allowlist works when domain is routed via proxy headers.
// QUOTE(ТЗ): "привяжи но чтоб учитывался ip ban"
// REF: user request 2026-01-28
function readHeaderValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function parseXForwardedFor(value) {
    const headerValue = readHeaderValue(value);
    if (!headerValue) {
        return null;
    }
    const first = headerValue.split(',')[0].trim();
    return first ? first : null;
}

function getClientIp(req) {
    const cfConnectingIp = normalizeIp(readHeaderValue(req.headers['cf-connecting-ip']));
    const xRealIp = normalizeIp(readHeaderValue(req.headers['x-real-ip']));
    const xForwardedFor = normalizeIp(parseXForwardedFor(req.headers['x-forwarded-for']));
    const remoteAddress = normalizeIp(typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : null);

    if (cfConnectingIp) {
        if (xForwardedFor && xForwardedFor !== cfConnectingIp) {
            return null;
        }
        return cfConnectingIp;
    }

    if (xForwardedFor) {
        return xForwardedFor;
    }

    if (xRealIp) {
        return xRealIp;
    }

    if (remoteAddress) {
        return remoteAddress;
    }

    return null;
}

function normalizeIp(ip) {
    if (!ip) {
        return null;
    }
    if (ip.startsWith('::ffff:')) {
        return ip.slice('::ffff:'.length);
    }
    return ip;
}

function isAllowedIp(req) {
    const rawIp = getClientIp(req);
    const normalized = normalizeIp(rawIp);
    if (!normalized) {
        return false;
    }
    return allowedIps.has(normalized);
}

function sendHtml(res, statusCode, html) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(html);
}

function sendText(res, statusCode, text) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

// CHANGE: Add sendJson helper for API responses
// WHY: Need JSON responses for E2E testing API endpoints
// REF: E2E testing system implementation
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
}

// CHANGE: Add parseJsonBody helper to parse JSON request bodies
// WHY: Need to parse JSON payloads for POST requests to API endpoints
// REF: E2E testing system implementation
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString('utf8');
            if (body.length > 10 * 1024 * 1024) { // 10MB limit
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                if (body.trim() === '') {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function redirect(res, location) {
    res.writeHead(302, {
        Location: location,
        'Cache-Control': 'no-store'
    });
    res.end();
}

function renderLayout(title, bodyHtml, breadcrumbs) {
    const breadcrumbHtml = breadcrumbs
        ? `<nav class="text-xs text-gray-500">${breadcrumbs}</nav>`
        : '';

    // CHANGE: Add navigation links to Testing page
    // WHY: Need easy access to E2E testing system from admin panel
    // REF: E2E testing system implementation
    const navigationHtml = `
      <nav class="mb-4 flex gap-4 text-sm">
        <a href="${BASE_PATH}" class="text-blue-600 hover:underline">Authors</a>
        <a href="${BASE_PATH}/crm" class="text-blue-600 hover:underline">CRM</a>
        <a href="${BASE_PATH}/integrations" class="text-blue-600 hover:underline">Integrations</a>
        <a href="${BASE_PATH}/hydra-logs" class="text-blue-600 hover:underline">Hydra Logs</a>
        <a href="${BASE_PATH}/testing" class="text-blue-600 hover:underline">Testing</a>
        <a href="${BASE_PATH}/noxon" class="text-blue-600 hover:underline">Noxon</a>
        <a href="${BASE_PATH}/dashboard" class="text-blue-600 hover:underline">Dashboard</a>
      </nav>
    `;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${STATIC_PATH}/tailwind.min.css" />
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="max-w-6xl mx-auto px-6 py-6">
    ${navigationHtml}
    <header class="mb-6">
      <h1 class="text-2xl font-semibold">${escapeHtml(title)}</h1>
      ${breadcrumbHtml}
    </header>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// CHANGE: New integrations page for AI models management
// WHY: Separate AI configuration from main admin page
// REF: user request 2026-02-11
function renderIntegrationsPage(hydraModels, hydraError, hydraProfile, hydraProfileError, aiNotice) {
    let aiSettings = null;
    let aiSettingsError = null;
    try {
        aiSettings = readAiSettings();
    } catch (error) {
        aiSettingsError = error.message;
    }
    const promptModel = aiSettings ? aiSettings.prompt_model : null;
    const botModel = aiSettings ? aiSettings.bot_model : null;
    const updatedAt = aiSettings ? aiSettings.updated_at : null;
    const provider = aiSettings ? aiSettings.provider : null;
    const modelList = Array.isArray(hydraModels) ? hydraModels : [];
    const uniqueModels = Array.from(new Set([...(modelList || []), promptModel, botModel].filter(Boolean)));
    const promptOptionsHtml = uniqueModels.length
        ? uniqueModels.map(model => `
              <option value="${escapeHtml(model)}"${model === promptModel ? ' selected' : ''}>${escapeHtml(model)}</option>
          `).join('')
        : '<option value="">No models</option>';
    const botOptionsHtml = uniqueModels.length
        ? uniqueModels.map(model => `
              <option value="${escapeHtml(model)}"${model === botModel ? ' selected' : ''}>${escapeHtml(model)}</option>
          `).join('')
        : '<option value="">No models</option>';
    const noticeHtml = aiNotice
        ? `<div class="mb-3 rounded border ${aiNotice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'} px-3 py-2 text-sm">${escapeHtml(aiNotice.message)}</div>`
        : '';

    const body = `
      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">AI models & API configuration</h2>
        ${noticeHtml}
        ${aiSettingsError ? `
          <div class="text-sm text-red-600">${escapeHtml(aiSettingsError)}</div>
        ` : `
          ${hydraError ? `<div class="text-sm text-red-600 mb-3">${escapeHtml(hydraError)}</div>` : ''}
          ${hydraProfileError ? `<div class="text-sm text-red-600 mb-3">Balance error: ${escapeHtml(hydraProfileError)}</div>` : ''}
          <div class="grid gap-3 md:grid-cols-5">
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="text-xs uppercase tracking-wide text-gray-500">Prompt generator</div>
              <div class="text-sm font-semibold">${escapeHtml(promptModel)}</div>
            </div>
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="text-xs uppercase tracking-wide text-gray-500">Client bots</div>
              <div class="text-sm font-semibold">${escapeHtml(botModel)}</div>
            </div>
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="text-xs uppercase tracking-wide text-gray-500">Provider</div>
              <div class="text-sm font-semibold">${provider ? escapeHtml(provider) : '<span class="text-gray-400">missing</span>'}</div>
            </div>
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="text-xs uppercase tracking-wide text-gray-500">Balance</div>
              <div class="text-sm font-semibold">${hydraProfile && typeof hydraProfile.balance !== 'undefined' ? `$${hydraProfile.balance.toFixed(2)}` : '<span class="text-gray-400">n/a</span>'}</div>
            </div>
            <div class="border border-gray-200 rounded-lg p-3">
              <div class="text-xs uppercase tracking-wide text-gray-500">Updated</div>
              <div class="text-sm font-semibold">${escapeHtml(formatTimestamp(updatedAt))}</div>
            </div>
          </div>
          <form class="mt-4 grid gap-3 md:grid-cols-3" method="POST" action="${BASE_PATH}/ai-settings">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Prompt generator model</label>
              <select class="w-full border border-gray-300 rounded px-3 py-2 text-sm" name="prompt_model"${uniqueModels.length ? '' : ' disabled'}>
                ${promptOptionsHtml}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Client bots model</label>
              <select class="w-full border border-gray-300 rounded px-3 py-2 text-sm" name="bot_model"${uniqueModels.length ? '' : ' disabled'}>
                ${botOptionsHtml}
              </select>
            </div>
            <div class="flex items-end">
              <button class="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">Apply</button>
            </div>
          </form>
          <form class="mt-4 grid gap-3 grid-cols-3" method="POST" action="${BASE_PATH}/ai-redeem">
            <div class="col-span-2">
              <label class="block text-xs text-gray-500 mb-1">Hydra refill code</label>
              <input class="w-full border border-gray-300 rounded px-3 py-2 text-sm" name="code" placeholder="hydra-ai-XXXXX-refill-code" />
            </div>
            <div class="flex items-end">
              <button class="w-full bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium">Activate</button>
            </div>
          </form>
          <form class="mt-4 flex flex-wrap items-center gap-3" method="POST" action="${BASE_PATH}/ai-test">
            <button class="bg-slate-800 text-white rounded px-4 py-2 text-sm font-medium">Test API</button>
            <div class="text-xs text-gray-500">Uses model: ${escapeHtml(promptModel || botModel || 'n/a')}</div>
          </form>
          <form class="mt-4 grid gap-3 md:grid-cols-4" method="POST" action="${BASE_PATH}/ai-key-check">
            <div class="md:col-span-3">
              <label class="block text-xs text-gray-500 mb-1">Hydra API key check</label>
              <input class="w-full border border-gray-300 rounded px-3 py-2 text-sm" name="api_key" placeholder="sk-... (оставьте пустым чтобы проверить ключ из .env)" />
            </div>
            <div class="flex items-end">
              <button class="w-full bg-violet-700 text-white rounded px-4 py-2 text-sm font-medium">Check API key</button>
            </div>
          </form>
        `}
      </section>
    `;

    return renderLayout('Integrations', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / Integrations`);
}

// CHANGE: Hydra logs viewer page - inspired by salvio AdminLLMRequestsPage
// WHY: User requested "записывай абсолютно все запросы к hydra" with feedback capability
// REF: user request 2026-02-11, ~/salvio/web/src/pages/admin/AdminLLMRequestsPage.tsx
const { getAllLogs, getLogById, addFeedback: addLogFeedback, getLogStats } = require('./hydraLogger.ts');

function renderHydraLogsPage(aiNotice) {
    const logs = getAllLogs(100);
    const stats = getLogStats();

    const noticeHtml = aiNotice
        ? `<div class="mb-3 rounded border ${aiNotice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'} px-3 py-2 text-sm">${escapeHtml(aiNotice.message)}</div>`
        : '';

    const rowsHtml = logs.map(log => {
        const statusBadge = log.response.success
            ? '<span class="px-2 py-1 text-xs rounded bg-green-100 text-green-800">Success</span>'
            : '<span class="px-2 py-1 text-xs rounded bg-red-100 text-red-700">Error</span>';

        const feedbackBadge = log.feedback
            ? '<span class="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">💬 Has feedback</span>'
            : '<span class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">No feedback</span>';

        const tokens = log.response.usage?.total_tokens || 0;
        const latency = log.response.latencyMs || 0;

        return `
          <tr class="border-t border-gray-200">
            <td class="px-4 py-3 text-xs">
              <a href="${BASE_PATH}/hydra-logs/${encodeURIComponent(log.id)}" class="text-blue-600 hover:underline">${escapeHtml(log.id)}</a>
              <div class="text-gray-500 mt-1">${escapeHtml(formatTimestamp(log.timestamp))}</div>
            </td>
            <td class="px-4 py-3 text-xs">
              <div class="font-semibold">${escapeHtml(log.caller)}</div>
              <div class="text-gray-500">${escapeHtml(log.context.operation || 'n/a')}</div>
              ${log.context.userId ? `<div class="text-gray-500">User: ${escapeHtml(log.context.userId)}</div>` : ''}
            </td>
            <td class="px-4 py-3 text-xs">
              <div class="font-semibold">${escapeHtml(log.request.model)}</div>
              <div class="text-gray-500">${log.request.messages.length} messages</div>
            </td>
            <td class="px-4 py-3 text-xs">${statusBadge}</td>
            <td class="px-4 py-3 text-xs">
              <div>${tokens} tokens</div>
              <div class="text-gray-500">${latency}ms</div>
            </td>
            <td class="px-4 py-3 text-xs">${feedbackBadge}</td>
          </tr>
        `;
    }).join('');

    const body = `
      ${noticeHtml}
      <div class="mb-4 bg-white border border-gray-200 rounded-lg p-4">
        <h2 class="text-lg font-semibold mb-3">Stats</h2>
        <div class="grid gap-4 md:grid-cols-5">
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Total requests</div>
            <div class="text-xl font-semibold">${stats.totalRequests}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Success rate</div>
            <div class="text-xl font-semibold">${stats.successRate.toFixed(1)}%</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Total tokens</div>
            <div class="text-xl font-semibold">${stats.totalTokens.toLocaleString()}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Avg latency</div>
            <div class="text-xl font-semibold">${stats.avgLatencyMs.toFixed(0)}ms</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">With feedback</div>
            <div class="text-xl font-semibold">${stats.withFeedback}</div>
          </div>
        </div>
      </div>
      <div class="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="text-left px-4 py-2">ID / Timestamp</th>
              <th class="text-left px-4 py-2">Caller / Context</th>
              <th class="text-left px-4 py-2">Model / Messages</th>
              <th class="text-left px-4 py-2">Status</th>
              <th class="text-left px-4 py-2">Tokens / Latency</th>
              <th class="text-left px-4 py-2">Feedback</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td class="px-4 py-4 text-gray-500" colspan="6">No logs yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    return renderLayout('Hydra Logs', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / Hydra Logs`);
}

function renderHydraLogDetailPage(logId, aiNotice) {
    const log = getLogById(logId);
    if (!log) {
        return renderLayout('Log Not Found', '<div class="text-red-600">Log not found.</div>', `<a class="text-blue-600" href="${BASE_PATH}/hydra-logs">Hydra Logs</a>`);
    }

    const noticeHtml = aiNotice
        ? `<div class="mb-3 rounded border ${aiNotice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'} px-3 py-2 text-sm">${escapeHtml(aiNotice.message)}</div>`
        : '';

    const statusBadge = log.response.success
        ? '<span class="px-3 py-1 text-sm rounded bg-green-100 text-green-800 font-semibold">✓ Success</span>'
        : '<span class="px-3 py-1 text-sm rounded bg-red-100 text-red-700 font-semibold">✗ Error</span>';

    const requestJson = JSON.stringify(log.request, null, 2);
    const responseJson = JSON.stringify(log.response, null, 2);

    const body = `
      ${noticeHtml}
      <div class="mb-4">
        <a href="${BASE_PATH}/hydra-logs" class="text-blue-600 hover:underline">← Back to all logs</a>
      </div>
      <div class="grid gap-4">
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <h2 class="text-lg font-semibold mb-3">Overview</h2>
          <div class="grid gap-3 md:grid-cols-4">
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500">Status</div>
              <div class="mt-1">${statusBadge}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500">Caller</div>
              <div class="text-sm font-semibold">${escapeHtml(log.caller)}</div>
              <div class="text-xs text-gray-500">${escapeHtml(log.context.operation || '')}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500">Model</div>
              <div class="text-sm font-semibold">${escapeHtml(log.request.model)}</div>
            </div>
            <div>
              <div class="text-xs uppercase tracking-wide text-gray-500">Timestamp</div>
              <div class="text-sm">${escapeHtml(formatTimestamp(log.timestamp))}</div>
            </div>
          </div>
          ${log.response.usage ? `
            <div class="mt-4 grid gap-3 md:grid-cols-4">
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500">Prompt tokens</div>
                <div class="text-sm font-semibold">${log.response.usage.prompt_tokens || 0}</div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500">Completion tokens</div>
                <div class="text-sm font-semibold">${log.response.usage.completion_tokens || 0}</div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500">Total tokens</div>
                <div class="text-sm font-semibold">${log.response.usage.total_tokens || 0}</div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500">Latency</div>
                <div class="text-sm font-semibold">${log.response.latencyMs || 0}ms</div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <h2 class="text-lg font-semibold mb-3">Feedback</h2>
          ${log.feedback ? `
            <div class="mb-3 p-3 bg-blue-50 border border-blue-200 rounded">
              <div class="text-xs text-gray-500">Added: ${escapeHtml(formatTimestamp(log.feedback.addedAt))}</div>
              <div class="mt-1 text-sm">${escapeHtml(log.feedback.comment)}</div>
            </div>
          ` : '<div class="text-sm text-gray-500 mb-3">No feedback yet.</div>'}
          <form method="POST" action="${BASE_PATH}/hydra-logs/${encodeURIComponent(logId)}/feedback" class="grid gap-2">
            <textarea name="comment" rows="3" class="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="Add feedback / debug notes...">${log.feedback?.comment || ''}</textarea>
            <button class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium w-fit">Save feedback</button>
          </form>
        </div>

        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">Request</h2>
            <button onclick="navigator.clipboard.writeText(${escapeHtml(JSON.stringify(requestJson))})" class="bg-gray-200 text-gray-700 rounded px-3 py-1 text-xs font-medium">Copy</button>
          </div>
          <pre class="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto">${escapeHtml(requestJson)}</pre>
        </div>

        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">Response</h2>
            <button onclick="navigator.clipboard.writeText(${escapeHtml(JSON.stringify(responseJson))})" class="bg-gray-200 text-gray-700 rounded px-3 py-1 text-xs font-medium">Copy</button>
          </div>
          <pre class="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto">${escapeHtml(responseJson)}</pre>
        </div>
      </div>
    `;

    return renderLayout(`Hydra Log: ${logId}`, body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / <a class="text-blue-600" href="${BASE_PATH}/hydra-logs">Hydra Logs</a> / Detail`);
}

function renderDashboardPage(bots) {
    // Collect messaging stats per bot by scanning user_data/bot_* directories
    type BotStats = {
        botId: string;
        name: string;
        creatorId: string;
        sent: number;
        received: number;
        chats: number;
        ratio: number;
    };
    const botStatsMap: Record<string, BotStats> = {};
    let totalSent = 0;
    let totalReceived = 0;
    let totalChats = 0;

    // Build a lookup from bot_id to bot metadata
    const botLookup: Record<string, { nameprompt?: string; user_id?: string; first_name?: string }> = {};
    for (const bot of bots) {
        if (bot && bot.bot_id) {
            botLookup[String(bot.bot_id)] = bot;
        }
    }

    // Scan all bot_* directories
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('bot_')) continue;
        const botFolder = entry.name;
        const botId = botFolder.replace('bot_', '');
        const botDir = path.join(DATA_DIR, botFolder);

        let botSent = 0;
        let botReceived = 0;
        let botChats = 0;

        const chatFiles = fs.readdirSync(botDir).filter(f => f.startsWith('chat_') && f.endsWith('.json'));
        for (const chatFile of chatFiles) {
            try {
                const raw = fs.readFileSync(path.join(botDir, chatFile), 'utf-8');
                const messages = JSON.parse(raw);
                if (!Array.isArray(messages)) continue;
                botChats++;
                for (const m of messages) {
                    if (!m || typeof m.role !== 'string') continue;
                    if (m.role === 'assistant') botSent++;
                    else if (m.role === 'user') botReceived++;
                }
            } catch {
                // skip broken files
            }
        }

        const meta = botLookup[botId];
        const ratio = botSent > 0 ? Math.round((botReceived / botSent) * 100) : (botReceived > 0 ? 999 : 0);
        botStatsMap[botId] = {
            botId,
            name: (meta && (meta.first_name || meta.nameprompt)) || botFolder,
            creatorId: (meta && meta.user_id) ? String(meta.user_id) : '?',
            sent: botSent,
            received: botReceived,
            chats: botChats,
            ratio,
        };
        totalSent += botSent;
        totalReceived += botReceived;
        totalChats += botChats;
    }

    // Also count author conversations (with the main bananzabot)
    let authorSent = 0;
    let authorReceived = 0;
    let authorCount = 0;
    const conversations = loadAllConversationsForAdmin();
    if (conversations && typeof conversations === 'object') {
        for (const [, convo] of Object.entries(conversations)) {
            const c = convo as { messages?: Array<{ role?: string }> };
            const msgs = Array.isArray(c?.messages) ? c.messages : [];
            if (msgs.length === 0) continue;
            authorCount++;
            for (const m of msgs) {
                if (!m || typeof m.role !== 'string') continue;
                if (m.role === 'assistant') authorSent++;
                else if (m.role === 'user') authorReceived++;
            }
        }
    }
    totalSent += authorSent;
    totalReceived += authorReceived;

    const overallRatio = totalSent > 0 ? Math.round((totalReceived / totalSent) * 100) : 0;

    // Color function: 0% = red, 50% = yellow, 100%+ = green
    function ratioColor(r: number): string {
        if (r >= 100) return 'bg-green-100 text-green-800';
        if (r >= 70) return 'bg-green-50 text-green-700';
        if (r >= 40) return 'bg-yellow-50 text-yellow-800';
        if (r >= 20) return 'bg-orange-50 text-orange-700';
        return 'bg-red-50 text-red-700';
    }
    function ratioBar(r: number): string {
        const capped = Math.min(r, 150);
        const pct = Math.round((capped / 150) * 100);
        let barColor: string;
        if (r >= 100) barColor = '#22c55e';
        else if (r >= 70) barColor = '#84cc16';
        else if (r >= 40) barColor = '#eab308';
        else if (r >= 20) barColor = '#f97316';
        else barColor = '#ef4444';
        return `<div class="w-full bg-gray-200 rounded-full h-3"><div class="h-3 rounded-full" style="width:${pct}%;background:${barColor}"></div></div>`;
    }

    // Sort bots by ratio descending (best first)
    const sortedBots = Object.values(botStatsMap)
        .filter(b => b.sent + b.received > 0)
        .sort((a, b) => b.ratio - a.ratio);

    // Render per-bot table rows
    const botRowsHtml = sortedBots.map(b => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="px-3 py-2 text-sm">
                <a href="${BASE_PATH}/bots/${encodeURIComponent(b.name)}" class="text-blue-600 hover:underline">${escapeHtml(b.name)}</a>
                <div class="text-xs text-gray-400">${escapeHtml(b.creatorId)}</div>
            </td>
            <td class="px-3 py-2 text-sm text-right">${b.chats}</td>
            <td class="px-3 py-2 text-sm text-right text-blue-600 font-medium">${b.sent}</td>
            <td class="px-3 py-2 text-sm text-right text-green-600 font-medium">${b.received}</td>
            <td class="px-3 py-2 text-sm text-center">
                <span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${ratioColor(b.ratio)}">${b.ratio}%</span>
            </td>
            <td class="px-3 py-2 w-32">${ratioBar(b.ratio)}</td>
        </tr>
    `).join('');

    const bodyHtml = `
    <div class="space-y-6">
        <!-- Overall stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Мы отправили</div>
                <div class="text-3xl font-bold text-blue-600 mt-1">${totalSent}</div>
                <div class="text-xs text-gray-400 mt-1">сообщений (assistant)</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Нам написали</div>
                <div class="text-3xl font-bold text-green-600 mt-1">${totalReceived}</div>
                <div class="text-xs text-gray-400 mt-1">сообщений (user)</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Качество</div>
                <div class="text-3xl font-bold mt-1 ${overallRatio >= 100 ? 'text-green-600' : overallRatio >= 50 ? 'text-yellow-600' : 'text-red-600'}">${overallRatio}%</div>
                <div class="text-xs text-gray-400 mt-1">received / sent</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-xs text-gray-500 uppercase tracking-wide">Чатов</div>
                <div class="text-3xl font-bold text-gray-700 mt-1">${totalChats}</div>
                <div class="text-xs text-gray-400 mt-1">ботов с диалогами: ${sortedBots.length}</div>
            </div>
        </div>

        <!-- Overall bar -->
        <div class="bg-white rounded-lg shadow p-4">
            <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium text-gray-700">Общее качество</span>
                <span class="text-sm font-bold ${overallRatio >= 100 ? 'text-green-600' : overallRatio >= 50 ? 'text-yellow-600' : 'text-red-600'}">${overallRatio}%</span>
            </div>
            ${ratioBar(overallRatio)}
            <div class="flex justify-between text-xs text-gray-400 mt-1">
                <span>0% — плохо (мы пишем, нам не отвечают)</span>
                <span>100%+ — отлично (нам пишут больше)</span>
            </div>
        </div>

        <!-- Author conversations summary -->
        <div class="bg-white rounded-lg shadow p-4">
            <h2 class="text-sm font-semibold text-gray-700 mb-2">Авторы (диалоги с bananzabot)</h2>
            <div class="flex gap-6 text-sm">
                <span>Авторов с сообщениями: <b>${authorCount}</b></span>
                <span>Мы: <b class="text-blue-600">${authorSent}</b></span>
                <span>Нам: <b class="text-green-600">${authorReceived}</b></span>
                <span>Качество: <b class="${authorSent > 0 ? (Math.round((authorReceived / authorSent) * 100) >= 100 ? 'text-green-600' : 'text-yellow-600') : 'text-gray-400'}">${authorSent > 0 ? Math.round((authorReceived / authorSent) * 100) : 0}%</b></span>
            </div>
        </div>

        <!-- Per-bot table -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
            <h2 class="text-sm font-semibold text-gray-700 px-4 pt-4 pb-2">По ботам</h2>
            <table class="w-full text-left">
                <thead>
                    <tr class="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                        <th class="px-3 py-2">Бот</th>
                        <th class="px-3 py-2 text-right">Чаты</th>
                        <th class="px-3 py-2 text-right">Мы</th>
                        <th class="px-3 py-2 text-right">Нам</th>
                        <th class="px-3 py-2 text-center">Качество</th>
                        <th class="px-3 py-2"></th>
                    </tr>
                </thead>
                <tbody>
                    ${botRowsHtml}
                </tbody>
            </table>
            ${sortedBots.length === 0 ? '<p class="px-4 py-4 text-sm text-gray-400">Нет ботов с сообщениями</p>' : ''}
        </div>
    </div>`;

    return renderLayout('Dashboard — Messaging Quality', bodyHtml,
        `<a href="${BASE_PATH}">Admin</a> / Dashboard`);
}

// CHANGE: Add page to display all active bots
// WHY: User wants to see all active bots in one place
// REF: User request - "в админке на отдельном роуте покажи всех активных ботов"
function renderAllBotsPage(bots, aiNotice) {
    const activeBots = bots.filter(bot => bot && bot.status === 'active');

    // Count users for each bot
    const botUserCounts = new Map();
    if (fs.existsSync(DATA_DIR)) {
        const botDirs = fs.readdirSync(DATA_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
            .map(entry => entry.name);

        for (const botDir of botDirs) {
            const botPath = path.join(DATA_DIR, botDir);
            const userFiles = fs.readdirSync(botPath)
                .filter(f => !f.startsWith('chat_') && f.endsWith('.json') && f !== 'conversation.json');
            botUserCounts.set(botDir, userFiles.length);
        }
    }

    const rows = activeBots.map(bot => {
        const nameprompt = typeof bot.nameprompt === 'string' ? bot.nameprompt : 'n/a';
        const username = typeof bot.username === 'string' ? bot.username : null;
        const userId = typeof bot.user_id === 'string' ? bot.user_id : 'n/a';
        const createdAt = typeof bot.created_at === 'string' ? bot.created_at : null;
        const userCount = botUserCounts.get(nameprompt) || 0;

        return {
            nameprompt,
            username,
            userId,
            createdAt,
            userCount
        };
    });

    // Sort by creation date (newest first)
    rows.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime;
    });

    const body = `
      <div class="flex flex-wrap gap-4 mb-6">
        <div class="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-gray-500">Active Bots</div>
          <div class="text-xl font-semibold">${activeBots.length}</div>
        </div>
        <a href="${BASE_PATH}" class="bg-gray-600 text-white border border-gray-600 rounded-lg px-4 py-3 hover:bg-gray-700 flex items-center">
          <div class="text-xs uppercase tracking-wide">← Back to Authors</div>
        </a>
      </div>
      ${aiNotice ? renderAiNotice(aiNotice) : ''}
      <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="text-left px-4 py-2">Bot Name</th>
              <th class="text-left px-4 py-2">Username</th>
              <th class="text-left px-4 py-2">Owner</th>
              <th class="text-left px-4 py-2">Users</th>
              <th class="text-left px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr class="border-t border-gray-200">
                <td class="px-4 py-2">
                  <a class="text-blue-600 hover:underline" href="${BASE_PATH}/bots/${encodeURIComponent(row.nameprompt)}">${escapeHtml(row.nameprompt)}</a>
                </td>
                <td class="px-4 py-2">
                  ${row.username ? `<a class="text-blue-500 hover:underline" href="https://t.me/${escapeHtml(row.username)}" target="_blank">@${escapeHtml(row.username)}</a>` : '<span class="text-gray-400">no username</span>'}
                </td>
                <td class="px-4 py-2">
                  <a class="text-blue-600 hover:underline" href="${BASE_PATH}/authors/${encodeURIComponent(row.userId)}">${escapeHtml(row.userId)}</a>
                </td>
                <td class="px-4 py-2">${row.userCount}</td>
                <td class="px-4 py-2">${escapeHtml(formatTimestamp(row.createdAt))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    return renderLayout('All Active Bots', body, '<a class="text-blue-600" href="' + BASE_PATH + '">Authors</a> / Active Bots');
}

function renderAuthorIndex(conversations, bots, hydraModels, hydraError, hydraProfile, hydraProfileError, aiNotice, sortBy = 'lastActivity') {
    const botDirs = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
            .map(entry => entry.name)
        : [];
    const botsByUser = new Map();
    for (const bot of bots) {
        const ownerId = bot && bot.user_id !== undefined ? String(bot.user_id) : null;
        const name = bot && typeof bot.nameprompt === 'string' ? bot.nameprompt : null;
        if (!ownerId || !name) {
            continue;
        }
        if (!botsByUser.has(ownerId)) {
            botsByUser.set(ownerId, []);
        }
        botsByUser.get(ownerId).push(name);
    }

    const rows = [];
    for (const [userId, convo] of Object.entries(conversations)) {
        const { messages, error } = getMessagesInfo(convo, `Conversation for user ${userId}`);
        const lastMessage = messages && messages.length ? messages[messages.length - 1] : null;
        const lastTimestamp = lastMessage && typeof lastMessage.timestamp === 'string'
            ? lastMessage.timestamp
            : null;
        const firstUserMessage = messages
            ? messages.find(message => message && message.role === 'user' && typeof message.content === 'string' && message.content.trim())
            : null;
        const firstMessageText = firstUserMessage ? firstUserMessage.content.trim() : '';
        const firstMessagePreview = firstMessageText ? truncateText(firstMessageText, 140) : '';
        // CHANGE: Use referralDate as fallback for registration timestamp
        // WHY: Users who pressed /start but never sent a message have no firstUserMessage
        // REF: User report - no registration date for users who didn't send messages
        let regTimestamp = firstUserMessage && typeof firstUserMessage.timestamp === 'string'
            ? firstUserMessage.timestamp
            : null;
        if (!regTimestamp && convo && typeof convo === 'object') {
            const referralDate = typeof convo.referralDate === 'string' ? convo.referralDate : null;
            if (referralDate) {
                regTimestamp = referralDate;
            }
        }
        const stage = formatStageLabel(convo.stage);
        const messageCount = messages ? messages.length : 'invalid';
        let profile = findAuthorProfile(userId, botsByUser.get(userId) || [], botDirs);

        // CHANGE: Fallback to userInfo from conversation if no bot profile exists
        // WHY: New users don't have bot_* folders yet, but we have userInfo from /start
        // REF: User report - username missing on /admin/authors/<userId>
        if (!profile && convo && typeof convo === 'object') {
            const userInfo = convo.userInfo && typeof convo.userInfo === 'object' ? convo.userInfo : null;
            if (userInfo) {
                const uname = typeof userInfo.username === 'string' ? userInfo.username : null;
                const firstName = typeof userInfo.firstName === 'string' ? userInfo.firstName : null;
                const lastName = typeof userInfo.lastName === 'string' ? userInfo.lastName : null;
                const fullName = typeof userInfo.fullName === 'string' ? userInfo.fullName : null;
                const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || null;
                if (uname || name) {
                    profile = { username: uname ? `@${uname}` : null, name };
                }
            }
        }

        const username = profile && profile.username ? profile.username : null;
        rows.push({
            userId,
            username,
            firstMessagePreview,
            messageCount,
            lastTimestamp,
            regTimestamp,
            stage,
            error
        });
    }

    // Sort based on sortBy parameter
    rows.sort((a, b) => {
        if (sortBy === 'registration') {
            const aTime = a.regTimestamp ? Date.parse(a.regTimestamp) : 0;
            const bTime = b.regTimestamp ? Date.parse(b.regTimestamp) : 0;
            return bTime - aTime;
        } else {
            // Default: sort by last activity
            const aTime = a.lastTimestamp ? Date.parse(a.lastTimestamp) : 0;
            const bTime = b.lastTimestamp ? Date.parse(b.lastTimestamp) : 0;
            return bTime - aTime;
        }
    });

    let aiSettings = null;
    try {
        aiSettings = readAiSettings();
    } catch {
        aiSettings = null;
    }
    const promptModel = aiSettings ? aiSettings.prompt_model : null;
    const balance = hydraProfile && typeof hydraProfile.balance !== 'undefined' ? `$${hydraProfile.balance.toFixed(2)}` : 'n/a';

    const body = `
      <div class="flex flex-wrap gap-4 mb-6">
        <div class="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-gray-500">Authors</div>
          <div class="text-xl font-semibold">${rows.length}</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-gray-500">Bots</div>
          <div class="text-xl font-semibold">${bots.length}</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-gray-500">Model</div>
          <div class="text-sm font-semibold">${escapeHtml(promptModel || 'n/a')}</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-xs uppercase tracking-wide text-gray-500">Balance</div>
          <div class="text-sm font-semibold">${balance}</div>
        </div>
        <a href="${BASE_PATH}/active-bots" class="bg-green-600 text-white border border-green-600 rounded-lg px-4 py-3 hover:bg-green-700 flex items-center">
          <div class="text-xs uppercase tracking-wide">Active Bots →</div>
        </a>
        <a href="${BASE_PATH}/integrations" class="bg-blue-600 text-white border border-blue-600 rounded-lg px-4 py-3 hover:bg-blue-700 flex items-center">
          <div class="text-xs uppercase tracking-wide">Integrations →</div>
        </a>
      </div>
      <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="text-left px-4 py-2">User ID</th>
              <th class="text-left px-4 py-2">Username</th>
              <th class="text-left px-4 py-2">First message</th>
              <th class="text-left px-4 py-2">Stage</th>
              <th class="text-left px-4 py-2">Messages</th>
              <th class="text-left px-4 py-2">
                <a href="${BASE_PATH}?sortBy=registration" class="text-blue-600 hover:underline" title="Sort by registration date">
                  Registration ${sortBy === 'registration' ? '▼' : ''}
                </a>
              </th>
              <th class="text-left px-4 py-2">
                <a href="${BASE_PATH}?sortBy=lastActivity" class="text-blue-600 hover:underline" title="Sort by last activity">
                  Last activity ${sortBy === 'lastActivity' ? '▼' : ''}
                </a>
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr class="border-t border-gray-200">
                <td class="px-4 py-2">
                  <a class="text-blue-600 hover:underline" href="${BASE_PATH}/authors/${encodeURIComponent(row.userId)}">${escapeHtml(row.userId)}</a>
                </td>
                <td class="px-4 py-2">
                  ${row.username ? `<a class="text-blue-600 hover:underline" href="https://t.me/${escapeHtml(row.username.replace(/^@/, ''))}">${escapeHtml(row.username)}</a>` : '<span class="text-gray-400">missing</span>'}
                </td>
                <td class="px-4 py-2 max-w-md">
                  <div class="text-xs text-gray-700 break-words">${escapeHtml(row.firstMessagePreview || '')}</div>
                </td>
                <td class="px-4 py-2">${escapeHtml(row.stage)}</td>
                <td class="px-4 py-2">${escapeHtml(row.messageCount)}</td>
                <td class="px-4 py-2">${escapeHtml(formatTimestamp(row.regTimestamp))}</td>
                <td class="px-4 py-2">${escapeHtml(formatTimestamp(row.lastTimestamp))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    return renderLayout('Bananzabot Admin', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a>`);
}

function renderCrmPage(leads, aiNotice, filters = {}) {
    const noticeHtml = aiNotice
        ? `<div class="mb-3 rounded border ${aiNotice.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'} px-3 py-2 text-sm">${escapeHtml(aiNotice.message)}</div>`
        : '';

    // CHANGE: Add filters UI
    // WHY: Allow users to filter CRM leads by status, qualification, and search
    // REF: user request - "тут фильтры выведи"
    const statusOptions = ['', ...CRM_STATUS_ORDER].map(status => {
        const label = status ? (CRM_STATUS_LABELS[status] || status) : 'All statuses';
        const selected = filters.status === status ? ' selected' : '';
        return `<option value="${status}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');

    const qualificationOptions = [
        { value: '', label: 'All qualifications' },
        { value: 'commercial', label: 'Commercial' },
        { value: 'non_commercial', label: 'Non-commercial' },
        { value: 'unclear', label: 'Unclear' },
        { value: 'not_qualified', label: 'Not qualified' }
    ].map(opt => {
        const selected = filters.qualification === opt.value ? ' selected' : '';
        return `<option value="${opt.value}"${selected}>${escapeHtml(opt.label)}</option>`;
    }).join('');

    const filtersHtml = `
      <form method="GET" action="${BASE_PATH}/crm" class="mb-4 bg-white border border-gray-200 rounded-lg p-4">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select name="status" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              ${statusOptions}
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Qualification</label>
            <select name="qualification" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              ${qualificationOptions}
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Search (user ID, username, name, message)</label>
            <input type="text" name="search" value="${escapeHtml(filters.search || '')}" placeholder="Search..." class="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div class="flex items-end gap-2">
            <button type="submit" class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">Apply filters</button>
            <a href="${BASE_PATH}/crm" class="bg-gray-200 text-gray-700 rounded px-4 py-2 text-sm font-medium hover:bg-gray-300">Reset</a>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-4">
          <label class="flex items-center text-sm text-gray-700">
            <input type="checkbox" name="has_username" value="1" ${filters.hasUsername ? 'checked' : ''} class="mr-2">
            Только с никнеймом
          </label>
          <div>
            <select name="sort" class="border border-gray-300 rounded px-2 py-1 text-sm">
              <option value=""${!filters.sort ? ' selected' : ''}>Sort: default (status)</option>
              <option value="last_sent_desc"${filters.sort === 'last_sent_desc' ? ' selected' : ''}>Sort: last sent (newest)</option>
              <option value="last_sent_asc"${filters.sort === 'last_sent_asc' ? ' selected' : ''}>Sort: last sent (oldest)</option>
            </select>
          </div>
          <div class="text-xs text-gray-600">
            Showing ${leads.length} lead${leads.length !== 1 ? 's' : ''}
          </div>
        </div>
      </form>
    `;

    const rowsHtml = leads.map(lead => {
        const usernameClean = lead.username ? lead.username.replace(/^@/, '') : null;
        const openChatUrl = usernameClean ? `https://t.me/${encodeURIComponent(usernameClean)}` : null;
        const statusOptions = CRM_STATUS_ORDER.map(status => `<option value="${status}"${status === lead.crmStatus ? ' selected' : ''}>${escapeHtml(CRM_STATUS_LABELS[status] || status)}</option>`).join('');
        return `
          <tr class="border-t border-gray-200 align-top">
            <td class="px-4 py-3">
              <div><a class="text-blue-600 hover:underline" href="${BASE_PATH}/authors/${encodeURIComponent(lead.userId)}">${escapeHtml(lead.userId)}</a></div>
              <div class="text-xs text-gray-500">${lead.name ? escapeHtml(lead.name) : 'no name'}</div>
              <div class="text-xs">${lead.username ? `<a class="text-blue-600 hover:underline" href="${openChatUrl}">${escapeHtml(lead.username)}</a>` : '<span class="text-gray-400">no username</span>'}</div>
            </td>
            <td class="px-4 py-3 text-xs text-gray-700">
              <div><span class="font-semibold">Stage:</span> ${escapeHtml(lead.stage)}</div>
              <div><span class="font-semibold">Messages:</span> ${escapeHtml(lead.messageCount)}</div>
              <div><span class="font-semibold">Last:</span> ${escapeHtml(formatTimestamp(lead.lastTimestamp))}</div>
              <div><span class="font-semibold">Our last:</span> ${lead.lastSentAt ? escapeHtml(formatTimestamp(lead.lastSentAt)) + (lead.sentCount ? ` (${lead.sentCount}x)` : '') : '<span class="text-gray-400">never</span>'}</div>
              <div class="mt-2 break-words">${escapeHtml(truncateText(lead.firstMessage || '', 180))}</div>
            </td>
            <td class="px-4 py-3 min-w-[320px]">
              <div class="mb-2 text-xs font-semibold text-gray-500">Next follow-up:</div>
              <div class="text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-2 break-words whitespace-pre-wrap">${lead.followupText ? escapeHtml(truncateText(lead.followupText, 400)) : '<span class="text-gray-400">No follow-up generated</span>'}</div>
              <div class="flex gap-2 items-center mb-2">
                <button onclick="sendFollowup('${escapeHtml(lead.userId)}')" class="bg-black text-white rounded px-4 py-1.5 text-xs font-medium hover:bg-gray-800"${!lead.followupText ? ' disabled title="Generate follow-up first"' : ''}>Отправить сейчас</button>
                <button onclick="generateFollowup('${escapeHtml(lead.userId)}')" class="text-gray-500 hover:text-gray-800 text-xs underline">Перегенерировать</button>
                ${openChatUrl ? `<a class="text-blue-600 hover:text-blue-800 text-xs underline no-underline" href="${openChatUrl}" target="_blank" rel="noreferrer">Chat</a>` : ''}
              </div>
              <textarea id="followup-text-${escapeHtml(lead.userId)}" rows="3" class="hidden w-full border border-gray-300 rounded px-2 py-2 text-xs" placeholder="Follow-up text">${escapeHtml(lead.followupText || '')}</textarea>
              <div id="followup-result-${escapeHtml(lead.userId)}" class="hidden text-xs rounded px-3 py-2"></div>
              ${lead.sentCount > 0 ? `
              <div class="text-xs text-gray-400 mt-1">Sent ${lead.sentCount}x, last ${escapeHtml(formatTimestamp(lead.lastSentAt))}</div>` : ''}
              <div id="followup-history-${escapeHtml(lead.userId)}" class="mt-1 text-xs"></div>
            </td>
            <td class="px-4 py-3 min-w-[200px]">
              ${renderQualificationBadge(lead.qualification)}
              <form method="POST" action="${BASE_PATH}/crm/qualify" class="mt-2">
                <input type="hidden" name="user_id" value="${escapeHtml(lead.userId)}" />
                <input type="hidden" name="return_to" value="${BASE_PATH}/crm" />
                <button class="w-full bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700 border border-blue-700 shadow">Квалифицировать</button>
              </form>
            </td>
          </tr>
        `;
    }).join('');

    const body = `
      ${noticeHtml}
      ${filtersHtml}
      <div class="mb-4 bg-white border border-gray-200 rounded-lg p-4">
        <h2 class="text-lg font-semibold mb-1">Manager process</h2>
        <div class="text-sm text-gray-700">
          1) Generate follow-up with AI → 2) Edit text if needed → 3) Send message from CRM → 4) Set status/next action.
        </div>
      </div>
      <div class="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="text-left px-4 py-2">Lead</th>
              <th class="text-left px-4 py-2">Context</th>
              <th class="text-left px-4 py-2">Follow-up</th>
              <th class="text-left px-4 py-2">Квалификация</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td class="px-4 py-4 text-gray-500" colspan="4">No leads for follow-up.</td></tr>'}
          </tbody>
        </table>
      </div>
      <script>
        // CHANGE: Add AJAX function for follow-up send
        // WHY: User requested AJAX button with visible result instead of page reload
        // REF: user request - "результат должен быть показан и сделай тут аякс кнопку"
        async function sendFollowup(userId) {
          const textarea = document.getElementById('followup-text-' + userId);
          const resultDiv = document.getElementById('followup-result-' + userId);
          const followupText = textarea.value.trim();

          if (!followupText) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = '❌ Please enter follow-up text';
            resultDiv.classList.remove('hidden');
            return;
          }

          // Show loading state
          resultDiv.className = 'text-xs rounded px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700';
          resultDiv.textContent = '⏳ Sending...';
          resultDiv.classList.remove('hidden');

          try {
            const response = await fetch('/api/crm/followup/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id: userId,
                followup_text: followupText
              })
            });

            const data = await response.json();

            if (data.success) {
              // CHANGE: Show result in permanent history block instead of auto-reload
              // WHY: User complained result disappears too quickly
              // REF: user request - "сообщение сразу пропадает... добавь результат отправки в отдельное поле чтоб видно было"
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-green-50 border border-green-200 text-green-700';
              resultDiv.textContent = data.message;

              // Add to permanent history
              const historyDiv = document.getElementById('followup-history-' + userId);
              const timestamp = new Date().toLocaleString('ru-RU');
              const historyEntry = document.createElement('div');
              historyEntry.className = 'mb-1 p-2 bg-green-50 border border-green-200 rounded text-green-700';
              historyEntry.innerHTML = '<strong>' + timestamp + ':</strong> ' + data.message;
              historyDiv.insertBefore(historyEntry, historyDiv.firstChild);

              // Hide temp result after 3 seconds
              setTimeout(() => {
                resultDiv.classList.add('hidden');
              }, 3000);
            } else {
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
              resultDiv.textContent = '❌ ' + (data.error || 'Failed to send');

              // Add error to history
              const historyDiv = document.getElementById('followup-history-' + userId);
              const timestamp = new Date().toLocaleString('ru-RU');
              const historyEntry = document.createElement('div');
              historyEntry.className = 'mb-1 p-2 bg-red-50 border border-red-200 rounded text-red-700';
              historyEntry.innerHTML = '<strong>' + timestamp + ':</strong> ❌ ' + (data.error || 'Failed');
              historyDiv.insertBefore(historyEntry, historyDiv.firstChild);
            }
          } catch (error) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = '❌ Network error: ' + error.message;
          }
        }

        // CHANGE: Add AJAX function for follow-up generation
        // WHY: User requested AJAX button for generate as well
        // REF: user request - "Generate AI follow-up тоже сделай"
        async function generateFollowup(userId) {
          const textarea = document.getElementById('followup-text-' + userId);
          const resultDiv = document.getElementById('followup-result-' + userId);
          const generateBtn = event.target;

          // Disable button and show loading state
          generateBtn.disabled = true;
          generateBtn.textContent = '⏳ Generating...';
          resultDiv.className = 'text-xs rounded px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700';
          resultDiv.textContent = '🤖 AI is generating follow-up message...';
          resultDiv.classList.remove('hidden');

          try {
            const response = await fetch('/api/crm/followup/generate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id: userId
              })
            });

            const data = await response.json();

            if (data.success) {
              textarea.value = data.followupText;

              // Update visible preview
              const td = textarea.closest('td');
              const previewDiv = td ? td.querySelector('.bg-gray-50.border') : null;
              if (previewDiv) {
                const t = data.followupText;
                previewDiv.textContent = t.length > 400 ? t.substring(0, 397) + '...' : t;
              }
              const sendBtn = td ? td.querySelector('button[onclick*="sendFollowup"]') : null;
              if (sendBtn) sendBtn.disabled = false;

              resultDiv.className = 'text-xs rounded px-3 py-2 bg-green-50 border border-green-200 text-green-700';
              resultDiv.textContent = data.message;
              setTimeout(() => { resultDiv.classList.add('hidden'); }, 3000);
            } else {
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
              resultDiv.textContent = (data.error || 'Failed to generate');
            }
          } catch (error) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = 'Network error: ' + error.message;
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Перегенерировать';
          }
        }
      </script>
    `;

    return renderLayout('Bananzabot CRM', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / CRM`);
}

function renderMessages(messages, referralDate = null) {
    if (!messages.length) {
        // CHANGE: Show /start event if user pressed start but didn't send any messages
        // WHY: Admin needs to see that user at least opened the bot
        // REF: User report - "не видно что им написал бот"
        if (referralDate) {
            return `
                <div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div class="text-xs text-gray-500 mb-2">#1 · ${escapeHtml(formatTimestamp(referralDate))} · system</div>
                  <div class="text-sm text-gray-700">User pressed /start button</div>
                  <div class="text-xs text-gray-500 mt-2">Bot sent welcome message (not shown in conversation history)</div>
                </div>
            `;
        }
        return '<div class="text-sm text-gray-500">No messages yet.</div>';
    }

    const ordered = messages.map((message, index) => {
        const rawTimestamp = message && typeof message.timestamp === 'string' ? message.timestamp : null;
        const parsed = rawTimestamp ? Date.parse(rawTimestamp) : NaN;
        return {
            message,
            index,
            timestamp: Number.isNaN(parsed) ? null : parsed
        };
    }).sort((a, b) => {
        if (a.timestamp !== null && b.timestamp !== null) {
            return a.timestamp - b.timestamp;
        }
        if (a.timestamp !== null) {
            return -1;
        }
        if (b.timestamp !== null) {
            return 1;
        }
        return a.index - b.index;
    });

    return ordered.map((entry, displayIndex) => {
        const message = entry.message;
        const role = message && typeof message.role === 'string' ? message.role : 'unknown';
        const timestamp = message && typeof message.timestamp === 'string' ? message.timestamp : null;
        const content = message && message.content !== undefined ? message.content : '';
        const orderLabel = `#${displayIndex + 1}`;
        return `
        <div class="border border-gray-200 rounded-lg p-3 bg-white">
          <div class="text-xs text-gray-500 mb-2">${escapeHtml(orderLabel)} · ${escapeHtml(formatTimestamp(timestamp))} · ${escapeHtml(role)}</div>
          <pre class="whitespace-pre-wrap break-words text-sm text-gray-900">${escapeHtml(content)}</pre>
        </div>
        `;
    }).join('');
}

// CHANGE: Add testMessages parameter to show test conversation with created bot
// WHY: Admin needs to see test_messages that users send to their created bots
// REF: User request to show test_messages for user 8423327329
function renderAuthorPage(userId, convo, userBots, authorProfile, testMessages, activeTab = 'overview') {
    const { messages, error } = getMessagesInfo(convo, `Conversation for user ${userId}`);
    const referralDate = convo && typeof convo === 'object' && typeof convo.referralDate === 'string' ? convo.referralDate : null;
    const messageBlock = messages
        ? renderMessages(messages, referralDate)
        : `\n          <div class=\"text-sm text-red-600\">${escapeHtml(error)}</div>\n          <pre class=\"whitespace-pre-wrap break-words text-sm bg-white border border-gray-200 rounded-lg p-4\">${escapeHtml(JSON.stringify(convo.messages, null, 2))}</pre>\n        `;
    // CHANGE: Provide admin test link for the user's test bot session.
    // WHY: Admin needs quick access to the same test link sent to the user.
    // QUOTE(ТЗ): "доабвляй сюда ссылку на тестирование бота (ту которую он отправляет юзеру)"
    // REF: user request 2026-01-28
    const hasGeneratedPrompt = typeof convo.generated_prompt === 'string' && convo.generated_prompt.trim() !== '';
    const testLink = `https://t.me/bananzatestbot?start=test_${encodeURIComponent(userId)}`;
    const testLinkBlock = hasGeneratedPrompt
        ? `\n          <a class=\"text-blue-600 hover:underline\" href=\"${testLink}\">${escapeHtml(testLink)}</a>\n        `
        : '<div class=\"text-sm text-gray-500\">Test link will appear after prompt generation.</div>';

    // CHANGE: Render test messages section if test dialog exists
    // WHY: Show test conversation between user and their created bot
    // REF: User request - test_messages not visible for user 8423327329
    const testMessagesBlock = testMessages && Array.isArray(testMessages) && testMessages.length > 0
        ? `
        <section>
          <h2 class="text-lg font-semibold mb-3">Test Messages (User testing their bot)</h2>
          <div class="grid gap-3">
            ${renderMessages(testMessages)}
          </div>
        </section>
        `
        : '';

    const botsList = userBots.map(bot => {
        const botName = typeof bot.nameprompt === 'string' ? bot.nameprompt : 'n/a';
        const status = typeof bot.status === 'string' ? bot.status : 'n/a';
        const createdAt = typeof bot.created_at === 'string' ? bot.created_at : null;
        // CHANGE: Add bot username (Telegram handle) to display
        // WHY: User wants to see bot's Telegram username in admin panel
        // REF: User request - "добавь кстати в колонку если бот создан его никнейм"
        const botUsername = typeof bot.username === 'string' ? `@${bot.username}` : null;
        return `
        <div class="border border-gray-200 rounded-lg p-4 bg-white">
          <div class="flex flex-wrap items-center gap-2">
            <a class="text-blue-600 font-semibold hover:underline" href="${BASE_PATH}/bots/${encodeURIComponent(botName)}">${escapeHtml(botName)}</a>
            ${botUsername ? `<a class="text-sm text-blue-500 hover:underline" href="https://t.me/${escapeHtml(bot.username)}" target="_blank">${escapeHtml(botUsername)}</a>` : ''}
            <span class="text-xs text-gray-500">${escapeHtml(status)}</span>
          </div>
          <div class="text-xs text-gray-500">Created: ${escapeHtml(formatTimestamp(createdAt))}</div>
        </div>
        `;
    }).join('');

    const authorUsername = authorProfile && authorProfile.username ? authorProfile.username : null;
    const authorName = authorProfile && authorProfile.name ? authorProfile.name : null;
    const authorBody = `
      <div class="bg-white border border-gray-200 rounded-lg p-4">
        <div class="grid gap-2 md:grid-cols-3">
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">User ID</div>
            <div class="text-sm font-semibold">${escapeHtml(userId)}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Username</div>
            <div class="text-sm font-semibold">
              ${authorUsername ? `<a class="text-blue-600 hover:underline" href="https://t.me/${escapeHtml(authorUsername.replace(/^@/, ''))}">${escapeHtml(authorUsername)}</a>` : '<span class="text-gray-400">missing</span>'}
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-gray-500">Name</div>
            <div class="text-sm font-semibold">${authorName ? escapeHtml(authorName) : '<span class="text-gray-400">missing</span>'}</div>
          </div>
        </div>
      </div>
    `;
    const crmState = readCrmState();
    const crmLead = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
    const currentFollowupText = typeof crmLead.followupText === 'string' ? crmLead.followupText : '';
    const currentStatus = normalizeCrmStatus(crmLead.status);
    const crmStatusOptions = CRM_STATUS_ORDER
        .map(status => `<option value="${status}"${status === currentStatus ? ' selected' : ''}>${escapeHtml(CRM_STATUS_LABELS[status] || status)}</option>`)
        .join('');

    // CHANGE: Extract sent follow-ups from conversation history for display in CRM tab
    // WHY: User requested to see history of messages sent via pyrogram in CRM
    // REF: user request - "в crm история общения от моего имени с челом через пирограм так ведь?"
    const sentFollowups = convo && Array.isArray(convo.messages)
        ? convo.messages
            .filter(m => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('[CRM follow-up sent to'))
            .slice(-5)  // last 5 sent follow-ups
            .reverse()
            .map(m => {
                const timestamp = m.timestamp ? new Date(m.timestamp).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '';
                const content = m.content.replace(/^\[CRM follow-up sent to [^\]]+\]\n/, '');
                return `<div class="mb-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs"><div class="font-semibold text-gray-600 mb-1">${escapeHtml(timestamp)}</div><div class="text-gray-700">${escapeHtml(truncateText(content, 200))}</div></div>`;
            })
            .join('')
        : '';

    const crmBlock = `
      <section>
        <h2 class="text-lg font-semibold mb-3">CRM Follow-up</h2>
        <div class="bg-white border border-gray-200 rounded-lg p-4 grid gap-3">
          <div class="text-xs text-gray-600">
            Сгенерируй короткий follow-up, проверь текст, отправь в Telegram из личного аккаунта и зафиксируй статус.
          </div>
          <div>
            <button onclick="generateFollowup('${escapeHtml(userId)}')" class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium">Generate AI follow-up</button>
          </div>
          <div class="grid gap-2">
            <textarea id="followup-text-${escapeHtml(userId)}" rows="5" class="w-full border border-gray-300 rounded px-2 py-2 text-sm" placeholder="Follow-up text">${escapeHtml(currentFollowupText)}</textarea>
            <div id="followup-result-${escapeHtml(userId)}" class="hidden text-xs rounded px-3 py-2"></div>
            <div class="flex gap-2 items-center">
              <button onclick="sendFollowup('${escapeHtml(userId)}')" class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium">Send follow-up to Telegram</button>
              ${authorUsername ? `<a class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium no-underline" href="https://t.me/${escapeHtml(authorUsername.replace(/^@/, ''))}?text=${encodeURIComponent(currentFollowupText)}" target="_blank" rel="noreferrer">Open chat</a>` : '<span class="text-xs text-amber-700">Username не найден: будет отправка по user_id</span>'}
            </div>
          </div>
          <form method="POST" action="${BASE_PATH}/crm/lead/update" class="grid gap-2 md:grid-cols-4">
            <input type="hidden" name="user_id" value="${escapeHtml(userId)}" />
            <input type="hidden" name="return_to" value="${escapeHtml(buildAuthorPath(userId))}" />
            <select name="status" class="border border-gray-300 rounded px-2 py-2 text-sm">${crmStatusOptions}</select>
            <input name="next_followup_at" type="datetime-local" class="border border-gray-300 rounded px-2 py-2 text-sm" value="${escapeHtml(typeof crmLead.nextFollowupAt === 'string' ? crmLead.nextFollowupAt : '')}" />
            <input name="note" class="border border-gray-300 rounded px-2 py-2 text-sm md:col-span-2" value="${escapeHtml(typeof crmLead.note === 'string' ? crmLead.note : '')}" placeholder="Manager note" />
            <button class="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium md:col-span-4">Save CRM state</button>
          </form>
          <div class="text-xs text-gray-600">
            Status: ${escapeHtml(CRM_STATUS_LABELS[currentStatus] || currentStatus)} · Sent: ${escapeHtml(Number.isInteger(crmLead.sentCount) ? crmLead.sentCount : 0)} · Last sent: ${escapeHtml(formatTimestamp(typeof crmLead.lastSentAt === 'string' ? crmLead.lastSentAt : null))}
          </div>
          <div id="followup-history-${escapeHtml(userId)}" class="mt-2 text-xs"></div>
          ${sentFollowups ? `
          <div class="border-t border-gray-200 pt-3 mt-3">
            <div class="text-sm font-semibold mb-2">История отправленных follow-up</div>
            ${sentFollowups}
          </div>
          ` : ''}
          ${crmLead.qualification ? `
          <div class="border-t border-gray-200 pt-3 mt-3">
            <div class="text-sm font-semibold mb-2">Квалификация: ${renderQualificationBadge(crmLead.qualification)}</div>
            <div class="text-xs text-gray-700 mb-1"><span class="font-semibold">Причина:</span> ${escapeHtml(crmLead.qualification.reason || 'n/a')}</div>
            ${crmLead.qualification.flags && Array.isArray(crmLead.qualification.flags) && crmLead.qualification.flags.length > 0 ? `
            <div class="text-xs text-amber-700"><span class="font-semibold">Флаги:</span> ${escapeHtml(crmLead.qualification.flags.join(', '))}</div>
            ` : ''}
            <div class="text-xs text-gray-500 mt-1">Проанализировано: ${escapeHtml(formatTimestamp(crmLead.qualification.analyzedAt))}</div>
          </div>
          ` : ''}
        </div>
      </section>
    `;
    // CHANGE: Add tab navigation
    // WHY: User requested to split author page into tabs with routes
    // REF: user request - "разбей на табы внутри лида все"
    const tabs = [
        { id: 'overview', label: 'Overview', route: `${BASE_PATH}/authors/${encodeURIComponent(userId)}` },
        { id: 'crm', label: 'CRM', route: `${BASE_PATH}/authors/${encodeURIComponent(userId)}/crm` },
        { id: 'messages', label: 'Messages', route: `${BASE_PATH}/authors/${encodeURIComponent(userId)}/messages` },
        { id: 'bots', label: 'Bots', route: `${BASE_PATH}/authors/${encodeURIComponent(userId)}/bots` }
    ];
    const tabsHtml = tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const classes = isActive
            ? 'px-4 py-2 border-b-2 border-blue-600 text-blue-600 font-medium'
            : 'px-4 py-2 border-b-2 border-transparent text-gray-600 hover:text-blue-600';
        return `<a href="${tab.route}" class="${classes}">${escapeHtml(tab.label)}</a>`;
    }).join('');

    // Content for each tab
    let tabContent = '';
    if (activeTab === 'overview') {
        tabContent = `
          <section>
            <h2 class="text-lg font-semibold mb-3">Author</h2>
            ${authorBody}
          </section>
          <section>
            <h2 class="text-lg font-semibold mb-3">Test bot link</h2>
            <div class="bg-white border border-gray-200 rounded-lg p-4">
              ${testLinkBlock}
            </div>
          </section>
        `;
    } else if (activeTab === 'crm') {
        tabContent = crmBlock;
    } else if (activeTab === 'messages') {
        tabContent = `
          <section>
            <h2 class="text-lg font-semibold mb-3">Author dialog</h2>
            <div class="grid gap-3">
              ${messageBlock}
            </div>
          </section>
          ${testMessagesBlock}
        `;
    } else if (activeTab === 'bots') {
        tabContent = `
          <section>
            <h2 class="text-lg font-semibold mb-3">Created bots</h2>
            <div class="grid gap-3">
              ${botsList || '<div class="text-sm text-gray-500">No bots found for this author.</div>'}
            </div>
          </section>
        `;
    }

    const body = `
      <div class="mb-6 border-b border-gray-200">
        <nav class="flex gap-4">
          ${tabsHtml}
        </nav>
      </div>
      <div class="grid gap-6">
        ${tabContent}
      </div>
      <script>
        // CHANGE: Add AJAX functions for follow-up on author page
        // WHY: User requested AJAX buttons for both generate and send
        // REF: user request - "Generate AI follow-up тоже сделай"
        async function sendFollowup(userId) {
          const textarea = document.getElementById('followup-text-' + userId);
          const resultDiv = document.getElementById('followup-result-' + userId);
          const followupText = textarea.value.trim();

          if (!followupText) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = '❌ Please enter follow-up text';
            resultDiv.classList.remove('hidden');
            return;
          }

          // Show loading state
          resultDiv.className = 'text-xs rounded px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700';
          resultDiv.textContent = '⏳ Sending...';
          resultDiv.classList.remove('hidden');

          try {
            const response = await fetch('/api/crm/followup/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id: userId,
                followup_text: followupText
              })
            });

            const data = await response.json();

            if (data.success) {
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-green-50 border border-green-200 text-green-700';
              resultDiv.textContent = data.message;

              // Add to permanent history
              const historyDiv = document.getElementById('followup-history-' + userId);
              const timestamp = new Date().toLocaleString('ru-RU');
              const historyEntry = document.createElement('div');
              historyEntry.className = 'mb-1 p-2 bg-green-50 border border-green-200 rounded text-green-700';
              historyEntry.innerHTML = '<strong>' + timestamp + ':</strong> ' + data.message;
              historyDiv.insertBefore(historyEntry, historyDiv.firstChild);

              // Hide temp result after 3 seconds
              setTimeout(() => {
                resultDiv.classList.add('hidden');
              }, 3000);
            } else {
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
              resultDiv.textContent = '❌ ' + (data.error || 'Failed to send');

              // Add error to history
              const historyDiv = document.getElementById('followup-history-' + userId);
              const timestamp = new Date().toLocaleString('ru-RU');
              const historyEntry = document.createElement('div');
              historyEntry.className = 'mb-1 p-2 bg-red-50 border border-red-200 rounded text-red-700';
              historyEntry.innerHTML = '<strong>' + timestamp + ':</strong> ❌ ' + (data.error || 'Failed');
              historyDiv.insertBefore(historyEntry, historyDiv.firstChild);
            }
          } catch (error) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = '❌ Network error: ' + error.message;
          }
        }

        async function generateFollowup(userId) {
          const textarea = document.getElementById('followup-text-' + userId);
          const resultDiv = document.getElementById('followup-result-' + userId);
          const generateBtn = event.target;

          // Disable button and show loading state
          generateBtn.disabled = true;
          generateBtn.textContent = '⏳ Generating...';
          resultDiv.className = 'text-xs rounded px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700';
          resultDiv.textContent = '🤖 AI is generating follow-up message...';
          resultDiv.classList.remove('hidden');

          try {
            const response = await fetch('/api/crm/followup/generate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id: userId
              })
            });

            const data = await response.json();

            if (data.success) {
              // Update textarea with generated text
              textarea.value = data.followupText;

              resultDiv.className = 'text-xs rounded px-3 py-2 bg-green-50 border border-green-200 text-green-700';
              resultDiv.textContent = '✨ ' + data.message;

              // Hide result after 3 seconds
              setTimeout(() => {
                resultDiv.classList.add('hidden');
              }, 3000);
            } else {
              resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
              resultDiv.textContent = '❌ ' + (data.error || 'Failed to generate');
            }
          } catch (error) {
            resultDiv.className = 'text-xs rounded px-3 py-2 bg-red-50 border border-red-200 text-red-700';
            resultDiv.textContent = '❌ Network error: ' + error.message;
          } finally {
            // Re-enable button
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate AI follow-up';
          }
        }
      </script>
    `;

    const breadcrumbs = `
      <a class="text-blue-600" href="${BASE_PATH}">Authors</a>
      <span class="mx-1">/</span>
      <span>${escapeHtml(userId)}</span>
    `;

    return renderLayout(`Author ${userId}`, body, breadcrumbs);
}

function renderBotIndex(botName, chatFiles) {
    const body = `
      <section class="grid gap-3">
        ${chatFiles.length ? chatFiles.map(file => `
          <div class="border border-gray-200 rounded-lg p-4 bg-white">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-gray-500">Chat file</div>
                <div class="font-semibold">${escapeHtml(file.displayName)}</div>
              </div>
              <a class="text-blue-600 hover:underline" href="${BASE_PATH}/bots/${encodeURIComponent(botName)}/chats/${encodeURIComponent(file.fileName)}">Open</a>
            </div>
            <div class="text-xs text-gray-500">Messages: ${escapeHtml(file.messageCount)}</div>
            <div class="text-xs text-gray-500">Last modified: ${escapeHtml(formatTimestamp(file.modifiedAt))}</div>
          </div>
        `).join('') : '<div class="text-sm text-gray-500">No dialogs found for this bot.</div>'}
      </section>
    `;

    const breadcrumbs = `
      <a class="text-blue-600" href="${BASE_PATH}">Authors</a>
      <span class="mx-1">/</span>
      <span>${escapeHtml(botName)}</span>
    `;

    return renderLayout(`Bot ${botName}`, body, breadcrumbs);
}

function renderBotChat(botName, fileName, chatData) {
    const isArray = Array.isArray(chatData);
    const contentHtml = isArray
        ? renderMessages(chatData)
        : `<pre class="whitespace-pre-wrap break-words text-sm bg-white border border-gray-200 rounded-lg p-4">${escapeHtml(JSON.stringify(chatData, null, 2))}</pre>`;

    const body = `
      <section class="grid gap-3">
        <div class="text-xs text-gray-500">File: ${escapeHtml(fileName)}</div>
        ${contentHtml}
      </section>
    `;

    const breadcrumbs = `
      <a class="text-blue-600" href="${BASE_PATH}">Authors</a>
      <span class="mx-1">/</span>
      <a class="text-blue-600" href="${BASE_PATH}/bots/${encodeURIComponent(botName)}">${escapeHtml(botName)}</a>
      <span class="mx-1">/</span>
      <span>${escapeHtml(fileName)}</span>
    `;

    return renderLayout(`Bot ${botName} chat`, body, breadcrumbs);
}

// CHANGE: Add renderTestDetailsPage function to show full test conversation
// WHY: Admin needs to see exactly what was said in each test
// REF: User request to view test details
function renderTestDetailsPage(testRun, testResult) {
    const conversationHtml = testResult.conversation.map((msg, idx) => {
        const roleColor = msg.role === 'user' ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200';
        const timestamp = msg.timestamp ? formatTimestamp(msg.timestamp) : 'n/a';
        return `
          <div class="border rounded-lg p-3 ${roleColor}">
            <div class="text-xs font-semibold mb-2">#${idx + 1} · ${escapeHtml(timestamp)} · ${escapeHtml(msg.role.toUpperCase())}</div>
            <pre class="whitespace-pre-wrap break-words text-sm">${escapeHtml(msg.content)}</pre>
          </div>
        `;
    }).join('');

    const checksHtml = testResult.checks.map(check => {
        const statusColor = check.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
        const statusIcon = check.passed ? '✅' : '❌';
        return `
          <div class="border rounded-lg p-3 ${statusColor}">
            <div class="text-sm font-semibold mb-1">${statusIcon} ${escapeHtml(check.type)}</div>
            ${check.details ? `<pre class="text-xs text-gray-700 mt-2">${escapeHtml(JSON.stringify(check.details, null, 2))}</pre>` : ''}
          </div>
        `;
    }).join('');

    const body = `
      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">Test Summary</h2>
        <div class="grid grid-cols-4 gap-3 text-sm">
          <div>
            <span class="text-gray-500">Test ID:</span>
            <span class="font-semibold ml-1">${escapeHtml(testResult.testId)}</span>
          </div>
          <div>
            <span class="text-gray-500">Category:</span>
            <span class="font-semibold ml-1">${escapeHtml(testResult.category)}</span>
          </div>
          <div>
            <span class="text-gray-500">Score:</span>
            <span class="font-semibold ml-1 ${testResult.passed ? 'text-green-600' : 'text-red-600'}">${testResult.score}%</span>
          </div>
          <div>
            <span class="text-gray-500">Model:</span>
            <span class="font-semibold ml-1">${escapeHtml(testResult.model_used)}</span>
          </div>
        </div>
        <div class="mt-3 p-3 border border-gray-200 rounded bg-gray-50">
          <div class="text-xs text-gray-500 mb-1">AI Feedback</div>
          <div class="text-sm">${escapeHtml(testResult.evaluation.feedback || 'No feedback')}</div>
        </div>
      </section>

      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">Conversation (${testResult.conversation.length} messages)</h2>
        <div class="space-y-3">
          ${conversationHtml}
        </div>
      </section>

      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">Checks (${testResult.checks.length})</h2>
        <div class="space-y-3">
          ${checksHtml}
        </div>
      </section>

      <section class="bg-white border border-gray-200 rounded-lg p-4">
        <h2 class="text-lg font-semibold mb-4">Full Evaluation</h2>
        <pre class="whitespace-pre-wrap break-words text-sm bg-gray-50 border border-gray-200 rounded p-4">${escapeHtml(JSON.stringify(testResult.evaluation, null, 2))}</pre>
      </section>
    `;

    const breadcrumbs = `
      <a class="text-blue-600" href="${BASE_PATH}">Authors</a>
      <span class="mx-1">/</span>
      <a class="text-blue-600" href="${BASE_PATH}/testing">Testing</a>
      <span class="mx-1">/</span>
      <span>${escapeHtml(testResult.testName)}</span>
    `;

    return renderLayout(`Test: ${testResult.testName}`, body, breadcrumbs);
}

// CHANGE: Add renderTestingPage function for E2E testing UI
// WHY: Need a user interface to manage system prompts and run tests
// REF: E2E testing system implementation
function renderTestingPage() {
    const body = `
      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">System Prompt Editor</h2>
        <div class="mb-4">
          <label class="block text-xs text-gray-500 mb-1">Current Version</label>
          <select id="promptVersion" class="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2">
            <option value="current">Loading...</option>
          </select>
        </div>
        <div class="mb-4">
          <label class="block text-xs text-gray-500 mb-1">System Prompt</label>
          <textarea id="systemPrompt" rows="15" class="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono" placeholder="Loading..."></textarea>
        </div>
        <div class="mb-4">
          <label class="block text-xs text-gray-500 mb-1">Description (optional)</label>
          <input id="promptDescription" type="text" class="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="What did you change?" />
        </div>
        <div class="flex gap-2">
          <button id="savePrompt" class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">Save Prompt</button>
          <button id="saveAndTest" class="bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium">Save & Run Tests</button>
        </div>
      </section>

      <section class="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 class="text-lg font-semibold mb-4">Test Dashboard</h2>
        <div class="mb-4">
          <button id="runTests" class="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium">🧪 Run All Tests</button>
        </div>
        <div id="testResults" class="hidden">
          <div class="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
            <div class="text-sm font-semibold mb-2">Test Summary</div>
            <div class="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span class="text-gray-500">Total:</span>
                <span id="testTotal" class="font-semibold ml-1">0</span>
              </div>
              <div>
                <span class="text-gray-500">Passed:</span>
                <span id="testPassed" class="font-semibold ml-1 text-green-600">0</span>
              </div>
              <div>
                <span class="text-gray-500">Failed:</span>
                <span id="testFailed" class="font-semibold ml-1 text-red-600">0</span>
              </div>
            </div>
            <div class="mt-2">
              <span class="text-gray-500 text-sm">Average Score:</span>
              <span id="testAvgScore" class="font-semibold ml-1">0%</span>
            </div>
          </div>
          <div id="testDetails" class="space-y-3"></div>
        </div>
        <div id="testLoading" class="hidden text-sm text-gray-500">Running tests...</div>
      </section>

      <section class="bg-white border border-gray-200 rounded-lg p-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-semibold">Test History</h2>
          <button id="clearHistory" class="bg-red-600 text-white rounded px-3 py-1 text-sm font-medium hover:bg-red-700">🗑️ Очистить историю</button>
        </div>
        <div id="testHistory">
          <div class="text-sm text-gray-500">Loading history...</div>
        </div>
      </section>

      <script>
        // Load system prompt on page load
        async function loadSystemPrompt() {
          try {
            const res = await fetch('/api/system-prompt');
            const data = await res.json();
            if (data.success) {
              document.getElementById('systemPrompt').value = data.current.prompt;

              // Load version history
              const select = document.getElementById('promptVersion');
              select.innerHTML = '<option value="current">Current (v' + data.current.version + ')</option>';
              data.history.forEach(v => {
                const option = document.createElement('option');
                option.value = v.version;
                option.textContent = 'v' + v.version + ' - ' + (v.description || 'No description') + ' (' + new Date(v.updated_at).toLocaleString() + ')';
                select.appendChild(option);
              });
            }
          } catch (error) {
            console.error('Failed to load system prompt:', error);
            document.getElementById('systemPrompt').value = 'Error loading prompt';
          }
        }

        // Load test history
        async function loadTestHistory() {
          try {
            const res = await fetch('/api/test-history');
            const data = await res.json();
            if (data.success && data.history.length > 0) {
              const html = data.history.map(run => {
                const passRate = ((run.passed / run.total) * 100).toFixed(0);
                const statusColor = passRate >= 70 ? 'text-green-600' : 'text-red-600';
                const testsHtml = run.results.map(r => {
                  const testUrl = \`${BASE_PATH}/testing/\${encodeURIComponent(run.timestamp)}/\${encodeURIComponent(r.testId)}\`;
                  const icon = r.passed ? '✅' : '❌';
                  return \`<a href="\${testUrl}" class="text-xs text-blue-600 hover:underline">\${icon} \${r.testName} (\${r.score}%)</a>\`;
                }).join(' | ');
                return \`
                  <div class="border border-gray-200 rounded-lg p-3 mb-2">
                    <div class="flex justify-between items-start mb-2">
                      <div>
                        <div class="text-sm font-semibold">
                          <span class="\${statusColor}">\${run.passed}/\${run.total} passed</span>
                          <span class="text-gray-500 ml-2">Score: \${run.avgScore}%</span>
                        </div>
                        <div class="text-xs text-gray-500">\${new Date(run.timestamp).toLocaleString()}</div>
                      </div>
                    </div>
                    <div class="text-xs mt-2">\${testsHtml}</div>
                  </div>
                \`;
              }).join('');
              document.getElementById('testHistory').innerHTML = html;
            } else {
              document.getElementById('testHistory').innerHTML = '<div class="text-sm text-gray-500">No test runs yet</div>';
            }
          } catch (error) {
            console.error('Failed to load test history:', error);
            document.getElementById('testHistory').innerHTML = '<div class="text-sm text-red-600">Error loading history</div>';
          }
        }

        // Save prompt
        document.getElementById('savePrompt').addEventListener('click', async () => {
          const prompt = document.getElementById('systemPrompt').value;
          const description = document.getElementById('promptDescription').value;

          try {
            const res = await fetch('/api/system-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, description })
            });
            const data = await res.json();
            if (data.success) {
              alert('System prompt saved successfully!');
              document.getElementById('promptDescription').value = '';
              loadSystemPrompt();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Failed to save prompt: ' + error.message);
          }
        });

        // Save and test
        document.getElementById('saveAndTest').addEventListener('click', async () => {
          const prompt = document.getElementById('systemPrompt').value;
          const description = document.getElementById('promptDescription').value;

          try {
            const res = await fetch('/api/system-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, description, runTests: true })
            });
            const data = await res.json();
            if (data.success) {
              alert('Prompt saved and tests completed!');
              document.getElementById('promptDescription').value = '';
              loadSystemPrompt();
              displayTestResults(data.testResults);
              loadTestHistory();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Failed to save and test: ' + error.message);
          }
        });

        // Run tests
        document.getElementById('runTests').addEventListener('click', async () => {
          document.getElementById('testLoading').classList.remove('hidden');
          document.getElementById('testResults').classList.add('hidden');

          try {
            const res = await fetch('/api/run-tests', { method: 'POST' });
            const data = await res.json();
            document.getElementById('testLoading').classList.add('hidden');

            if (data.success) {
              displayTestResults(data);
              loadTestHistory();
            } else {
              alert('Error running tests: ' + data.error);
            }
          } catch (error) {
            document.getElementById('testLoading').classList.add('hidden');
            alert('Failed to run tests: ' + error.message);
          }
        });

        // Display test results
        function displayTestResults(data) {
          document.getElementById('testResults').classList.remove('hidden');
          document.getElementById('testTotal').textContent = data.summary.total;
          document.getElementById('testPassed').textContent = data.summary.passed;
          document.getElementById('testFailed').textContent = data.summary.failed;
          document.getElementById('testAvgScore').textContent = data.summary.avgScore + '%';

          const detailsHtml = data.results.map(r => {
            const statusColor = r.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
            const statusIcon = r.passed ? '✅' : '❌';
            const testUrl = \`${BASE_PATH}/testing/\${encodeURIComponent(data.timestamp)}/\${encodeURIComponent(r.testId)}\`;
            return \`
              <div class="border rounded-lg p-3 \${statusColor}">
                <div class="flex justify-between items-start mb-2">
                  <div class="font-semibold text-sm">\${statusIcon} \${r.testName}</div>
                  <div class="text-sm font-semibold">\${r.score}%</div>
                </div>
                <div class="text-xs text-gray-600 mb-2">Category: \${r.category}</div>
                <div class="text-xs text-gray-700 mb-2">\${r.evaluation.feedback || 'No feedback'}</div>
                <a href="\${testUrl}" class="text-xs text-blue-600 hover:underline">View details →</a>
              </div>
            \`;
          }).join('');
          document.getElementById('testDetails').innerHTML = detailsHtml;
        }

        // Change version
        document.getElementById('promptVersion').addEventListener('change', async (e) => {
          if (e.target.value === 'current') {
            loadSystemPrompt();
            return;
          }

          try {
            const res = await fetch('/api/system-prompt');
            const data = await res.json();
            if (data.success) {
              const version = data.history.find(v => v.version === e.target.value);
              if (version) {
                document.getElementById('systemPrompt').value = version.prompt;
              }
            }
          } catch (error) {
            console.error('Failed to load version:', error);
          }
        });

        // Clear test history
        document.getElementById('clearHistory').addEventListener('click', async () => {
          if (!confirm('Вы уверены? Это удалит всю историю запусков тестов.')) {
            return;
          }

          try {
            const res = await fetch('/api/test-history', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              alert('История тестов очищена');
              loadTestHistory();
            } else {
              alert('Ошибка: ' + data.error);
            }
          } catch (error) {
            alert('Ошибка очистки истории: ' + error.message);
          }
        });

        // Initialize
        loadSystemPrompt();
        loadTestHistory();
      </script>
    `;

    return renderLayout('E2E Testing', body);
}

function listChatFiles(botDataDir) {
    if (!fs.existsSync(botDataDir)) {
        return [];
    }
    // CHANGE: Show only chat logs (chat_*.json) in bot dialog list.
    // WHY: Admin needs message counts for chat dialogs, not profile files.
    // QUOTE(ТЗ): "а тут пиши сколько сообщений в чате"
    // REF: user request 2026-01-28
    const files = fs.readdirSync(botDataDir).filter(file => file.startsWith('chat_') && file.endsWith('.json'));
    return files.map(file => {
        const filePath = path.join(botDataDir, file);
        const stats = fs.statSync(filePath);
        const displayName = file.startsWith('chat_')
            ? file.slice('chat_'.length, -'.json'.length)
            : file.slice(0, -'.json'.length);
        // CHANGE: Include per-chat message counts in bot dialog list.
        // WHY: Admin needs to see how many messages are in each chat.
        // QUOTE(ТЗ): "а тут пиши сколько сообщений в чате"
        // REF: user request 2026-01-28
        const chatData = readJsonFile(filePath);
        const messageCount = Array.isArray(chatData) ? chatData.length : 'invalid';
        return {
            fileName: file,
            displayName,
            modifiedAt: stats.mtime.toISOString(),
            messageCount
        };
    }).sort((a, b) => {
        const aTime = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
        const bTime = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
        return bTime - aTime;
    });
}

const server = http.createServer(async (req, res) => {
    if (!isAllowedIp(req)) {
        sendText(res, 403, ACCESS_DENIED_MESSAGE);
        return;
    }

    if (!req.url) {
        sendText(res, 400, 'Bad request');
        return;
    }

    const url = new URL(req.url, `http://localhost:${adminPort}`);
    const pathname = url.pathname;

    if (pathname === `${BASE_PATH}/ai-settings` && req.method === 'POST') {
        try {
            const formData = await parseFormBody(req);
            const promptModel = typeof formData.prompt_model === 'string' ? formData.prompt_model.trim() : '';
            const botModel = typeof formData.bot_model === 'string' ? formData.bot_model.trim() : '';
            if (!promptModel || !botModel) {
                sendText(res, 400, 'prompt_model and bot_model are required');
                return;
            }
            writeAiSettings({
                prompt_model: promptModel,
                bot_model: botModel,
                provider: 'hydra'
            });
            setAiNotice('success', 'AI models updated.');
            redirect(res, `${BASE_PATH}/integrations`);
        } catch (error) {
            setAiNotice('error', `Failed to update AI settings: ${error.message}`);
            redirect(res, `${BASE_PATH}/integrations`);
        }
        return;
    }

    if (pathname === `${BASE_PATH}/ai-redeem` && req.method === 'POST') {
        try {
            const formData = await parseFormBody(req);
            const code = typeof formData.code === 'string' ? formData.code.trim() : '';
            if (!code) {
                sendText(res, 400, 'code is required');
                return;
            }
            const result = await redeemHydraCode(code);
            const amount = result && result.amount_added ? ` Added: ${result.amount_added}.` : '';
            const balance = result && result.new_balance ? ` Balance: ${result.new_balance}.` : '';
            setAiNotice('success', `Hydra code activated.${amount}${balance}`);
            redirect(res, `${BASE_PATH}/integrations`);
        } catch (error) {
            setAiNotice('error', `Hydra redeem failed: ${error.message}`);
            redirect(res, `${BASE_PATH}/integrations`);
        }
        return;
    }

    if (pathname === `${BASE_PATH}/ai-test` && req.method === 'POST') {
        try {
            const aiSettings = readAiSettings();
            const model = aiSettings ? (aiSettings.prompt_model || aiSettings.bot_model) : null;
            const result = await testHydraApi(model);
            const snippet = result.reply ? ` Reply: "${result.reply.substring(0, 120)}"` : '';
            setAiNotice('success', `Hydra API OK (${result.model}) in ${result.latencyMs}ms.${snippet}`);
            redirect(res, `${BASE_PATH}/integrations`);
        } catch (error) {
            setAiNotice('error', `Hydra API test failed: ${error.message}`);
            redirect(res, `${BASE_PATH}/integrations`);
        }
        return;
    }

    if (pathname === `${BASE_PATH}/ai-key-check` && req.method === 'POST') {
        try {
            const formData = await parseFormBody(req);
            const submittedApiKey = typeof formData.api_key === 'string' ? formData.api_key.trim() : '';
            const envConfig = getHydraConfig();
            const apiKeyToVerify = submittedApiKey || envConfig.apiKey;
            const source = submittedApiKey ? 'submitted key' : '.env HYDRA_API_KEY';
            const result = await verifyHydraApiKey(apiKeyToVerify);
            const balance = result.profile && typeof result.profile.balance === 'number'
                ? ` Balance: $${result.profile.balance.toFixed(2)}.`
                : '';
            setAiNotice('success', `Hydra key is valid (${source}) in ${result.latencyMs}ms.${balance}`);
            redirect(res, `${BASE_PATH}/integrations`);
        } catch (error) {
            setAiNotice('error', `Hydra API key check failed: ${error.message}`);
            redirect(res, `${BASE_PATH}/integrations`);
        }
        return;
    }

    if (pathname === '/' || pathname === '') {
        redirect(res, BASE_PATH);
        return;
    }

    if (pathname === `${STATIC_PATH}/tailwind.min.css`) {
        res.writeHead(200, {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'public, max-age=3600'
        });
        res.end(tailwindCss);
        return;
    }

    if (pathname === BASE_PATH) {
        const conversations = loadAllConversationsForAdmin();
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        if (conversations === null || typeof conversations !== 'object' || Array.isArray(conversations)) {
            throw new Error('conversations must be an object');
        }
        const { models, error } = await fetchHydraModels();
        const { profile, error: profileError } = await fetchHydraProfile();
        const aiNotice = getAiNotice();
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const sortBy = urlObj.searchParams.get('sortBy') || 'lastActivity';
        sendHtml(res, 200, renderAuthorIndex(conversations, bots, models, error, profile, profileError, aiNotice, sortBy));
        return;
    }

    // CHANGE: Add route to display all active bots
    // WHY: User wants to see all active bots in one place
    // REF: User request - "в админке на отдельном роуте покажи всех активных ботов"
    if (pathname === `${BASE_PATH}/active-bots` && req.method === 'GET') {
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        const aiNotice = getAiNotice();
        sendHtml(res, 200, renderAllBotsPage(bots, aiNotice));
        return;
    }

    if (pathname === `${BASE_PATH}/dashboard` && req.method === 'GET') {
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        sendHtml(res, 200, renderDashboardPage(bots));
        return;
    }

    if (pathname === `${BASE_PATH}/integrations` && req.method === 'GET') {
        const { models, error } = await fetchHydraModels();
        const { profile, error: profileError } = await fetchHydraProfile();
        const aiNotice = getAiNotice();
        sendHtml(res, 200, renderIntegrationsPage(models, error, profile, profileError, aiNotice));
        return;
    }

    // CHANGE: Hydra logs routes - view all logs and individual log details
    // WHY: User requested full tracking of all Hydra API requests with feedback
    // REF: user request 2026-02-11
    if (pathname === `${BASE_PATH}/hydra-logs` && req.method === 'GET') {
        const aiNotice = getAiNotice();
        sendHtml(res, 200, renderHydraLogsPage(aiNotice));
        return;
    }

    const hydraLogDetailMatch = pathname.match(new RegExp(`^${BASE_PATH}/hydra-logs/([^/]+)$`));
    if (hydraLogDetailMatch && req.method === 'GET') {
        const logId = decodeURIComponent(hydraLogDetailMatch[1]);
        const aiNotice = getAiNotice();
        sendHtml(res, 200, renderHydraLogDetailPage(logId, aiNotice));
        return;
    }

    const hydraLogFeedbackMatch = pathname.match(new RegExp(`^${BASE_PATH}/hydra-logs/([^/]+)/feedback$`));
    if (hydraLogFeedbackMatch && req.method === 'POST') {
        const logId = decodeURIComponent(hydraLogFeedbackMatch[1]);
        try {
            const formData = await parseFormBody(req);
            const comment = typeof formData.comment === 'string' ? formData.comment.trim() : '';
            if (!comment) {
                setAiNotice('error', 'Feedback comment is required');
                redirect(res, `${BASE_PATH}/hydra-logs/${encodeURIComponent(logId)}`);
                return;
            }
            const success = addLogFeedback(logId, comment);
            if (success) {
                setAiNotice('success', 'Feedback saved successfully');
            } else {
                setAiNotice('error', 'Log not found');
            }
            redirect(res, `${BASE_PATH}/hydra-logs/${encodeURIComponent(logId)}`);
        } catch (error) {
            setAiNotice('error', `Failed to save feedback: ${error.message}`);
            redirect(res, `${BASE_PATH}/hydra-logs/${encodeURIComponent(logId)}`);
        }
        return;
    }

    if (pathname === `${BASE_PATH}/crm` && req.method === 'GET') {
        const conversations = loadAllConversationsForAdmin();
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        const crmState = readCrmState();
        let leads = buildCrmLeads(conversations, bots, crmState);

        // CHANGE: Parse query parameters for filtering
        // WHY: Allow filtering CRM leads by status, qualification, and search term
        // REF: user request - "тут фильтры выведи"
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const filterStatus = url.searchParams.get('status') || '';
        const filterQualification = url.searchParams.get('qualification') || '';
        const filterSearch = url.searchParams.get('search') || '';
        const filterHasUsername = url.searchParams.get('has_username') === '1';

        // Apply filters
        if (filterStatus && CRM_STATUS_ORDER.includes(filterStatus)) {
            leads = leads.filter(lead => lead.crmStatus === filterStatus);
        }

        if (filterQualification) {
            if (filterQualification === 'not_qualified') {
                leads = leads.filter(lead => !lead.qualification);
            } else if (['commercial', 'non_commercial', 'unclear'].includes(filterQualification)) {
                leads = leads.filter(lead => lead.qualification && lead.qualification.verdict === filterQualification);
            }
        }

        if (filterSearch) {
            const searchLower = filterSearch.toLowerCase();
            leads = leads.filter(lead =>
                (lead.userId && String(lead.userId).includes(searchLower)) ||
                (lead.username && lead.username.toLowerCase().includes(searchLower)) ||
                (lead.name && lead.name.toLowerCase().includes(searchLower)) ||
                (lead.firstMessage && lead.firstMessage.toLowerCase().includes(searchLower))
            );
        }

        // CHANGE: Filter by username presence
        // WHY: Allow showing only leads with Telegram username
        // REF: user request - "в фильтр добавь только тех у кого есть никнейм"
        if (filterHasUsername) {
            leads = leads.filter(lead => lead.username && lead.username.trim() !== '');
        }

        // CHANGE: Sort by last sent message from us
        // WHY: Allow sorting CRM leads by when we last contacted them
        // REF: user request 2026-02-20 "добавь тут сотрировку по последнему отрправленному сообщению от нас"
        const sortBy = url.searchParams.get('sort') || '';
        if (sortBy === 'last_sent_desc') {
            leads.sort((a, b) => (Date.parse(b.lastSentAt || '') || 0) - (Date.parse(a.lastSentAt || '') || 0));
        } else if (sortBy === 'last_sent_asc') {
            leads.sort((a, b) => {
                const aTime = Date.parse(a.lastSentAt || '') || 0;
                const bTime = Date.parse(b.lastSentAt || '') || 0;
                if (!aTime && !bTime) return 0;
                if (!aTime) return 1;
                if (!bTime) return -1;
                return aTime - bTime;
            });
        }

        const aiNotice = getAiNotice();
        const filters = { status: filterStatus, qualification: filterQualification, search: filterSearch, hasUsername: filterHasUsername, sort: sortBy };
        sendHtml(res, 200, renderCrmPage(leads, aiNotice, filters));
        return;
    }

    if (pathname === `${BASE_PATH}/crm/lead/update` && req.method === 'POST') {
        let userId = '';
        let returnTo = '';
        try {
            const formData = await parseFormBody(req);
            userId = typeof formData.user_id === 'string' ? formData.user_id.trim() : '';
            returnTo = typeof formData.return_to === 'string' ? formData.return_to : '';
            if (!userId) {
                sendText(res, 400, 'user_id is required');
                return;
            }
            const crmState = readCrmState();
            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            crmState[userId] = {
                ...current,
                status: normalizeCrmStatus(formData.status),
                note: typeof formData.note === 'string' ? formData.note.trim() : '',
                nextFollowupAt: typeof formData.next_followup_at === 'string' ? formData.next_followup_at.trim() : '',
                updatedAt: new Date().toISOString()
            };
            writeCrmState(crmState);
            setAiNotice('success', `Lead ${userId} updated.`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        } catch (error) {
            setAiNotice('error', `Failed to update lead: ${error.message}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        }
        return;
    }

    // CHANGE: Add lead qualification endpoint - LLM analysis of full conversation
    // WHY: Determine if lead is commercial or non-commercial (e.g. CS GO stores)
    // REF: user request 2026-02-11
    if (pathname === `${BASE_PATH}/crm/qualify` && req.method === 'POST') {
        let userId = '';
        let returnTo = '';
        try {
            const formData = await parseFormBody(req);
            userId = typeof formData.user_id === 'string' ? formData.user_id.trim() : '';
            returnTo = typeof formData.return_to === 'string' ? formData.return_to : '';
            if (!userId) {
                sendText(res, 400, 'user_id is required');
                return;
            }
            const convo = loadAuthorConversation(userId);
            if (!convo) {
                throw new Error(`Conversation not found for user ${userId}`);
            }
            const { messages } = getMessagesInfo(convo, `Conversation for user ${userId}`);
            if (!messages || !messages.length) {
                throw new Error(`No messages found for user ${userId}`);
            }
            const qualification = await generateQualificationResult(userId, messages);
            const crmState = readCrmState();
            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            crmState[userId] = {
                ...current,
                qualification,
                updatedAt: new Date().toISOString()
            };
            writeCrmState(crmState);
            setAiNotice('success', `Квалификация для ${userId}: ${qualification.verdict} — ${qualification.reason}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        } catch (error) {
            setAiNotice('error', `Ошибка квалификации ${userId}: ${error.message}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        }
        return;
    }

    if (pathname === `${BASE_PATH}/crm/followup/generate` && req.method === 'POST') {
        let userId = '';
        let returnTo = '';
        try {
            const formData = await parseFormBody(req);
            userId = typeof formData.user_id === 'string' ? formData.user_id.trim() : '';
            returnTo = typeof formData.return_to === 'string' ? formData.return_to : '';
            if (!userId) {
                sendText(res, 400, 'user_id is required');
                return;
            }
            const conversations = loadAllConversationsForAdmin();
            const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
            const crmState = readCrmState();
            const leads = buildCrmLeads(conversations, bots, crmState);
            const lead = leads.find(item => item.userId === userId);
            if (!lead) {
                throw new Error(`Lead ${userId} not found`);
            }
            const followupText = await generateCrmFollowupText(lead);
            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            crmState[userId] = {
                ...current,
                status: 'followup_ready',
                followupText,
                lastGeneratedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            writeCrmState(crmState);
            setAiNotice('success', `Follow-up generated for ${userId}.`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        } catch (error) {
            setAiNotice('error', `Failed to generate follow-up: ${error.message}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        }
        return;
    }

    if (pathname === `${BASE_PATH}/crm/followup/send` && req.method === 'POST') {
        let userId = '';
        let returnTo = '';
        try {
            const formData = await parseFormBody(req);
            userId = typeof formData.user_id === 'string' ? formData.user_id.trim() : '';
            returnTo = typeof formData.return_to === 'string' ? formData.return_to : '';
            const followupText = enforceCrmFollowupPolicy(typeof formData.followup_text === 'string' ? formData.followup_text.trim() : '');
            if (!userId || !followupText) {
                sendText(res, 400, 'user_id and followup_text are required');
                return;
            }

            // CHANGE: Add detailed logging for follow-up send pipeline
            // WHY: User reported "nothing happened" - need visibility into the process
            // REF: user request - "когда отправили фоловап ничего не произошло, надо менять статус по пайплайну и чтоб был лог"
            console.log(`[CRM Follow-up] Starting send for user ${userId}`);

            const conversations = loadAllConversationsForAdmin();
            const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
            const crmState = readCrmState();
            const leads = buildCrmLeads(conversations, bots, crmState);
            const lead = leads.find(item => item.userId === userId);
            if (!lead) {
                throw new Error(`Lead ${userId} not found`);
            }
            const hasKnownUsername = Boolean(lead.username);
            const recipient = hasKnownUsername ? lead.username : userId;

            // CHANGE: Block duplicate personal follow-ups
            // WHY: Personal account follow-ups must be sent at most once per user to avoid spam/ban
            const existingCrm = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            if (hasKnownUsername && existingCrm.personalFollowupSentAt) {
                const sentDate = new Date(existingCrm.personalFollowupSentAt);
                const formatted = `${sentDate.toLocaleDateString('ru-RU')} ${sentDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
                throw new Error(`Личный follow-up уже был отправлен ${formatted}. Повторная отправка с личного аккаунта заблокирована.`);
            }

            console.log(`[CRM Follow-up] Sending to ${recipient}...`);

            const sendResult = await sendCrmFollowup(recipient, followupText, { viaBananzaBot: !hasKnownUsername });
            console.log(`[CRM Follow-up] Message sent successfully to ${recipient}`);

            // CHANGE: Auto-advance status from followup_ready to contacted after sending
            // WHY: Status pipeline should progress automatically after successful send
            const oldStatus = normalizeCrmStatus((crmState[userId] && crmState[userId].status) || '');
            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            const nowIso = new Date().toISOString();
            crmState[userId] = {
                ...current,
                status: 'contacted',
                followupText,
                lastRecipient: recipient,
                lastDeliveryVia: sendResult.via,
                sentCount: (Number.isInteger(current.sentCount) ? current.sentCount : 0) + 1,
                lastSentAt: nowIso,
                // CHANGE: Track personal follow-up separately to prevent duplicate sends
                // WHY: Personal account follow-ups must be sent at most once per user
                ...(sendResult.via === 'personal' ? { personalFollowupSentAt: nowIso } : {}),
                folderAddedAt: sendResult.via === 'personal'
                    ? (sendResult.folderAdded ? nowIso : (current.folderAddedAt || null))
                    : (current.folderAddedAt || null),
                folderAddError: sendResult.via === 'personal'
                    ? (sendResult.folderAddError || null)
                    : null,
                updatedAt: nowIso
            };
            writeCrmState(crmState);
            console.log(`[CRM Follow-up] Status changed: ${oldStatus} → contacted`);

            appendCrmFollowupToAuthorHistory(userId, recipient, followupText, sendResult.via);
            console.log(`[CRM Follow-up] Added log entry to conversation history`);

            const dryRunSuffix = sendResult.dryRun ? ' (dry-run)' : '';
            const viaSuffix = sendResult.via === 'bananza_bot' ? ', sent from @bananza_bot' : ', sent from personal account';
            const folderSuffix = sendResult.via === 'personal'
                ? (sendResult.folderAdded ? ', added to folder "bananza"' : (sendResult.folderAddError ? `, folder add failed: ${sendResult.folderAddError}` : ''))
                : '';
            const statusChange = oldStatus !== 'contacted' ? ` Status: ${oldStatus} → contacted.` : '';
            setAiNotice('success', `✅ Follow-up sent to ${recipient}!${dryRunSuffix}${viaSuffix}${folderSuffix}${statusChange}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        } catch (error) {
            console.error(`[CRM Follow-up] Error for user ${userId}:`, error);
            setAiNotice('error', `❌ Failed to send follow-up: ${error.message}`);
            redirect(res, normalizeReturnPath(returnTo, userId));
        }
        return;
    }

    // CHANGE: Add AJAX API endpoint for follow-up send
    // WHY: User requested AJAX button with visible result instead of page reload
    // REF: user request - "результат должен быть показан и сделай тут аякс кнопку"
    if (pathname === '/api/crm/followup/send' && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
            const followupText = enforceCrmFollowupPolicy(typeof body.followup_text === 'string' ? body.followup_text.trim() : '');

            if (!userId || !followupText) {
                sendJson(res, 400, {
                    success: false,
                    error: 'user_id and followup_text are required'
                });
                return;
            }

            console.log(`[CRM Follow-up API] Starting send for user ${userId}`);

            const conversations = loadAllConversationsForAdmin();
            const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
            const crmState = readCrmState();
            const leads = buildCrmLeads(conversations, bots, crmState);
            const lead = leads.find(item => item.userId === userId);

            if (!lead) {
                sendJson(res, 404, {
                    success: false,
                    error: `Lead ${userId} not found`
                });
                return;
            }

            const hasKnownUsername = Boolean(lead.username);
            const recipient = hasKnownUsername ? lead.username : userId;

            // CHANGE: Block duplicate personal follow-ups
            // WHY: Personal account follow-ups must be sent at most once per user to avoid spam/ban
            const existingCrm = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            if (hasKnownUsername && existingCrm.personalFollowupSentAt) {
                const sentDate = new Date(existingCrm.personalFollowupSentAt);
                const formatted = `${sentDate.toLocaleDateString('ru-RU')} ${sentDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
                sendJson(res, 409, {
                    success: false,
                    error: `Личный follow-up уже был отправлен ${formatted}. Повторная отправка с личного аккаунта заблокирована.`
                });
                return;
            }

            console.log(`[CRM Follow-up API] Sending to ${recipient}...`);

            const sendResult = await sendCrmFollowup(recipient, followupText, { viaBananzaBot: !hasKnownUsername });
            console.log(`[CRM Follow-up API] Message sent successfully to ${recipient}`);

            // Auto-advance status from followup_ready to contacted
            const oldStatus = normalizeCrmStatus((crmState[userId] && crmState[userId].status) || '');
            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            const nowIso = new Date().toISOString();
            crmState[userId] = {
                ...current,
                status: 'contacted',
                followupText,
                lastRecipient: recipient,
                lastDeliveryVia: sendResult.via,
                sentCount: (Number.isInteger(current.sentCount) ? current.sentCount : 0) + 1,
                lastSentAt: nowIso,
                // CHANGE: Track personal follow-up separately to prevent duplicate sends
                // WHY: Personal account follow-ups must be sent at most once per user
                ...(sendResult.via === 'personal' ? { personalFollowupSentAt: nowIso } : {}),
                folderAddedAt: sendResult.via === 'personal'
                    ? (sendResult.folderAdded ? nowIso : (current.folderAddedAt || null))
                    : (current.folderAddedAt || null),
                folderAddError: sendResult.via === 'personal'
                    ? (sendResult.folderAddError || null)
                    : null,
                updatedAt: nowIso
            };
            writeCrmState(crmState);
            console.log(`[CRM Follow-up API] Status changed: ${oldStatus} → contacted`);

            appendCrmFollowupToAuthorHistory(userId, recipient, followupText, sendResult.via);
            console.log(`[CRM Follow-up API] Added log entry to conversation history`);

            const dryRunSuffix = sendResult.dryRun ? ' (dry-run)' : '';
            const viaSuffix = sendResult.via === 'bananza_bot' ? ', sent from @bananza_bot' : ', sent from personal account';
            const folderSuffix = sendResult.via === 'personal'
                ? (sendResult.folderAdded ? ', added to folder "bananza"' : (sendResult.folderAddError ? `, folder add failed: ${sendResult.folderAddError}` : ''))
                : '';
            const statusChange = oldStatus !== 'contacted' ? ` Status: ${oldStatus} → contacted.` : '';

            sendJson(res, 200, {
                success: true,
                message: `✅ Follow-up sent to ${recipient}!${dryRunSuffix}${viaSuffix}${folderSuffix}${statusChange}`,
                recipient,
                oldStatus,
                newStatus: 'contacted',
                sentCount: crmState[userId].sentCount,
                via: sendResult.via,
                folderAdded: sendResult.folderAdded,
                folderAddError: sendResult.folderAddError
            });
        } catch (error) {
            console.error(`[CRM Follow-up API] Error:`, error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    // CHANGE: Add AJAX API endpoint for follow-up generation
    // WHY: User requested AJAX button for generate as well
    // REF: user request - "Generate AI follow-up тоже сделай"
    if (pathname === '/api/crm/followup/generate' && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';

            if (!userId) {
                sendJson(res, 400, {
                    success: false,
                    error: 'user_id is required'
                });
                return;
            }

            console.log(`[CRM Follow-up API] Starting generation for user ${userId}`);

            const conversations = loadAllConversationsForAdmin();
            const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
            const crmState = readCrmState();
            const leads = buildCrmLeads(conversations, bots, crmState);
            const lead = leads.find(item => item.userId === userId);

            if (!lead) {
                sendJson(res, 404, {
                    success: false,
                    error: `Lead ${userId} not found`
                });
                return;
            }

            const followupText = await generateCrmFollowupText(lead);
            console.log(`[CRM Follow-up API] Generated text for ${userId}: ${followupText.substring(0, 50)}...`);

            const current = crmState[userId] && typeof crmState[userId] === 'object' ? crmState[userId] : {};
            crmState[userId] = {
                ...current,
                status: 'followup_ready',
                followupText,
                lastGeneratedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            writeCrmState(crmState);

            sendJson(res, 200, {
                success: true,
                followupText,
                message: `✨ Follow-up generated for ${userId}`
            });
        } catch (error) {
            console.error(`[CRM Follow-up API] Generation error:`, error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    if (pathname === `${BASE_PATH}/noxon` || pathname === `${BASE_PATH}/noxon/`) {
        const leads = readJsonFileOrDefault(NOXON_LEADS_PATH, []);
        const messages = readJsonFileOrDefault(NOXON_MESSAGE_HISTORY_PATH, []);

        const errors = [leads.error, messages.error].filter(Boolean);
        const errorBlock = errors.length
            ? `<div class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(errors.join(' · '))}</div>`
            : '';

        const body = `
          ${errorBlock}
          ${renderNoxonLeadsBody(`${BASE_PATH}/noxon`, leads.value, messages.value)}
        `;
        sendHtml(res, 200, renderLayout('Noxonbot Leads', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / Noxon`));
        return;
    }

    const noxonMessagesMatch = pathname.match(new RegExp(`^${BASE_PATH}/noxon/messages/(\\d+)$`));
    if (noxonMessagesMatch) {
        const userId = decodeURIComponent(noxonMessagesMatch[1]);
        const messages = readJsonFileOrDefault(NOXON_MESSAGE_HISTORY_PATH, []);
        const errorBlock = messages.error
            ? `<div class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(messages.error)}</div>`
            : '';
        const body = `
          ${errorBlock}
          ${renderNoxonMessagesBody(`${BASE_PATH}/noxon`, userId, messages.value)}
        `;
        sendHtml(res, 200, renderLayout(`Noxonbot Messages: ${userId}`, body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / <a class="text-blue-600" href="${BASE_PATH}/noxon">Noxon</a> / Messages`));
        return;
    }

    const noxonAuthorMatch = pathname.match(new RegExp(`^${BASE_PATH}/noxon/authors/(\\d+)$`));
    if (noxonAuthorMatch) {
        const userId = decodeURIComponent(noxonAuthorMatch[1]);
        const messages = readJsonFileOrDefault(NOXON_MESSAGE_HISTORY_PATH, []);
        const errorBlock = messages.error
            ? `<div class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(messages.error)}</div>`
            : '';
        const body = `
          ${errorBlock}
          ${renderNoxonMessagesBody(`${BASE_PATH}/noxon`, userId, messages.value)}
        `;
        sendHtml(res, 200, renderLayout(`Noxonbot Author: ${userId}`, body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / <a class="text-blue-600" href="${BASE_PATH}/noxon">Noxon</a> / Author`));
        return;
    }

    if (pathname === `${BASE_PATH}/noxon/referrals`) {
        const entries = readJsonFileOrDefault(NOXON_REFERRALS_PATH, []);
        const errorBlock = entries.error
            ? `<div class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(entries.error)}</div>`
            : '';
        const body = `
          ${errorBlock}
          ${renderNoxonReferralsBody(`${BASE_PATH}/noxon`, entries.value)}
        `;
        sendHtml(res, 200, renderLayout('Noxonbot Referrals', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / Noxon Referrals`));
        return;
    }

    if (pathname === `${BASE_PATH}/noxon/onboarding`) {
        const states = readJsonFileOrDefault(NOXON_ONBOARDING_STATES_PATH, {});
        const errorBlock = states.error
            ? `<div class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(states.error)}</div>`
            : '';
        const body = `
          ${errorBlock}
          ${renderNoxonOnboardingBody(`${BASE_PATH}/noxon`, states.value)}
        `;
        sendHtml(res, 200, renderLayout('Noxonbot Onboarding', body, `<a class="text-blue-600" href="${BASE_PATH}">Authors</a> / Noxon Onboarding`));
        return;
    }

    // CHANGE: Support tabs in author page with separate routes
    // WHY: User requested to split author page into tabs with routes
    // REF: user request - "разбей на табы внутри лида все... у каждого таба свой роут чотб работали ссылки"
    const authorMatch = pathname.match(new RegExp(`^${BASE_PATH}/authors/([^/]+)(?:/(overview|crm|messages|bots))?$`));
    if (authorMatch) {
        const userId = decodeURIComponent(authorMatch[1]);
        const activeTab = authorMatch[2] || 'overview';
        const conversations = loadAllConversationsForAdmin();
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) {
            throw new Error('conversations must be an object');
        }
        const convo = loadAuthorConversation(userId) || conversations[userId];
        if (!convo) {
            sendText(res, 404, 'Author not found');
            return;
        }
        const userBots = bots.filter(bot => String(bot.user_id) === userId);
        const botNames = userBots
            .map(bot => (bot && typeof bot.nameprompt === 'string' ? bot.nameprompt : null))
            .filter(Boolean);
        const botDirs = fs.existsSync(DATA_DIR)
            ? fs.readdirSync(DATA_DIR, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name.startsWith('bot_'))
                .map(entry => entry.name)
            : [];
        let authorProfile = findAuthorProfile(userId, botNames, botDirs);

        // CHANGE: Fallback to userInfo from conversation if no bot profile exists
        // WHY: New users don't have bot_* folders yet, but we have userInfo from /start
        // REF: User report - username missing on /admin/authors/<userId>
        if (!authorProfile && convo && typeof convo === 'object') {
            const userInfo = convo.userInfo && typeof convo.userInfo === 'object' ? convo.userInfo : null;
            if (userInfo) {
                const username = typeof userInfo.username === 'string' ? userInfo.username : null;
                const firstName = typeof userInfo.firstName === 'string' ? userInfo.firstName : null;
                const lastName = typeof userInfo.lastName === 'string' ? userInfo.lastName : null;
                const fullName = typeof userInfo.fullName === 'string' ? userInfo.fullName : null;
                const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || null;
                if (username || name) {
                    authorProfile = { username: username ? `@${username}` : null, name };
                }
            }
        }

        // Load test sessions stored by bananzatestbot: user_data/conversations/<authorId>/tests/<testerId>.json
        // Keep legacy fallback for older installs.
        let testMessages = null;
        const sessions = conversationStore.listTestSessions(userId);
        if (sessions.length) {
            // Flatten all sessions into one list to keep current UI simple.
            testMessages = sessions.flatMap(session => session.test_messages || []);
        } else if (fs.existsSync(LEGACY_CONVERSATIONS_PATH)) {
            const legacy = readLegacyConversationsIfExists();
            if (legacy && typeof legacy === 'object') {
                const legacyMatches = Object.entries(legacy)
                    .filter(([key, value]) => {
                        if (!value || typeof value !== 'object') {
                            return false;
                        }
                        return new RegExp(`^\\d+_test_${userId}$`).test(key) && Array.isArray(value.test_messages);
                    })
                    .flatMap(([, value]) => value.test_messages);
                testMessages = legacyMatches.length ? legacyMatches : null;
            }
        }

        sendHtml(res, 200, renderAuthorPage(userId, convo, userBots, authorProfile, testMessages, activeTab));
        return;
    }

    const botMatch = pathname.match(new RegExp(`^${BASE_PATH}/bots/([^/]+)$`));
    if (botMatch) {
        const botName = decodeURIComponent(botMatch[1]);
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        const botExists = bots.some(bot => bot.nameprompt === botName);
        if (!botExists) {
            sendText(res, 404, 'Bot not found');
            return;
        }
        const botDir = path.join(DATA_DIR, botName);
        const chatFiles = listChatFiles(botDir);
        sendHtml(res, 200, renderBotIndex(botName, chatFiles));
        return;
    }

    const chatMatch = pathname.match(new RegExp(`^${BASE_PATH}/bots/([^/]+)/chats/([^/]+)$`));
    if (chatMatch) {
        const botName = decodeURIComponent(chatMatch[1]);
        const fileName = decodeURIComponent(chatMatch[2]);
        const bots = assertArray(readJsonFile(BOTS_PATH), 'bots.json');
        const botExists = bots.some(bot => bot.nameprompt === botName);
        if (!botExists) {
            sendText(res, 404, 'Bot not found');
            return;
        }
        const botDir = path.join(DATA_DIR, botName);
        const safeFileName = path.basename(fileName);
        const filePath = path.join(botDir, safeFileName);
        if (!fs.existsSync(filePath)) {
            sendText(res, 404, 'Chat file not found');
            return;
        }
        const chatData = readJsonFile(filePath);
        sendHtml(res, 200, renderBotChat(botName, safeFileName, chatData));
        return;
    }

    // CHANGE: Add route for Testing page
    // WHY: Display E2E testing UI
    // REF: E2E testing system implementation
    if (pathname === `${BASE_PATH}/testing` && req.method === 'GET') {
        sendHtml(res, 200, renderTestingPage());
        return;
    }

    // CHANGE: Add route for test details page
    // WHY: Allow admin to view full conversation and checks for each test
    // REF: User request to view test details
    const testDetailsMatch = pathname.match(new RegExp(`^${BASE_PATH}/testing/([^/]+)/([^/]+)$`));
    if (testDetailsMatch && req.method === 'GET') {
        try {
            const timestamp = decodeURIComponent(testDetailsMatch[1]);
            const testId = decodeURIComponent(testDetailsMatch[2]);

            // Load test history
            const history = TestRunner.getTestHistory(20);

            // Find the specific test run
            const testRun = history.find(run => run.timestamp === timestamp);
            if (!testRun) {
                sendText(res, 404, 'Test run not found');
                return;
            }

            // Find the specific test result
            const testResult = testRun.results.find(r => r.testId === testId);
            if (!testResult) {
                sendText(res, 404, 'Test result not found');
                return;
            }

            sendHtml(res, 200, renderTestDetailsPage(testRun, testResult));
        } catch (error) {
            console.error('[Admin] Error rendering test details:', error);
            sendText(res, 500, `Error: ${error.message}`);
        }
        return;
    }

    // CHANGE: Add API endpoint to run all E2E tests
    // WHY: Allow admin to trigger test execution via API
    // REF: E2E testing system implementation
    if (pathname === '/api/run-tests' && req.method === 'POST') {
        try {
            console.log('[Admin API] Running E2E tests...');

            // Load system prompt
            const systemPrompt = await promptManager.loadSystemPrompt();

            // Get test model from ai_settings.json
            const aiSettings = readAiSettings();
            const testModel = aiSettings.test_model || aiSettings.bot_model;

            // Run tests
            const results = await TestRunner.runAllTests(systemPrompt, testModel);

            // Update prompt with test results
            await promptManager.updateTestResults(results);

            sendJson(res, 200, {
                success: true,
                timestamp: results.timestamp,
                summary: {
                    total: results.total,
                    passed: results.passed,
                    failed: results.failed,
                    avgScore: results.avgScore
                },
                results: results.results
            });
        } catch (error) {
            console.error('[Admin API] Error running tests:', error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    // CHANGE: Add API endpoint to get test history
    // WHY: Allow admin to view past test runs
    // REF: E2E testing system implementation
    if (pathname === '/api/test-history' && req.method === 'GET') {
        try {
            const history = TestRunner.getTestHistory(10);
            sendJson(res, 200, {
                success: true,
                history: history
            });
        } catch (error) {
            console.error('[Admin API] Error getting test history:', error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    // CHANGE: Add API endpoint to clear test history
    // WHY: Allow admin to clear old test runs that clutter the view
    // REF: User request to add clear history button
    if (pathname === '/api/test-history' && req.method === 'DELETE') {
        try {
            const historyPath = path.join(__dirname, 'test_history.json');

            // Write empty array to clear history
            fs.writeFileSync(historyPath, JSON.stringify([], null, 2));

            console.log('[Admin API] Test history cleared');
            sendJson(res, 200, {
                success: true,
                message: 'Test history cleared successfully'
            });
        } catch (error) {
            console.error('[Admin API] Error clearing test history:', error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    // CHANGE: Add API endpoint to save system prompt
    // WHY: Allow admin to update system prompt via API
    // REF: E2E testing system implementation
    if (pathname === '/api/system-prompt' && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const prompt = body.prompt;
            const description = body.description || 'Updated via admin panel';
            const runTests = body.runTests === true;

            if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
                sendJson(res, 400, {
                    success: false,
                    error: 'prompt is required and must be a non-empty string'
                });
                return;
            }

            // Save prompt
            await promptManager.saveSystemPrompt(prompt, description);

            // Optionally run tests
            let testResults = null;
            if (runTests) {
                const aiSettings = readAiSettings();
                const testModel = aiSettings.test_model || aiSettings.bot_model;
                testResults = await TestRunner.runAllTests(prompt, testModel);
                await promptManager.updateTestResults(testResults);
            }

            sendJson(res, 200, {
                success: true,
                message: 'System prompt saved successfully',
                testResults: testResults
            });
        } catch (error) {
            console.error('[Admin API] Error saving system prompt:', error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    // CHANGE: Add API endpoint to get system prompt
    // WHY: Allow admin to retrieve current prompt and history
    // REF: E2E testing system implementation
    if (pathname === '/api/system-prompt' && req.method === 'GET') {
        try {
            const current = await promptManager.loadSystemPrompt();
            const info = await promptManager.getCurrentPromptInfo();
            const history = await promptManager.getPromptHistory(10);

            sendJson(res, 200, {
                success: true,
                current: {
                    prompt: current,
                    version: info.version,
                    updatedAt: info.updated_at,
                    description: info.description
                },
                history: history
            });
        } catch (error) {
            console.error('[Admin API] Error getting system prompt:', error);
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
        return;
    }

    sendText(res, 404, 'Not found');
});

server.listen(adminPort, '0.0.0.0', () => {
    console.log(`[Admin] Bananzabot admin listening on ${adminPort}`);
});
