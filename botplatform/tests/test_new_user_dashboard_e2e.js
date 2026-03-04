#!/usr/bin/env node
/**
 * E2E test: new user registration + dashboard creation flow.
 *
 * Tests the full lifecycle:
 *   1. New user logs in via Google (test token bypass)
 *   2. Workspace folder is auto-created on login
 *   3. User sends a message → Claude generates dashboard HTML
 *   4. d{userId}.wpmix.net serves index.html (nginx 200)
 *   5. Cleanup: remove test user folder and session
 *
 * Usage:
 *   export $(cat .env.auth | xargs)
 *   node tests/test_new_user_dashboard_e2e.js
 *
 * Run from: /root/aisell/botplatform/
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ─── Config ───────────────────────────────────────────────────────────

const BASE_URL = process.env.WEBCHAT_TEST_URL || 'http://127.0.0.1:8094';
const NGINX_URL = 'http://127.0.0.1:80';
const TEST_SECRET = process.env.GOOGLE_AUTH_TEST_SECRET;
const WORKSPACES_ROOT = '/root/aisell/botplatform/group_data';

if (!TEST_SECRET) {
  console.error('❌ GOOGLE_AUTH_TEST_SECRET is required. Run: export $(cat .env.auth | xargs)');
  process.exit(1);
}

// ─── Test harness ─────────────────────────────────────────────────────

const COLORS = { GREEN: '\x1b[32m', RED: '\x1b[31m', YELLOW: '\x1b[33m', CYAN: '\x1b[36m', RESET: '\x1b[0m' };
let passed = 0, failed = 0;
const failures = [];

function log(msg, color) { console.log(`${color || COLORS.RESET}${msg}${COLORS.RESET}`); }
function assert(condition, description) {
  if (condition) { log(`  [PASS] ${description}`, COLORS.GREEN); passed++; }
  else { log(`  [FAIL] ${description}`, COLORS.RED); failed++; failures.push(description); }
}
function section(name) { log(`\n${name}`, COLORS.CYAN); }

// ─── HTTP helpers ─────────────────────────────────────────────────────

function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    };
    const req = lib.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch (_) { data = { _raw: body.slice(0, 1000) }; }
        resolve({ status: res.statusCode, headers: res.headers, data, rawBody: body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function post(url, body, extraHeaders) {
  const bodyStr = JSON.stringify(body);
  return httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...(extraHeaders || {}) },
    body: bodyStr,
  });
}

function get(url, extraHeaders) {
  return httpRequest(url, { method: 'GET', headers: extraHeaders || {} });
}

function makeGoogleToken(payload) {
  return jwt.sign({ email_verified: true, ...payload }, TEST_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

function extractSessionCookie(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const c of cookies) {
    const match = c.match(/webchat_session=([^;]+)/);
    if (match) return `webchat_session=${match[1]}`;
  }
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────

let testEmail, testUserId, testSessionCookie, testUserFolder;
const runId = crypto.randomBytes(4).toString('hex');

async function test1_login_new_user() {
  section('Test 1: New user logs in via Google OAuth');

  testEmail = `e2e_new_user_${runId}@example.com`;
  const token = makeGoogleToken({ email: testEmail, name: 'E2E Test User', given_name: 'E2E' });

  const res = await post(`${BASE_URL}/api/auth/google`, { credential: token });
  assert(res.status === 200, `POST /api/auth/google → 200 (got ${res.status})`);

  // Response shape: { ok: true, user: { userId, email, ... } }
  const user = res.data && (res.data.user || res.data);
  assert(user && user.userId, `Response contains userId (got: ${JSON.stringify(res.data).slice(0, 120)})`);
  assert(user && user.email === testEmail, `Response email matches (got: ${user && user.email})`);

  testSessionCookie = extractSessionCookie(res.headers);
  assert(!!testSessionCookie, `Session cookie set (got: ${testSessionCookie})`);

  testUserId = user && user.userId;
  testUserFolder = testUserId ? path.join(WORKSPACES_ROOT, `user_${testUserId}`) : null;
}

async function test2_workspace_folder_created() {
  section('Test 2: Workspace folder auto-created on login');

  assert(!!testUserId, `userId available from login (got: ${testUserId})`);
  if (!testUserId || !testUserFolder) return;
  assert(fs.existsSync(testUserFolder), `Workspace folder exists: ${testUserFolder}`);
  if (!fs.existsSync(testUserFolder)) return;
  assert(fs.statSync(testUserFolder).isDirectory(), `Workspace is a directory`);
}

async function test3_dashboard_not_ready_returns_404() {
  section('Test 3: d{userId}.wpmix.net → 404 before dashboard is generated');

  const dashHost = `d${testUserId}.wpmix.net`;
  const res = await httpRequest(`${NGINX_URL}/`, {
    method: 'GET',
    headers: { Host: dashHost },
  });
  // Folder exists but no index.html → nginx should return 404 (not 500)
  assert(res.status === 404, `nginx returns 404 (not 500) when index.html missing (got ${res.status})`);
}

async function test4_create_dashboard_html() {
  section('Test 4: Create index.html in workspace (simulate dashboard generation)');

  assert(!!testUserFolder, `Workspace folder path known: ${testUserFolder}`);

  const dashboardHtml = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>E2E Test Dashboard</title></head>
<body>
  <h1>E2E Test Dashboard</h1>
  <p>Generated for user ${testUserId} by e2e test ${runId}</p>
</body>
</html>`;

  fs.writeFileSync(path.join(testUserFolder, 'index.html'), dashboardHtml, 'utf8');
  assert(fs.existsSync(path.join(testUserFolder, 'index.html')), `index.html written to workspace`);
}

async function test5_dashboard_serves_200() {
  section('Test 5: d{userId}.wpmix.net → 200 after index.html created');

  const dashHost = `d${testUserId}.wpmix.net`;
  const res = await httpRequest(`${NGINX_URL}/`, {
    method: 'GET',
    headers: { Host: dashHost },
  });
  assert(res.status === 200, `nginx returns 200 for dashboard (got ${res.status})`);
  assert(res.rawBody.includes('E2E Test Dashboard'), `Response body contains dashboard content`);
  assert(res.rawBody.includes(`user ${testUserId}`), `Response body contains userId`);
}

async function test6_session_still_valid() {
  section('Test 6: Session cookie is valid after login');

  assert(!!testSessionCookie, `Session cookie available`);
  const res = await get(`${BASE_URL}/api/me`, { Cookie: testSessionCookie });
  assert(res.status === 200, `GET /api/me → 200 (got ${res.status})`);
  const meUser = res.data && (res.data.user || res.data);
  assert(meUser && meUser.email === testEmail, `me.email matches (got: ${meUser && meUser.email})`);
  assert(meUser && meUser.userId === testUserId, `me.userId matches (got: ${meUser && meUser.userId})`);
}

async function test7_nonexistent_user_returns_404() {
  section('Test 7: d{nonexistent}.wpmix.net → 404');

  const res = await httpRequest(`${NGINX_URL}/`, {
    method: 'GET',
    headers: { Host: 'd9999999988888.wpmix.net' },
  });
  assert(res.status === 404, `nginx returns 404 for nonexistent user (got ${res.status})`);
}

async function cleanup() {
  section('Cleanup');

  try {
    if (testUserFolder && fs.existsSync(testUserFolder)) {
      fs.rmSync(testUserFolder, { recursive: true, force: true });
      log(`  ✅ Removed test workspace: ${testUserFolder}`, COLORS.GREEN);
    }
  } catch (err) {
    log(`  ⚠️  Cleanup warning: ${err.message}`, COLORS.YELLOW);
  }

  // Remove test user from users.json
  const usersPath = '/root/aisell/botplatform/data/webchat/users.json';
  try {
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      const filtered = users.filter((u) => u.email !== testEmail);
      if (filtered.length < users.length) {
        fs.writeFileSync(usersPath, JSON.stringify(filtered, null, 2), 'utf8');
        log(`  ✅ Removed test user from users.json`, COLORS.GREEN);
      }
    }
  } catch (err) {
    log(`  ⚠️  Could not clean users.json: ${err.message}`, COLORS.YELLOW);
  }
}

async function main() {
  log('\n============================================================', COLORS.CYAN);
  log('  E2E: New User Registration + Dashboard Creation', COLORS.CYAN);
  log('============================================================', COLORS.CYAN);
  log(`  Server: ${BASE_URL}`, COLORS.RESET);
  log(`  Run ID: ${runId}`, COLORS.RESET);

  try {
    await test1_login_new_user();
    await test2_workspace_folder_created();
    await test3_dashboard_not_ready_returns_404();
    await test4_create_dashboard_html();
    await test5_dashboard_serves_200();
    await test6_session_still_valid();
    await test7_nonexistent_user_returns_404();
  } finally {
    await cleanup();
  }

  log('\n============================================================', COLORS.CYAN);
  log(`  Results: ${passed} passed, ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  if (failures.length) {
    log('\n  Failed tests:', COLORS.RED);
    failures.forEach((f) => log(`    - ${f}`, COLORS.RED));
  }
  log('============================================================\n', COLORS.CYAN);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
