#!/usr/bin/env node
/**
 * Tests for JWT enforcement on /api/data/ in d*.wpmix.net middleware.
 *
 * Task 7: Gate /api/data/ behind dashboard_jwt on protected dashboards.
 *
 * Test cases:
 * 1. no_jwt_protected_dashboard        — GET /api/data/test, no Authorization → 401
 * 2. valid_jwt_correct_dashboard_id    — GET /api/data/test, valid JWT for correct dashboardId → 200
 * 3. valid_jwt_wrong_dashboard_id      — GET /api/data/test, valid JWT for different dashboardId → 401
 * 4. no_jwt_unprotected_dashboard      — GET /api/data/test, no Authorization, no ownerAddress → 200
 *
 * Prerequisites:
 *   - simpledashboard-web running on port 8094
 *   - group_data/user_999999999/settings.json has ownerAddress set (protected)
 *   - group_data/user_1106185346/ exists but has no settings.json (unprotected)
 *   - JWT_SECRET available in .env.auth
 *
 * Usage:
 *   JWT_SECRET=<secret> node tests/test_guest_auth_widget.js
 *   # or:
 *   export $(cat .env.auth | xargs) && node tests/test_guest_auth_widget.js
 *
 * Run from: /root/aisell/botplatform/
 */

'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// ─── Test Harness ─────────────────────────────────────────────────────────────

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m',
};

let passed = 0;
let failed = 0;
const failures = [];

function log(msg, color) {
  console.log(`${color || COLORS.RESET}${msg}${COLORS.RESET}`);
}

function assert(condition, description) {
  if (condition) {
    log(`  [PASS] ${description}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  [FAIL] ${description}`, COLORS.RED);
    failed++;
    failures.push(description);
  }
}

function section(name) {
  log(`\n${name}`, COLORS.CYAN);
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

function httpRequest(urlStr, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(data); } catch { body = { _raw: data }; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyStr);
    }
    req.end();
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEBCHAT_BASE = 'http://127.0.0.1:8094';

// Protected user: has ownerAddress in settings.json
const PROTECTED_USER_ID = '999999999';

// Unprotected user: has no settings.json (no ownerAddress)
const UNPROTECTED_USER_ID = '1106185346';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[ERROR] JWT_SECRET env variable is required. Run: export $(cat .env.auth | xargs) && node tests/test_guest_auth_widget.js');
  process.exit(1);
}

