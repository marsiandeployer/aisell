#!/usr/bin/env node
/**
 * Integration tests for Profile "Share Dashboard" section (Task 10).
 *
 * Tests:
 * 1. GET /profile with ownerAddress set → contains "Поделиться дашбордом"
 * 2. GET /profile without ownerAddress → does NOT contain "Поделиться дашбордом"
 * 3. GET /profile never renders "Private Key:" in the HTML body
 *
 * Usage:
 *   cd /root/aisell/botplatform && export $(cat .env.auth | xargs) && node tests/test_profile_share.js
 *
 * Requires:
 *   - simpledashboard-web running on port 8094
 *   - user_999999999 has ownerAddress set in settings.json (protected)
 *   - user_1106185346 exists but has no ownerAddress (unprotected)
 *
 * Run from: /root/aisell/botplatform/
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// ─── Test harness ─────────────────────────────────────────────────────

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

// ─── HTTP helper ──────────────────────────────────────────────────────

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
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function get(baseUrl, pathStr, cookieHeader) {
  return httpRequest(baseUrl + pathStr, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

function post(baseUrl, pathStr, body, extraHeaders) {
  const bodyStr = JSON.stringify(body);
  return httpRequest(baseUrl + pathStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...(extraHeaders || {}),
    },
    body: bodyStr,
  });
}

// ─── Test helpers ─────────────────────────────────────────────────────

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

function makeGoogleToken(testSecret, payload) {
  return jwt.sign(
    { email_verified: true, ...payload },
    testSecret,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
}

const PROTECTED_USER_ID = '999999999';
const UNPROTECTED_USER_ID = '1106185346';

/**
 * Get a session cookie for a specific user.
 * For the protected user (999999999): localhost auto-auth (no cookie needed, but
 * we get one by logging in via Google auth test bypass).
 * For the unprotected user (1106185346): login via Google auth test bypass.
 */
async function getSessionFor(baseUrl, testSecret, userId) {
  if (userId === PROTECTED_USER_ID) {
    // Localhost auto-auth — GET /profile without cookie should work
    // because ensureAuthed() auto-auths as userId=999999999 on localhost.
    // Return null to use no cookie (localhost auto-auth).
    return null;
  }

  // For unprotected user: look up the email from users.json
  const dataDirs = [
    '/root/aisell/botplatform/data/webchat',
    '/root/aisell/noxonbot/data/webchat',
  ];
  let email = null;
  for (const dir of dataDirs) {
    try {
      const usersPath = path.join(dir, 'users.json');
      if (fs.existsSync(usersPath)) {
        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        const user = users.find((u) => String(u.userId) === userId);
        if (user) {
          email = user.email;
          break;
        }
      }
    } catch (_) { /* ignore */ }
  }

  if (!email) {
    // Create a session via Google auth with the specific userId
    // We'll use a test email that maps to this user
    email = `test_unprotected_${userId}@example.com`;
  }

  // Login via Google test token
  const token = makeGoogleToken(testSecret, {
    email,
    name: `Test User ${userId}`,
    sub: `google_${userId}`,
  });

  const resp = await post(baseUrl, '/api/auth/google', { credential: token });
  if (resp.status === 200) {
    const cookie = extractSessionCookie(resp.headers);
    if (cookie) return cookie;
  }

  // Fallback: try simple login
  const simpleResp = await post(baseUrl, '/api/auth/claim', {
    name: `Test User ${userId}`,
    email,
  });
  if (simpleResp.status === 200) {
    return extractSessionCookie(simpleResp.headers);
  }

  return null;
}

// ─── Main test suite ──────────────────────────────────────────────────

