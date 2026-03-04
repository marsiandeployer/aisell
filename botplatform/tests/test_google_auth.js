#!/usr/bin/env node
/**
 * Integration tests for Google OAuth authentication endpoint.
 *
 * Uses GOOGLE_AUTH_TEST_SECRET to sign fake Google JWTs so tests can run
 * without real Google credentials. The server accepts these test tokens
 * ONLY when GOOGLE_AUTH_TEST_SECRET is set (never in production).
 *
 * Usage:
 *   GOOGLE_AUTH_TEST_SECRET=test_secret node tests/test_google_auth.js
 *   WEBCHAT_TEST_URL=http://127.0.0.1:8094 GOOGLE_AUTH_TEST_SECRET=test_secret node tests/test_google_auth.js
 *
 * Requires:
 *   - webchat server running with GOOGLE_AUTH_TEST_SECRET env var
 *   - ENABLE_GOOGLE_AUTH=true on the server
 *   - jsonwebtoken installed (already in package.json)
 *
 * Run from: /root/aisell/botplatform/
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

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
        let data;
        try { data = JSON.parse(body); } catch (_) { data = { _raw: body.slice(0, 500) }; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function post(baseUrl, path, body, extraHeaders) {
  const bodyStr = JSON.stringify(body);
  return httpRequest(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...(extraHeaders || {}),
    },
    body: bodyStr,
  });
}

function get(baseUrl, path, cookieHeader) {
  return httpRequest(baseUrl + path, {
    method: 'GET',
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
}

// ─── Test helpers ─────────────────────────────────────────────────────

function makeGoogleToken(testSecret, payload) {
  return jwt.sign(
    { email_verified: true, ...payload },
    testSecret,
    { algorithm: 'HS256', expiresIn: '5m' }
  );
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cleanup helper ───────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

function cleanupTestUser(email) {
  // Best-effort cleanup of test user data from filesystem.
  // Paths depend on WEBCHAT_DATA_DIR — try common locations.
  const dataDirs = [
    '/root/aisell/noxonbot/data/webchat',
    '/root/aisell/botplatform/data/webchat',
  ];
  for (const dir of dataDirs) {
    try {
      const usersPath = path.join(dir, 'users.json');
      if (fs.existsSync(usersPath)) {
        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        const user = users.find((u) => u.email === email);
        if (!user) continue;

        // Remove from users.json
        const updated = users.filter((u) => u.email !== email);
        fs.writeFileSync(usersPath, JSON.stringify(updated, null, 2), 'utf8');

        // Remove sessions
        const sessPath = path.join(dir, 'sessions.json');
        if (fs.existsSync(sessPath)) {
          const sessions = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
          const filtered = sessions.filter((s) => s.userId !== user.userId);
          fs.writeFileSync(sessPath, JSON.stringify(filtered, null, 2), 'utf8');
        }

        // Remove chat transcript
        const chatPath = path.join(dir, 'chats', `${user.userId}.json`);
        if (fs.existsSync(chatPath)) fs.unlinkSync(chatPath);

        // Remove workspace
        const workspaceDirs = [
          `/root/aisellusers/user_${user.userId}`,
          `/root/aisell/noxonbot/data/webchat/workspaces/user_${user.userId}`,
        ];
        for (const ws of workspaceDirs) {
          if (fs.existsSync(ws)) {
            fs.rmSync(ws, { recursive: true, force: true });
          }
        }
      }
    } catch (_) {
      // Ignore cleanup errors
    }
  }
}

// ─── Main test suite ──────────────────────────────────────────────────

async function runTests(baseUrl, testSecret) {
  const runId = crypto.randomBytes(5).toString('hex');
  const testEmail = `google_oauth_test_${runId}@example.com`;
  const testName = `Google Test ${runId}`;

  log(`\n${'='.repeat(60)}`, COLORS.CYAN);
  log(`  Google OAuth Integration Tests`, COLORS.CYAN);
  log(`  Base URL: ${baseUrl}`, COLORS.CYAN);
  log(`  Test ID:  ${runId}`, COLORS.CYAN);
  log(`${'='.repeat(60)}\n`, COLORS.CYAN);

  // ── Section 1: Prerequisite checks ────────────────────────────────

  section('1. Prerequisites');

  const isLocalhostUrl = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');

  const healthResp = await get(baseUrl, '/');
  assert(healthResp.status === 200, 'GET / returns 200 (server running)');

  // Localhost auto-auths by design (see ensureAuthed in webchat.ts) — skip 401 checks.
  if (!isLocalhostUrl) {
    const meResp = await get(baseUrl, '/api/me');
    assert(meResp.status === 401, 'GET /api/me without auth returns 401');

    const histResp = await get(baseUrl, '/api/history');
    assert(histResp.status === 401, 'GET /api/history without auth returns 401');
  } else {
    log('  [SKIP] 401 checks skipped for localhost (auto-auth enabled)', COLORS.YELLOW);
  }

  // ── Section 2: Happy path — valid Google credential ───────────────

  section('2. Happy path: valid Google credential');

  const validToken = makeGoogleToken(testSecret, {
    email: testEmail,
    name: testName,
    email_verified: true,
  });

  const authResp = await post(baseUrl, '/api/auth/google', {
    credential: validToken,
    lang: 'en',
  });

  assert(authResp.status === 200, `POST /api/auth/google returns 200 (got ${authResp.status})`);
  assert(authResp.data && authResp.data.ok === true, 'Response has ok:true');
  assert(
    authResp.data.user && authResp.data.user.email === testEmail,
    `Response contains correct email (got ${authResp.data.user && authResp.data.user.email})`
  );
  assert(
    typeof authResp.data.user.userId === 'number' && authResp.data.user.userId > 0,
    'Response contains numeric userId'
  );
  assert(
    typeof authResp.data.user.nickname === 'string' && authResp.data.user.nickname.length > 0,
    'Response contains non-empty nickname'
  );

  const sessionCookie = extractSessionCookie(authResp.headers);
  assert(sessionCookie !== null, 'Response sets webchat_session cookie');

  // Guard: if auth failed, remaining tests cannot run
  if (authResp.status !== 200 || !authResp.data.user) {
    log('\n  [ABORT] Auth failed — skipping session and history tests', COLORS.RED);
    return false;
  }

  // ── Section 3: Session works after login ──────────────────────────

  section('3. Session is valid after Google login');

  const meAuthResp = await get(baseUrl, '/api/me', sessionCookie);
  assert(meAuthResp.status === 200, 'GET /api/me with session cookie returns 200');
  assert(
    meAuthResp.data.user && meAuthResp.data.user.email === testEmail,
    `GET /api/me returns correct email (got ${meAuthResp.data.user && meAuthResp.data.user.email})`
  );

  // ── Section 4: History is initialized (init message written) ──────

  section('4. Chat history initialized after first login');

  // Wait up to 5s for history to be written (async /start may run)
  let histMessages = [];
  for (let i = 0; i < 10; i++) {
    const hResp = await get(baseUrl, '/api/history', sessionCookie);
    if (hResp.status === 200 && Array.isArray(hResp.data.messages) && hResp.data.messages.length > 0) {
      histMessages = hResp.data.messages;
      break;
    }
    await sleep(500);
  }

  assert(histMessages.length > 0, `History has messages after first login (got ${histMessages.length})`);

  if (histMessages.length > 0) {
    const firstMsg = histMessages[0];
    assert(firstMsg.role === 'user' && firstMsg.text === '/start', 'First history message is user /start');
    const assistantMsgs = histMessages.filter((m) => m.role === 'assistant');
    assert(assistantMsgs.length > 0, 'History contains assistant welcome message');
    if (assistantMsgs.length > 0) {
      assert(
        typeof assistantMsgs[0].text === 'string' && assistantMsgs[0].text.length > 0,
        'Assistant welcome message is non-empty'
      );
    }
  }

  // ── Section 5: Second login restores same user ─────────────────────

  section('5. Second login restores same userId (idempotent)');

  const validToken2 = makeGoogleToken(testSecret, {
    email: testEmail,
    name: testName,
    email_verified: true,
  });

  const authResp2 = await post(baseUrl, '/api/auth/google', {
    credential: validToken2,
    lang: 'en',
  });

  assert(authResp2.status === 200, 'Second login returns 200');
  assert(
    authResp2.data.user && authResp2.data.user.userId === authResp.data.user.userId,
    `Second login restores same userId (got ${authResp2.data.user && authResp2.data.user.userId}, expected ${authResp.data.user.userId})`
  );

  // ── Section 6: Error cases ─────────────────────────────────────────

  section('6. Error cases');

  // Missing credential
  const noCredResp = await post(baseUrl, '/api/auth/google', { lang: 'en' });
  assert(noCredResp.status === 400, `Missing credential returns 400 (got ${noCredResp.status})`);

  // Invalid/tampered token (signed with wrong secret)
  const tamperedToken = makeGoogleToken('wrong_secret', { email: testEmail, email_verified: true });
  const tamperedResp = await post(baseUrl, '/api/auth/google', { credential: tamperedToken, lang: 'en' });
  assert(tamperedResp.status === 401, `Tampered token returns 401 (got ${tamperedResp.status})`);

  // Unverified email
  const unverifiedToken = makeGoogleToken(testSecret, {
    email: `unverified_${runId}@example.com`,
    name: 'Unverified User',
    email_verified: false,
  });
  const unverifiedResp = await post(baseUrl, '/api/auth/google', { credential: unverifiedToken, lang: 'en' });
  assert(unverifiedResp.status === 401, `Unverified email returns 401 (got ${unverifiedResp.status})`);

  // Expired token
  const expiredToken = jwt.sign(
    { email: testEmail, email_verified: true },
    testSecret,
    { algorithm: 'HS256', expiresIn: '-1s' }
  );
  const expiredResp = await post(baseUrl, '/api/auth/google', { credential: expiredToken, lang: 'en' });
  assert(expiredResp.status === 401, `Expired token returns 401 (got ${expiredResp.status})`);

  // ── Section 7: RU language — Russian init message ─────────────────

  section('7. Language: Russian init message');

  const ruRunId = crypto.randomBytes(5).toString('hex');
  const ruEmail = `google_oauth_ru_${ruRunId}@example.com`;

  const ruToken = makeGoogleToken(testSecret, {
    email: ruEmail,
    name: `RU Test ${ruRunId}`,
    email_verified: true,
  });

  const ruAuthResp = await post(baseUrl, '/api/auth/google', {
    credential: ruToken,
    lang: 'ru',
  });

  assert(ruAuthResp.status === 200, `RU login returns 200 (got ${ruAuthResp.status})`);

  if (ruAuthResp.status === 200) {
    const sessionCookieRu = extractSessionCookie(ruAuthResp.headers);
    let ruMessages = [];
    for (let i = 0; i < 10; i++) {
      const hResp = await get(baseUrl, '/api/history', sessionCookieRu);
      if (hResp.status === 200 && Array.isArray(hResp.data.messages) && hResp.data.messages.length > 0) {
        ruMessages = hResp.data.messages;
        break;
      }
      await sleep(500);
    }

    const ruAssistant = ruMessages.find((m) => m.role === 'assistant');
    assert(
      ruMessages.length > 0 && ruAssistant,
      `RU login: history has assistant message (got ${ruMessages.length} msgs)`
    );

    // Cleanup RU test user
    cleanupTestUser(ruEmail);
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  cleanupTestUser(testEmail);

  // ── Summary ────────────────────────────────────────────────────────

  log(`\n${'='.repeat(60)}`, COLORS.CYAN);
  log(`  Results: ${passed} passed, ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  if (failures.length > 0) {
    log('\n  Failed tests:', COLORS.RED);
    failures.forEach((f) => log(`  - ${f}`, COLORS.RED));
  }
  log(`${'='.repeat(60)}\n`, COLORS.CYAN);

  return failed === 0;
}

// ─── Entry point ──────────────────────────────────────────────────────

async function main() {
  const testSecret = process.env.GOOGLE_AUTH_TEST_SECRET;
  if (!testSecret) {
    console.error('❌ GOOGLE_AUTH_TEST_SECRET is not set.');
    console.error('   Start the webchat server with GOOGLE_AUTH_TEST_SECRET=<secret>');
    console.error('   and run: GOOGLE_AUTH_TEST_SECRET=<secret> node tests/test_google_auth.js');
    process.exit(1);
  }

  const baseUrl = (process.env.WEBCHAT_TEST_URL || 'http://127.0.0.1:8094').replace(/\/$/, '');

  try {
    const ok = await runTests(baseUrl, testSecret);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('❌ Unexpected error:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

main();