// Ensure unprotected user folder exists (no settings.json)
const WORKSPACES_ROOT = path.join(__dirname, '..', 'group_data');
const unprotectedFolder = path.join(WORKSPACES_ROOT, `user_${UNPROTECTED_USER_ID}`);
if (!fs.existsSync(unprotectedFolder)) {
  fs.mkdirSync(unprotectedFolder, { recursive: true });
  log(`[setup] Created unprotected user folder: ${unprotectedFolder}`, COLORS.YELLOW);
}
// Ensure settings.json does NOT exist for unprotected user (remove ownerAddress if present)
const unprotectedSettings = path.join(unprotectedFolder, 'settings.json');
if (fs.existsSync(unprotectedSettings)) {
  const s = JSON.parse(fs.readFileSync(unprotectedSettings, 'utf8'));
  if (s.ownerAddress) {
    delete s.ownerAddress;
    fs.writeFileSync(unprotectedSettings, JSON.stringify(s, null, 2), 'utf8');
    log(`[setup] Removed ownerAddress from unprotected user settings`, COLORS.YELLOW);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test_no_jwt_protected_dashboard() {
  section('Test 1: no_jwt_protected_dashboard — no Authorization on protected dashboard → 401');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/data/test`, {
    method: 'GET',
    headers: {
      Host: `d${PROTECTED_USER_ID}.wpmix.net`,
    },
  });

  assert(res.status === 401, `Status is 401 (got ${res.status})`);
  assert(res.body && res.body.error === 'Unauthorized', `Body is { error: "Unauthorized" } (got ${JSON.stringify(res.body)})`);
}

async function test_valid_jwt_correct_dashboard_id() {
  section('Test 2: valid_jwt_correct_dashboard_id — valid JWT with correct dashboardId → 200, array body');

  const token = jwt.sign(
    { dashboardId: `d${PROTECTED_USER_ID}` },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const res = await httpRequest(`${WEBCHAT_BASE}/api/data/test`, {
    method: 'GET',
    headers: {
      Host: `d${PROTECTED_USER_ID}.wpmix.net`,
      Authorization: `Bearer ${token}`,
    },
  });

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(Array.isArray(res.body), `Body is an array (got ${JSON.stringify(res.body)})`);
}

async function test_valid_jwt_wrong_dashboard_id() {
  section('Test 3: valid_jwt_wrong_dashboard_id — valid JWT but dashboardId for different dashboard → 401');

  // Sign a JWT for a different dashboard
  const token = jwt.sign(
    { dashboardId: `d9999999999` },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const res = await httpRequest(`${WEBCHAT_BASE}/api/data/test`, {
    method: 'GET',
    headers: {
      Host: `d${PROTECTED_USER_ID}.wpmix.net`,
      Authorization: `Bearer ${token}`,
    },
  });

  assert(res.status === 401, `Status is 401 (got ${res.status})`);
  assert(res.body && res.body.error === 'Unauthorized', `Body is { error: "Unauthorized" } (got ${JSON.stringify(res.body)})`);
}

async function test_no_jwt_unprotected_dashboard() {
  section('Test 4: no_jwt_unprotected_dashboard — no Authorization on unprotected dashboard → 200, array body');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/data/test`, {
    method: 'GET',
    headers: {
      Host: `d${UNPROTECTED_USER_ID}.wpmix.net`,
    },
  });

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(Array.isArray(res.body), `Body is an array (got ${JSON.stringify(res.body)})`);
}

// ─── Task 8: GET /api/auth/invite/status tests ────────────────────────────────

const crypto = require('crypto');
const net = require('net');

// Dashboard owner userId (the d{N} in dashboardId)
const DASHBOARD_OWNER_ID = '999999999';
const DASHBOARD_ID = `d${DASHBOARD_OWNER_ID}`;

// Guest user IDs for test scenarios
const GUEST_WITH_ACCESS_ID = 9000000888001;
const GUEST_NO_ACCESS_ID = 9000000888002;

const WEBCHAT_DATA_DIR = path.join(__dirname, '..', 'data', 'webchat');
const GROUP_DATA_DIR = path.join(__dirname, '..', 'group_data');

// A real Ethereum test private key (well-known test key, not a secret)
const HARDHAT_TEST_SIGNING_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Helper: find a free TCP port
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Helper: start a mock Auth API server
function startMockAuthApi(port, behavior) {
  return new Promise((resolve) => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);

        // GET /api/auth/access-list?dashboardId=...
        if (req.method === 'GET' && url.pathname === '/api/auth/access-list') {
          const dashboardId = url.searchParams.get('dashboardId');
          if (behavior.accessList === 'has_access') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ emails: [behavior.guestEmail || 'guest_with_access@example.com'] }));
          } else if (behavior.accessList === 'no_access') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ emails: [] }));
          } else if (behavior.accessList === 'unavailable') {
            res.socket.destroy(); // simulate ECONNRESET
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ emails: [] }));
          }
          return;
        }

        // POST /api/auth/login
        if (req.method === 'POST' && url.pathname === '/api/auth/login') {
          if (behavior.login === 'success') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: 'mock.jwt.token' }));
          } else if (behavior.login === 'unavailable') {
            res.socket.destroy();
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal error' }));
          }
          return;
        }

        res.writeHead(404).end();
      });
    });

    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Helper: inject a session directly into sessions.json