async function runTests(baseUrl, testSecret) {
  log(`\n${'='.repeat(60)}`, COLORS.CYAN);
  log(`  Profile Share Dashboard Tests (Task 10)`, COLORS.CYAN);
  log(`  Base URL: ${baseUrl}`, COLORS.CYAN);
  log(`${'='.repeat(60)}\n`, COLORS.CYAN);

  // ── Test 1: Share section present for protected user ──
  section('Test 1: Share section present when ownerAddress is set');

  // Localhost auto-auth gives us userId=999999999 which has ownerAddress
  const protectedResp = await get(baseUrl, '/profile');
  assert(protectedResp.status === 200, 'GET /profile returns 200 for protected user');
  assert(
    protectedResp.body.includes('Поделиться дашбордом'),
    'Profile HTML contains "Поделиться дашбордом" when ownerAddress is set'
  );
  assert(
    protectedResp.body.includes('id="btnInvite"'),
    'Profile HTML contains invite button (id="btnInvite") when ownerAddress is set'
  );
  assert(
    protectedResp.body.includes('id="btnRevoke"'),
    'Profile HTML contains revoke button (id="btnRevoke") when ownerAddress is set'
  );
  assert(
    protectedResp.body.includes('id="inviteResult"'),
    'Profile HTML contains #inviteResult div when ownerAddress is set'
  );

  // ── Test 2: Share section absent for unprotected user ──
  section('Test 2: Share section absent when ownerAddress is NOT set');

  const unprotectedCookie = await getSessionFor(baseUrl, testSecret, UNPROTECTED_USER_ID);
  if (unprotectedCookie) {
    const unprotectedResp = await get(baseUrl, '/profile', unprotectedCookie);
    assert(unprotectedResp.status === 200, 'GET /profile returns 200 for unprotected user');
    assert(
      !unprotectedResp.body.includes('Поделиться дашбордом'),
      'Profile HTML does NOT contain "Поделиться дашбордом" when ownerAddress is not set'
    );
    assert(
      !unprotectedResp.body.includes('id="btnInvite"'),
      'Profile HTML does NOT contain invite button when ownerAddress is not set'
    );
    assert(
      !unprotectedResp.body.includes('id="btnRevoke"'),
      'Profile HTML does NOT contain revoke button when ownerAddress is not set'
    );
  } else {
    log(`  [SKIP] Could not obtain session for unprotected user ${UNPROTECTED_USER_ID}`, COLORS.YELLOW);
  }

  // ── Test 3: Private key never in HTML ──
  section('Test 3: Private key NOT in profile HTML');

  assert(
    !protectedResp.body.includes('Private Key:'),
    'Profile HTML does NOT contain "Private Key:" for protected user'
  );
  assert(
    !protectedResp.body.includes('ownerPrivateKey'),
    'Profile HTML does NOT contain "ownerPrivateKey" for protected user'
  );

  if (unprotectedCookie) {
    const unprotectedResp2 = await get(baseUrl, '/profile', unprotectedCookie);
    assert(
      !unprotectedResp2.body.includes('Private Key:'),
      'Profile HTML does NOT contain "Private Key:" for unprotected user'
    );
  }

  // ── Test 4: Guest list section renders ──
  section('Test 4: Guest list section renders');

  // For the protected user, check that the guest list area is present
  assert(
    protectedResp.body.includes('guest-list') || protectedResp.body.includes('Нет гостей с доступом'),
    'Profile HTML contains guest list section or "Нет гостей с доступом" message'
  );

  // ── Summary ──
  log(`\n${'='.repeat(60)}`, COLORS.CYAN);
  log(`  Results: ${passed} passed, ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  if (failures.length > 0) {
    log(`\n  Failures:`, COLORS.RED);
    failures.forEach((f) => log(`    - ${f}`, COLORS.RED));
  }
  log(`${'='.repeat(60)}\n`, COLORS.CYAN);

  process.exit(failed > 0 ? 1 : 0);
}

// ─── Entry point ──────────────────────────────────────────────────────

const baseUrl = process.env.WEBCHAT_TEST_URL || 'http://127.0.0.1:8094';
const testSecret = process.env.GOOGLE_AUTH_TEST_SECRET;
if (!testSecret) {
  log('ERROR: GOOGLE_AUTH_TEST_SECRET env var is required', COLORS.RED);
  log('Usage: export $(cat .env.auth | xargs) && node tests/test_profile_share.js', COLORS.YELLOW);
  process.exit(1);
}

runTests(baseUrl, testSecret).catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