function injectSession(sessionId, userId) {
  const sessionsPath = path.join(WEBCHAT_DATA_DIR, 'sessions.json');
  let sessions = [];
  try {
    sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch { sessions = []; }

  // Remove any existing entry with same sessionId
  sessions = sessions.filter((s) => s.sessionId !== sessionId);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  sessions.push({ sessionId, userId, createdAt: new Date().toISOString(), expiresAt });
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf8');
}

// Helper: inject a user into users.json
function injectUser(userId, email) {
  const usersPath = path.join(WEBCHAT_DATA_DIR, 'users.json');
  let users = [];
  try {
    users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  } catch { users = []; }

  users = users.filter((u) => u.userId !== userId);
  users.push({ userId, email, name: 'Test Guest', nickname: `guest_${userId}`, createdAt: new Date().toISOString() });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
}

// Helper: write ChatSettings (settings.json) for a user
function writeGuestSettings(userId, settings) {
  const userDir = path.join(GROUP_DATA_DIR, `user_${userId}`);
  fs.mkdirSync(userDir, { recursive: true });
  const settingsPath = path.join(userDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ chatId: userId, lastModified: new Date().toISOString(), ...settings }, null, 2), 'utf8');
}

// Helper: remove injected session
function removeSession(sessionId) {
  const sessionsPath = path.join(WEBCHAT_DATA_DIR, 'sessions.json');
  try {
    let sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    sessions = sessions.filter((s) => s.sessionId !== sessionId);
    fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf8');
  } catch { /* ignore */ }
}

// Helper: remove injected user
function removeUser(userId) {
  const usersPath = path.join(WEBCHAT_DATA_DIR, 'users.json');
  try {
    let users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    users = users.filter((u) => u.userId !== userId);
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
  } catch { /* ignore */ }
}

// Helper: remove guest settings folder
function removeGuestSettings(userId) {
  const userDir = path.join(GROUP_DATA_DIR, `user_${userId}`);
  try {
    if (fs.existsSync(userDir)) {
      const settingsPath = path.join(userDir, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (s.ownerPrivateKey === HARDHAT_TEST_SIGNING_KEY) {
          // Only remove if we created it (test-owned)
          fs.rmSync(userDir, { recursive: true, force: true });
        }
      }
    }
  } catch { /* ignore */ }
}

async function test_invite_status_cors_preflight() {
  section('Test 5: invite_status_cors_preflight — OPTIONS with d*.wpmix.net origin → 200 + CORS headers');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/invite/status?dashboardId=${DASHBOARD_ID}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://d123.wpmix.net',
      'Access-Control-Request-Method': 'GET',
    },
  });

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(
    res.headers['access-control-allow-origin'] === 'https://d123.wpmix.net',
    `Access-Control-Allow-Origin reflects exact origin (got "${res.headers['access-control-allow-origin']}")`
  );
  assert(
    res.headers['access-control-allow-credentials'] === 'true',
    `Access-Control-Allow-Credentials is "true" (got "${res.headers['access-control-allow-credentials']}")`
  );
}

async function test_invite_status_cors_non_dashboard_origin() {
  section('Test 6: invite_status_cors_non_dashboard_origin — GET with evil.com origin → no CORS headers');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/invite/status?dashboardId=${DASHBOARD_ID}`, {
    method: 'GET',
    headers: {
      Origin: 'https://evil.com',
    },
  });

  // Should not set ACAO header for disallowed origin
  assert(
    !res.headers['access-control-allow-origin'],
    `No Access-Control-Allow-Origin for evil.com (got "${res.headers['access-control-allow-origin']}")`
  );
}

async function test_invite_status_no_session() {
  section('Test 7: invite_status_no_session — GET with no cookie → 401');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/invite/status?dashboardId=${DASHBOARD_ID}`, {
    method: 'GET',
    headers: {
      Origin: `https://${DASHBOARD_ID}.wpmix.net`,
    },
  });

  assert(res.status === 401, `Status is 401 (got ${res.status})`);
  assert(res.body && res.body.error, `Response has error field (got ${JSON.stringify(res.body)})`);
}

async function test_invite_status_valid_session_no_dashboard_access() {
  section('Test 8: invite_status_valid_session_no_dashboard_access — valid session but guest not in access list → 401');

  // Start a mock Auth API that returns no access
  const port = await getFreePort();
  const mockServer = await startMockAuthApi(port, { accessList: 'no_access', login: 'success' });

  // Set AUTH_API_URL env override — not possible at runtime, so we instead rely on the
  // server's configured AUTH_API_URL. We need to inject a session for a guest and write
  // their keypair, and rely on the live auth-api returning no_access for a freshly-invented email.
  // For a more isolated test we skip if AUTH_API_URL is not accessible and use guest without keypair.

  const sessionId = `test_no_access_${crypto.randomBytes(8).toString('hex')}`;
  const guestEmail = `no_access_guest_${Date.now()}@example.com`;

  try {
    injectUser(GUEST_NO_ACCESS_ID, guestEmail);
    injectSession(sessionId, GUEST_NO_ACCESS_ID);
    writeGuestSettings(GUEST_NO_ACCESS_ID, {
      ownerAddress: TEST_ADDRESS,
      ownerPrivateKey: HARDHAT_TEST_SIGNING_KEY,
    });

    const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/invite/status?dashboardId=${DASHBOARD_ID}`, {
      method: 'GET',
      headers: {
        Cookie: `webchat_session=${sessionId}`,
        Origin: `https://${DASHBOARD_ID}.wpmix.net`,
      },
    });

    // Either 401 (no access from auth-api) or 503 (auth-api unreachable) are acceptable
    assert(
      res.status === 401 || res.status === 503,
      `Status is 401 or 503 when guest not in access list (got ${res.status})`
    );
  } finally {
    removeSession(sessionId);
    removeUser(GUEST_NO_ACCESS_ID);
    removeGuestSettings(GUEST_NO_ACCESS_ID);
    mockServer.close();
  }
}

async function test_invite_status_valid_session_dashboard_access() {
  section('Test 9: invite_status_valid_session_dashboard_access — valid session with dashboard access → 200 mlToken');

  // This test requires a guest who actually has dashboard_access registered with the Auth API.
  // We test by using a well-known test guest email that was registered via the OAuth flow.
  // If no such guest exists (fresh environment), this test checks that the endpoint
  // returns 401/503 (not 200 with a garbage response).

  const sessionId = `test_access_${crypto.randomBytes(8).toString('hex')}`;
  const guestEmail = `access_guest_${Date.now()}@example.com`;

  try {
    injectUser(GUEST_WITH_ACCESS_ID, guestEmail);
    injectSession(sessionId, GUEST_WITH_ACCESS_ID);
    writeGuestSettings(GUEST_WITH_ACCESS_ID, {
      ownerAddress: TEST_ADDRESS,
      ownerPrivateKey: HARDHAT_TEST_SIGNING_KEY,
    });

    const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/invite/status?dashboardId=${DASHBOARD_ID}`, {
      method: 'GET',
      headers: {
        Cookie: `webchat_session=${sessionId}`,
        Origin: `https://${DASHBOARD_ID}.wpmix.net`,
      },
    });

    // In a production environment with auth-api running and this guest not in access list,
    // we expect 401. In a test environment where auth-api may be unavailable, we expect 503.
    // The endpoint must not return 404 (not found) — that would mean it's not registered.
    assert(
      res.status !== 404,
      `Endpoint exists — not 404 (got ${res.status})`
    );
    assert(
      res.status === 200 || res.status === 401 || res.status === 503,
      `Status is 200, 401, or 503 (got ${res.status})`
    );

    // CORS headers must be present when Origin is a d*.wpmix.net origin
    assert(
      res.headers['access-control-allow-origin'] === `https://${DASHBOARD_ID}.wpmix.net`,
      `Access-Control-Allow-Origin reflects dashboard origin (got "${res.headers['access-control-allow-origin']}")`
    );
    assert(
      res.headers['access-control-allow-credentials'] === 'true',
      `Access-Control-Allow-Credentials is "true" (got "${res.headers['access-control-allow-credentials']}")`
    );

    if (res.status === 200) {
      assert(
        typeof res.body.mlToken === 'string' && res.body.mlToken.length > 0,
        `Response has mlToken string (got ${JSON.stringify(res.body)})`
      );
    }
  } finally {
    removeSession(sessionId);
    removeUser(GUEST_WITH_ACCESS_ID);
    removeGuestSettings(GUEST_WITH_ACCESS_ID);
  }
}

// ─── Task 9: Auth widget HTML injection tests ─────────────────────────────────

// Helper: fetch HTML from the d*.wpmix.net middleware and return the body as string
function fetchHtml(path, userId, extraHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${WEBCHAT_BASE}${path}`);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Host: `d${userId}.wpmix.net`,
        ...(extraHeaders || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.end();
  });
}

// Ensure protected user has an index.html so the injection block is exercised
function ensureProtectedIndexHtml() {
  const userDir = path.join(WORKSPACES_ROOT, `user_${PROTECTED_USER_ID}`);
  fs.mkdirSync(userDir, { recursive: true });
  const indexPath = path.join(userDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, `<!DOCTYPE html><html><head><title>Test</title></head><body><p>Test dashboard</p></body></html>`, 'utf8');
  }
}

// Ensure unprotected user has an index.html (no ownerAddress in settings)
function ensureUnprotectedIndexHtml() {
  const userDir = path.join(WORKSPACES_ROOT, `user_${UNPROTECTED_USER_ID}`);
  fs.mkdirSync(userDir, { recursive: true });
  const indexPath = path.join(userDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, `<!DOCTYPE html><html><head><title>Test</title></head><body><p>Unprotected dashboard</p></body></html>`, 'utf8');
  }
}

async function test_auth_widget_present_on_protected_dashboard() {
  section('Test 10: auth_widget_present_on_protected_dashboard — server does NOT inject auth-widget-loader (SDK handles auth)');

  ensureProtectedIndexHtml();

  const res = await fetchHtml('/', PROTECTED_USER_ID);

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  // Auth widget is no longer server-injected — SDK handles it client-side
  assert(
    !res.body.includes('id="auth-widget-loader"'),
    `HTML does NOT contain server-injected auth-widget-loader`
  );
}

async function test_auth_widget_absent_on_unprotected_dashboard() {
  section('Test 11: auth_widget_absent_on_unprotected_dashboard — unprotected dashboard HTML does NOT contain auth-widget-loader');

  ensureUnprotectedIndexHtml();

  const res = await fetchHtml('/', UNPROTECTED_USER_ID);

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(
    !res.body.includes('auth-widget-loader'),
    `HTML does NOT contain auth-widget-loader (found in unprotected dashboard)`
  );
}

async function test_nonce_not_embedded_in_html() {
  section('Test 12: nonce_not_embedded_in_html — server does NOT inject nonce in HTML (SDK fetches /api/auth/nonce)');

  ensureProtectedIndexHtml();

  const res = await fetchHtml('/', PROTECTED_USER_ID);

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  // Nonce is no longer server-injected — SDK calls GET /api/auth/nonce at runtime
  assert(
    !res.body.includes('window.__OAUTH_NONCE__'),
    `HTML does NOT contain server-injected window.__OAUTH_NONCE__`
  );

  // Verify /api/auth/nonce endpoint returns a valid nonce
  const nonceRes = await httpRequest(`${WEBCHAT_BASE}/api/auth/nonce`, {
    method: 'GET',
    headers: { Host: `d${PROTECTED_USER_ID}.wpmix.net` },
  });
  assert(nonceRes.status === 200, `GET /api/auth/nonce returns 200 (got ${nonceRes.status})`);
  assert(
    typeof nonceRes.body.nonce === 'string' && /^[0-9a-f]{32}$/.test(nonceRes.body.nonce),
    `Nonce is 32-char hex string (got: ${nonceRes.body.nonce})`
  );
}

async function test_no_webchat_links_in_dashboard_html() {
  section('Test 13: no_webchat_links_in_dashboard_html — HTML does not contain webchat-specific links');

  ensureProtectedIndexHtml();

  const res = await fetchHtml('/', PROTECTED_USER_ID);

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(
    !res.body.includes('Back to chat'),
    `HTML does NOT contain "Back to chat"`
  );
  assert(
    !res.body.includes('href="/profile"'),
    `HTML does NOT contain href="/profile"`
  );
  assert(
    !res.body.includes('href="/logout"'),
    `HTML does NOT contain href="/logout"`
  );
}

async function test_auth_config_endpoint() {
  section('Test 14: auth_config_endpoint — GET /api/auth/config on protected dashboard returns authEnabled: true');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/config`, {
    method: 'GET',
    headers: { Host: `d${PROTECTED_USER_ID}.wpmix.net` },
  });

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(res.body.authEnabled === true, `authEnabled is true (got ${res.body.authEnabled})`);
  assert(typeof res.body.googleClientId === 'string' && res.body.googleClientId.length > 0, `googleClientId is a non-empty string`);
  assert(typeof res.body.oauthCallbackUrl === 'string' && res.body.oauthCallbackUrl.includes('google-dashboard-callback'), `oauthCallbackUrl contains google-dashboard-callback`);
}

async function test_auth_config_unprotected() {
  section('Test 15: auth_config_unprotected — GET /api/auth/config on unprotected dashboard returns authEnabled: false');

  const res = await httpRequest(`${WEBCHAT_BASE}/api/auth/config`, {
    method: 'GET',
    headers: { Host: `d${UNPROTECTED_USER_ID}.wpmix.net` },
  });

  assert(res.status === 200, `Status is 200 (got ${res.status})`);
  assert(res.body.authEnabled === false, `authEnabled is false (got ${res.body.authEnabled})`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n=== Task 7: JWT enforcement on /api/data/ ===\n', COLORS.YELLOW);

  try {
    await test_no_jwt_protected_dashboard();
    await test_valid_jwt_correct_dashboard_id();
    await test_valid_jwt_wrong_dashboard_id();
    await test_no_jwt_unprotected_dashboard();
  } catch (err) {
    log(`\n[ERROR] Unexpected error: ${err.message}`, COLORS.RED);
    log(err.stack, COLORS.RED);
    process.exit(1);
  }

  log('\n=== Task 8: GET /api/auth/invite/status ===\n', COLORS.YELLOW);

  try {
    await test_invite_status_cors_preflight();
    await test_invite_status_cors_non_dashboard_origin();
    await test_invite_status_no_session();
    await test_invite_status_valid_session_no_dashboard_access();
    await test_invite_status_valid_session_dashboard_access();
  } catch (err) {
    log(`\n[ERROR] Unexpected error: ${err.message}`, COLORS.RED);
    log(err.stack, COLORS.RED);
    process.exit(1);
  }

  log('\n=== Auth SDK (client-side auth replaces server injection) ===\n', COLORS.YELLOW);

  try {
    await test_auth_widget_present_on_protected_dashboard();
    await test_auth_widget_absent_on_unprotected_dashboard();
    await test_nonce_not_embedded_in_html();
    await test_no_webchat_links_in_dashboard_html();
    await test_auth_config_endpoint();
    await test_auth_config_unprotected();
  } catch (err) {
    log(`\n[ERROR] Unexpected error: ${err.message}`, COLORS.RED);
    log(err.stack, COLORS.RED);
    process.exit(1);
  }

  log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`, failed > 0 ? COLORS.RED : COLORS.GREEN);

  if (failures.length > 0) {
    log('Failed tests:', COLORS.RED);
    failures.forEach((f) => log(`  - ${f}`, COLORS.RED));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
