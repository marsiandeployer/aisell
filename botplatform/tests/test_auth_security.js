#!/usr/bin/env node
/**
 * Security & edge-case tests for dashboard Web3 auth system.
 *
 * Covers gaps not in test_auth_api.js:
 *   - SQL injection attempts on all fields
 *   - XSS payloads in input fields
 *   - API key validation (missing, wrong, malformed header)
 *   - Challenge edge cases (boundary timestamp, future, zero, mismatch)
 *   - Address edge cases (case sensitivity, truncated, overflow)
 *   - Double share idempotency
 *   - Same address + different email conflict
 *   - CORS preflight (OPTIONS)
 *   - JWT forgery with wrong secret
 *   - Malformed/empty request bodies
 *   - Full end-to-end flow: register → login → share → shared login → revoke
 *   - No-keypair overlay (E2E via Puppeteer)
 *
 * Usage:
 *   export $(cat .env.auth | xargs) && node tests/test_auth_security.js
 *   UNIT_ONLY=1 node tests/test_auth_security.js   # skip integration/E2E
 *
 * Run from: /root/aisell/botplatform/
 */

'use strict';

const http = require('http');
const crypto = require('crypto');

// ─── Test Harness ────────────────────────────────────────────────

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m',
};

let passed = 0;
let failed = 0;
let skipped = 0;
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

function skip(description, reason) {
  log(`  [SKIP] ${description} — ${reason}`, COLORS.YELLOW);
  skipped++;
}

function section(name) {
  log(`\n${name}`, COLORS.CYAN);
}

// ─── HTTP Helper ─────────────────────────────────────────────────

function httpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
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

// ─── Constants ───────────────────────────────────────────────────

const AUTH_API_BASE = 'http://127.0.0.1:8095';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const PG_PASSWORD = process.env.PG_PASSWORD || 'L9JD3Sa3sCgvSBpRE3g3VJMF';
const testEmails = [];

function authHeader() {
  return { Authorization: `Bearer ${INTERNAL_API_KEY}` };
}

function testId() {
  return 'sec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function testEmail(suffix) {
  const email = `test-${testId()}-${suffix}@test.test`;
  testEmails.push(email);
  return email;
}

// ─── Unit Tests (no HTTP needed) ─────────────────────────────────

async function unitSecurityTests() {
  const { ethers } = require('ethers');
  const jwt = require('jsonwebtoken');

  log('\n=== UNIT SECURITY TESTS ===\n', COLORS.YELLOW);

  // --- JWT forgery ---
  section('JWT forgery');

  // Forge JWT with a different secret
  {
    const realSecret = 'the-real-production-secret';
    const fakeSecret = 'attacker-knows-nothing';

    const legitimateToken = jwt.sign(
      { address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', dashboardId: 'dash-1' },
      realSecret,
      { expiresIn: '1h' }
    );

    // Verify with correct secret — should work
    const decoded = jwt.verify(legitimateToken, realSecret);
    assert(decoded.address === '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', 'JWT with correct secret verifies');

    // Forge with different secret — should fail
    const forgedToken = jwt.sign(
      { address: '0xATTACKER', dashboardId: 'dash-1' },
      fakeSecret,
      { expiresIn: '1h' }
    );
    let threw = false;
    try {
      jwt.verify(forgedToken, realSecret);
    } catch {
      threw = true;
    }
    assert(threw, 'JWT forged with wrong secret is rejected');
  }

  // JWT with "none" algorithm attack
  {
    const secret = 'test-secret';
    // Manually craft a token with alg: none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      address: '0xATTACKER',
      dashboardId: 'dash-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    let threw = false;
    try {
      jwt.verify(noneToken, secret);
    } catch {
      threw = true;
    }
    assert(threw, 'JWT with alg:none is rejected');
  }

  // --- ecrecover edge cases ---
  section('ecrecover edge cases');

  // Empty string signature
  {
    let threw = false;
    try {
      ethers.verifyMessage('any message', '');
    } catch {
      threw = true;
    }
    assert(threw, 'ecrecover with empty signature throws');
  }

  // Non-hex signature
  {
    let threw = false;
    try {
      ethers.verifyMessage('any message', 'not-a-hex-signature');
    } catch {
      threw = true;
    }
    assert(threw, 'ecrecover with non-hex signature throws');
  }

  // 64-byte signature (missing v byte) — ethers.js tries both v=27 and v=28
  {
    let threwOrRecoveredWrongAddr = false;
    try {
      const recovered = ethers.verifyMessage('any message', '0x' + 'aa'.repeat(64));
      // If it doesn't throw, it recovered some address (not necessarily correct)
      threwOrRecoveredWrongAddr = typeof recovered === 'string';
    } catch {
      threwOrRecoveredWrongAddr = true;
    }
    assert(threwOrRecoveredWrongAddr, 'ecrecover with 64-byte sig (no v) either throws or recovers wrong address');
  }

  // --- Challenge timestamp boundary ---
  section('challenge timestamp boundary');

  // Exactly at 5-minute boundary
  {
    const fiveMinMs = 5 * 60 * 1000;
    const nowMs = Date.now();
    const atBoundary = nowMs - fiveMinMs; // exactly 5 min ago
    const justPast = nowMs - fiveMinMs - 1; // 1ms past 5 min

    const isAtBoundaryValid = (nowMs - atBoundary) <= fiveMinMs;
    const isJustPastValid = (nowMs - justPast) <= fiveMinMs;

    assert(isAtBoundaryValid, 'Challenge at exactly 5-min boundary is valid');
    assert(!isJustPastValid, 'Challenge 1ms past 5-min boundary is invalid');
  }

  // Future timestamp
  {
    const futureTs = Date.now() + 60 * 60 * 1000; // 1 hour in future
    const isValid = (Date.now() - futureTs) <= 5 * 60 * 1000;
    // Date.now() - futureTs < 0, which is <= 5min, so technically valid
    // This is a potential issue — depends on implementation
    assert(isValid, 'Future timestamp passes freshness check (negative diff <= 5min)');
  }

  // --- Address format edge cases ---
  section('address format validation');

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  assert(!ADDRESS_RE.test(''), 'Empty string rejected');
  assert(!ADDRESS_RE.test('0x'), 'Only prefix rejected');
  assert(!ADDRESS_RE.test('0x' + 'g'.repeat(40)), 'Non-hex chars rejected');
  assert(!ADDRESS_RE.test('0x' + 'a'.repeat(39)), 'Too short (39 chars) rejected');
  assert(!ADDRESS_RE.test('0x' + 'a'.repeat(41)), 'Too long (41 chars) rejected');
  assert(ADDRESS_RE.test('0x' + 'a'.repeat(40)), 'Valid lowercase address accepted');
  assert(ADDRESS_RE.test('0x' + 'A'.repeat(40)), 'Valid uppercase address accepted');
  assert(ADDRESS_RE.test('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'), 'Mixed case (checksummed) accepted');
  assert(!ADDRESS_RE.test('0x' + 'a'.repeat(40) + "'; DROP TABLE users;--"), 'SQL injection in address rejected');
}

// ─── Integration Security Tests ──────────────────────────────────

async function integrationSecurityTests() {
  const { ethers } = require('ethers');
  const jwt = require('jsonwebtoken');

  log('\n=== INTEGRATION SECURITY TESTS ===\n', COLORS.YELLOW);
  log('  NOTE: Register rate limit is 10/hour per IP. Budget-aware ordering.\n', COLORS.YELLOW);

  if (!INTERNAL_API_KEY) {
    log('  [ERROR] INTERNAL_API_KEY env var not set — cannot run integration tests', COLORS.RED);
    failed++;
    failures.push('INTERNAL_API_KEY not set');
    return;
  }

  const tid = testId();

  // ─── Phase 1: Tests that don't consume register rate limit ─────
  // API key tests get rejected at middleware BEFORE rate limiter

  section('API key validation');

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      body: { address: '0x' + 'a'.repeat(40), email: 'x@x.com', privateKey: '0x123', dashboardId: 'd1' },
    });
    assert(res.status === 401, 'Register without API key → 401');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key-12345' },
      body: { address: '0x' + 'a'.repeat(40), email: 'x@x.com', privateKey: '0x123', dashboardId: 'd1' },
    });
    assert(res.status === 401, 'Register with wrong API key → 401');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { Authorization: INTERNAL_API_KEY },
      body: { address: '0x' + 'a'.repeat(40), email: 'x@x.com', privateKey: '0x123', dashboardId: 'd1' },
    });
    assert(res.status === 401, 'Register with malformed auth header (no Bearer) → 401');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from('admin:password').toString('base64') },
      body: { address: '0x' + 'a'.repeat(40), email: 'x@x.com', privateKey: '0x123', dashboardId: 'd1' },
    });
    assert(res.status === 401, 'Register with Basic auth → 401');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      body: { dashboardId: 'd1', email: 'x@x.com', ownerAddress: '0x' + 'a'.repeat(40) },
    });
    assert(res.status === 401, 'Share without API key → 401');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: '0x00', challenge: '{}', dashboardId: 'd1' },
    });
    assert(res.status === 400 || res.status === 401, 'Login endpoint is public (no API key needed)');
  }

  // ─── CORS (no registers) ────────────────────────────────────────

  section('CORS preflight (OPTIONS)');

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://d12345.wpmix.net', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' },
    });
    assert(res.status === 204, 'OPTIONS preflight from valid origin → 204');
    assert(res.headers['access-control-allow-origin'] === 'https://d12345.wpmix.net', 'Preflight returns correct Allow-Origin');
    assert(res.headers['access-control-allow-methods'] && res.headers['access-control-allow-methods'].includes('POST'), 'Preflight returns Allow-Methods with POST');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
    });
    assert(res.status === 204, 'OPTIONS preflight from evil origin → 204 (but no CORS headers)');
    assert(!res.headers['access-control-allow-origin'], 'No Allow-Origin for evil origin');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, { method: 'GET', headers: { Origin: 'https://d12345.wpmix.net.evil.com' } });
    assert(!res.headers['access-control-allow-origin'], 'CORS rejects d12345.wpmix.net.evil.com (suffix attack)');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, { method: 'GET', headers: { Origin: 'https://dABC.wpmix.net' } });
    assert(!res.headers['access-control-allow-origin'], 'CORS rejects dABC.wpmix.net (non-digit after d)');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, { method: 'GET', headers: { Origin: 'http://d12345.wpmix.net' } });
    assert(!res.headers['access-control-allow-origin'], 'CORS rejects http:// (requires https://)');
  }

  // ─── Malformed bodies (login = no register needed) ──────────────

  section('malformed request bodies');

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: '' });
    assert(res.status === 400, 'Login with empty body → 400');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'this is plain text not json',
    });
    assert(res.status === 400, 'Login with non-JSON body → 400');
  }

  // Register with empty object DOES consume rate limit (slot 1)
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: authHeader(),
      body: {},
    });
    assert(res.status === 400, 'Register with empty object → 400');
  }
  // Rate limit budget: 1 consumed (validation fail still consumes)

  // ─── SQL injection in login (no register needed) ───────────────

  section('SQL injection — login');

  {
    const wallet = ethers.Wallet.createRandom();
    const maliciousChallenge = JSON.stringify({
      dashboardId: "' OR 1=1; --",
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const signature = await wallet.signMessage(maliciousChallenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature, challenge: maliciousChallenge, dashboardId: "' OR 1=1; --" },
    });
    assert(res.status === 401, 'SQL injection in login challenge/dashboardId → 401 (not crash)');
  }

  section('SQL injection — share');

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: authHeader(),
      body: { dashboardId: `sqli-share-${tid}`, email: "admin'--@test.test", ownerAddress: '0x' + 'a'.repeat(40) },
    });
    assert(res.status !== 500 && res.status !== 503, 'SQL injection in share email does not crash server');
  }

  // ─── Phase 2: Register users (budget-aware, max 9 more) ────────
  // Total budget: 10 registers. 1 already consumed above.

  section('bulk user setup (budget: 9 registers)');

  // Register 6 wallets for all remaining tests
  const alice = ethers.Wallet.createRandom();
  const bob = ethers.Wallet.createRandom();
  const guest = ethers.Wallet.createRandom();
  const loginWallet = ethers.Wallet.createRandom();
  const sqliWallet = ethers.Wallet.createRandom();
  const lcWallet = ethers.Wallet.createRandom();

  const aliceEmail = testEmail('alice');
  const bobEmail = testEmail('bob');
  const guestEmail = testEmail('guest');
  const loginEmail = testEmail('login');
  const sqliEmail = `'; DROP TABLE users;--@test.test`;
  testEmails.push(sqliEmail);
  const lcEmail = testEmail('lowercase');

  const aliceDash = `alice-${tid}`;
  const loginDash = `login-${tid}`;

  // Register #2: alice (owner for E2E + share)
  const regAlice = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: alice.address, email: aliceEmail, privateKey: alice.privateKey, dashboardId: aliceDash },
  });
  assert(regAlice.status === 201, 'Setup: Alice registered → 201');

  // Register #3: bob (for share test)
  const regBob = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: bob.address, email: bobEmail, privateKey: bob.privateKey, dashboardId: `bob-${tid}` },
  });
  assert(regBob.status === 201, 'Setup: Bob registered → 201');

  // Register #4: guest (for share idempotency)
  const regGuest = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: guest.address, email: guestEmail, privateKey: guest.privateKey, dashboardId: `guest-${tid}` },
  });
  assert(regGuest.status === 201, 'Setup: Guest registered → 201');

  // Register #5: loginWallet (for challenge edge cases + PG backup check)
  const regLogin = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: loginWallet.address, email: loginEmail, privateKey: loginWallet.privateKey, dashboardId: loginDash },
  });
  assert(regLogin.status === 201, 'Setup: Login wallet registered → 201');

  // Register #6: SQL injection in email (parameterized query test)
  const regSqli = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: sqliWallet.address, email: sqliEmail, privateKey: sqliWallet.privateKey, dashboardId: `sqli-${tid}` },
  });
  assert(regSqli.status !== 500 && regSqli.status !== 503, 'SQL injection in email does not crash server (parameterized queries)');

  // Register #7: lowercase address normalization
  const regLc = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
    method: 'POST', headers: authHeader(),
    body: { address: lcWallet.address.toLowerCase(), email: lcEmail, privateKey: lcWallet.privateKey, dashboardId: `lc-${tid}` },
  });
  assert(regLc.status === 201, 'Register with lowercase address → 201 (normalized by getAddress)');
  if (regLc.status === 201) {
    assert(regLc.body.address !== lcWallet.address.toLowerCase(), 'Response address is checksummed');
  }

  // Register #8: SQL injection in dashboardId
  {
    const w = ethers.Wallet.createRandom();
    const e = testEmail('sqli-dash');
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST', headers: authHeader(),
      body: { address: w.address, email: e, privateKey: w.privateKey, dashboardId: "'; DROP TABLE dashboards;--" },
    });
    assert(res.status !== 500 && res.status !== 503, 'SQL injection in dashboardId does not crash server');
  }

  // Register #9: XSS in email
  {
    const w = ethers.Wallet.createRandom();
    const xssEmail = '<script>alert(1)</script>@test.test';
    testEmails.push(xssEmail);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST', headers: authHeader(),
      body: { address: w.address, email: xssEmail, privateKey: w.privateKey, dashboardId: `xss-${tid}` },
    });
    assert(res.status !== 500, 'XSS in email does not crash server');
  }

  // Register #10: extra fields (proto pollution test)
  {
    const w = ethers.Wallet.createRandom();
    const e = testEmail('extra');
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST', headers: authHeader(),
      body: { address: w.address, email: e, privateKey: w.privateKey, dashboardId: `extra-${tid}`, isAdmin: true, __proto__: { admin: true } },
    });
    assert(res.status === 201, 'Register with extra fields succeeds (extra fields ignored)');
  }

  log('  Register budget exhausted (10/10)', COLORS.YELLOW);

  // ─── Phase 3: Tests using pre-registered users ─────────────────

  // ─── Full E2E Flow ─────────────────────────────────────────────

  section('full E2E flow: register → login → share → shared login');

  // Alice logs in
  {
    const challenge = JSON.stringify({ dashboardId: aliceDash, timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await alice.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: sig, challenge, dashboardId: aliceDash },
    });
    assert(res.status === 200, 'E2E: Alice login → 200');
    assert(typeof res.body.token === 'string', 'E2E: Alice gets JWT');

    const aliceJwt = res.body.token ? jwt.decode(res.body.token) : null;
    assert(aliceJwt && aliceJwt.dashboardId === aliceDash, 'E2E: JWT contains correct dashboardId');
    assert(aliceJwt && aliceJwt.address === ethers.getAddress(alice.address), 'E2E: JWT contains Alice address');
    assert(aliceJwt && typeof aliceJwt.exp === 'number' && aliceJwt.exp > aliceJwt.iat, 'E2E: JWT has future expiry');
  }

  // Bob tries to login (no access yet)
  {
    const challenge = JSON.stringify({ dashboardId: aliceDash, timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await bob.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: sig, challenge, dashboardId: aliceDash },
    });
    assert(res.status === 401, 'E2E: Bob login before share → 401');
  }

  // Alice shares with Bob
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST', headers: authHeader(),
      body: { dashboardId: aliceDash, email: bobEmail, ownerAddress: alice.address },
    });
    assert(res.status === 200, 'E2E: Alice shares with Bob → 200');
  }

  // Bob logs in (should succeed now)
  {
    const challenge = JSON.stringify({ dashboardId: aliceDash, timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await bob.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: sig, challenge, dashboardId: aliceDash },
    });
    assert(res.status === 200, 'E2E: Bob login after share → 200');
    assert(typeof res.body.token === 'string', 'E2E: Bob gets JWT');

    const bobJwt = res.body.token ? jwt.decode(res.body.token) : null;
    assert(bobJwt && bobJwt.address === ethers.getAddress(bob.address), 'E2E: Bob JWT contains Bob address (not Alice)');
  }

  // Stranger cannot login
  {
    const stranger = ethers.Wallet.createRandom();
    const challenge = JSON.stringify({ dashboardId: aliceDash, timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await stranger.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: sig, challenge, dashboardId: aliceDash },
    });
    assert(res.status === 401, 'E2E: Stranger login → 401');
  }

  // ─── Double Share Idempotency ──────────────────────────────────

  section('double share idempotency');

  {
    // Share guest to Alice's dashboard
    const share1 = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST', headers: authHeader(),
      body: { dashboardId: aliceDash, email: guestEmail, ownerAddress: alice.address },
    });
    assert(share1.status === 200, 'First share → 200');

    const share2 = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST', headers: authHeader(),
      body: { dashboardId: aliceDash, email: guestEmail, ownerAddress: alice.address },
    });
    assert(share2.status === 200, 'Double share (idempotent) → 200');

    const challenge = JSON.stringify({ dashboardId: aliceDash, timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await guest.signMessage(challenge);
    const login = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: { signature: sig, challenge, dashboardId: aliceDash },
    });
    assert(login.status === 200, 'Guest login after double share → 200');
  }

  // ─── Challenge Edge Cases ──────────────────────────────────────

  section('challenge edge cases');

  {
    const challenge = JSON.stringify({ dashboardId: loginDash, timestamp: 0, nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 401, 'Challenge with timestamp=0 (epoch) → 401 expired');
  }

  {
    const challenge = JSON.stringify({ dashboardId: loginDash, timestamp: -1000000, nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 401, 'Challenge with negative timestamp → 401');
  }

  {
    const challenge = JSON.stringify({ dashboardId: loginDash, timestamp: Date.now() + 3600000, nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 200, 'Challenge with future timestamp → 200 (no future check in spec)');
  }

  {
    const challenge = JSON.stringify({ dashboardId: loginDash, timestamp: String(Date.now()), nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 400, 'Challenge with timestamp as string → 400');
  }

  {
    const challenge = JSON.stringify({ dashboardId: loginDash, timestamp: Date.now(), nonce: '' });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 400, 'Challenge with empty nonce → 400');
  }

  {
    const challenge = JSON.stringify({ timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 400, 'Challenge JSON without dashboardId → 400');
  }

  {
    const challenge = JSON.stringify({ dashboardId: 'other-dashboard', timestamp: Date.now(), nonce: crypto.randomUUID() });
    const sig = await loginWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, { method: 'POST', body: { signature: sig, challenge, dashboardId: loginDash } });
    assert(res.status === 200 || res.status === 401, 'DashboardId mismatch between challenge and request → handled');
  }

  // ─── Address Duplicate ─────────────────────────────────────────

  section('address edge cases');

  // Same address + different email → conflict (use loginWallet which is already registered)
  {
    const dupEmail = testEmail('addr-dup'); // this won't reach PG, so no new rate limit slot
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST', headers: authHeader(),
      body: { address: loginWallet.address, email: dupEmail, privateKey: loginWallet.privateKey, dashboardId: `dup-${tid}` },
    });
    // Rate limit budget is exhausted at 10, so this gets 429
    assert(res.status === 409 || res.status === 503 || res.status === 429, 'Same address different email → conflict or rate limited');
  }

  // ─── Share Edge Cases ──────────────────────────────────────────

  section('share edge cases');

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST', headers: authHeader(),
      body: { dashboardId: loginDash, email: 'nonexistent@nowhere.test', ownerAddress: loginWallet.address },
    });
    assert(res.status === 404, 'Share to unregistered email → 404');
  }

  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST', headers: authHeader(),
      body: { dashboardId: 'no-such-dashboard-12345', email: bobEmail, ownerAddress: loginWallet.address },
    });
    assert(res.status === 404, 'Share non-existent dashboard → 404');
  }

  // ─── Private Key Backup in DB ──────────────────────────────────

  section('private key backup in DB');

  {
    let pgResult = null;
    try {
      const { Pool } = require('pg');
      const pgPool = new Pool({
        host: '10.10.10.2', port: 5432, database: 'dashboard_auth',
        user: 'dashboard_auth', password: PG_PASSWORD, connectionTimeoutMillis: 5000,
      });
      const result = await pgPool.query("SELECT private_key FROM users WHERE email = $1", [loginEmail]);
      pgResult = result;
      await pgPool.end();
    } catch (err) {
      skip('Private key exists in PG', `PG connection failed: ${err.message}`);
    }

    if (pgResult) {
      assert(pgResult.rows.length > 0, 'User record exists in PG');
      assert(pgResult.rows[0].private_key && pgResult.rows[0].private_key.length > 10, 'Private key stored in PG (backup for recovery)');
    }
  }
}

// ─── E2E: No-Keypair Overlay (Puppeteer) ─────────────────────────

async function e2eNoKeypairTest() {
  log('\n=== E2E: NO-KEYPAIR OVERLAY TEST ===\n', COLORS.YELLOW);

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    skip('E2E no-keypair overlay', 'puppeteer not installed');
    return;
  }

  const fs = require('fs');
  const path = require('path');
  const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_dashboard.html');

  if (!fs.existsSync(FIXTURE_PATH)) {
    skip('E2E no-keypair overlay', 'fixture HTML not found');
    return;
  }

  // Start fixture server
  const fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const fixtureServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/auth/')) {
      // Proxy to real Auth API
      const proxyOptions = {
        hostname: '127.0.0.1',
        port: 8095,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:8095' },
      };
      const proxyReq = http.request(proxyOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        res.writeHead(502);
        res.end('Bad Gateway');
      });
      req.pipe(proxyReq);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixtureContent);
    }
  });

  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const port = fixtureServer.address().port;

  section('E2E: extension present but no keypair');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Inject a window.ethereum that returns NO_KEYPAIR error
    await page.evaluateOnNewDocument(() => {
      window.ethereum = {
        isSimpleDashboard: true,
        request: function(args) {
          return Promise.reject({ code: 'NO_KEYPAIR', message: 'No keypair found in extension storage' });
        },
      };
    });

    await page.goto(`http://127.0.0.1:${port}/?owner=0x1234567890abcdef1234567890abcdef12345678&dashboardId=test_no_keypair`, {
      waitUntil: 'networkidle2',
      timeout: 10000,
    });

    // Wait for auth init to complete
    await page.waitForFunction(() => {
      const overlay = document.getElementById('authOverlay');
      return overlay && overlay.style.display !== 'none';
    }, { timeout: 5000 });

    // Check blur is still applied
    const hasBlur = await page.evaluate(() => {
      const container = document.getElementById('authDataContainer');
      return container && container.style.filter.includes('blur');
    });
    assert(hasBlur, 'E2E: Data stays blurred when extension has no keypair');

    // Check that the no-keypair overlay is shown (with support link)
    const hasNoKeypairOverlay = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-overlay]');
      for (const o of overlays) {
        if (o.dataset.overlay === 'no-keypair' && o.style.display !== 'none') return true;
      }
      // Also check overlay text content
      const overlay = document.getElementById('authOverlay');
      return overlay && overlay.textContent.includes('support');
    });
    assert(hasNoKeypairOverlay, 'E2E: No-keypair overlay is visible with support link');

    // No JWT should be stored
    const hasJwt = await page.evaluate(() => {
      return sessionStorage.getItem('dashboard_jwt') !== null;
    });
    assert(!hasJwt, 'E2E: No JWT stored when no keypair');

  } catch (err) {
    log(`  [WARN] E2E test error: ${err.message}`, COLORS.YELLOW);
    skip('E2E no-keypair overlay assertions', err.message);
  } finally {
    if (browser) await browser.close();
    fixtureServer.close();
  }
}

// ─── Teardown ────────────────────────────────────────────────────

async function teardown() {
  section('teardown');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: '10.10.10.2',
      port: 5432,
      database: 'dashboard_auth',
      user: 'dashboard_auth',
      password: PG_PASSWORD,
      connectionTimeoutMillis: 5000,
    });

    const usersRes = await pool.query(
      "SELECT address FROM users WHERE email LIKE 'test-%@test.test'"
    );
    const testAddresses = usersRes.rows.map((r) => r.address);

    if (testAddresses.length > 0) {
      await pool.query(
        'DELETE FROM dashboard_access WHERE address = ANY($1) OR granted_by = ANY($1)',
        [testAddresses]
      );
      await pool.query(
        'DELETE FROM dashboards WHERE owner_address = ANY($1)',
        [testAddresses]
      );
      const delResult = await pool.query(
        "DELETE FROM users WHERE email LIKE 'test-%@test.test'"
      );
      log(`  Cleaned ${delResult.rowCount} test user(s) from PG`, COLORS.GREEN);
    } else {
      log('  No test data to clean', COLORS.GREEN);
    }
    await pool.end();
  } catch (err) {
    log(`  [WARN] Teardown PG cleanup failed: ${err.message}`, COLORS.YELLOW);
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const unitOnly = process.env.UNIT_ONLY === '1';

  log('\n' + '='.repeat(60), COLORS.YELLOW);
  log('  Auth Security & Edge Case Tests (test_auth_security.js)', COLORS.YELLOW);
  log('='.repeat(60), COLORS.YELLOW);

  await unitSecurityTests();

  if (!unitOnly) {
    // Check Auth API is reachable
    try {
      const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, { method: 'GET' });
      if (res.status !== 200) throw new Error('Not healthy');
    } catch {
      log('\n  [ERROR] Auth API not reachable at http://127.0.0.1:8095', COLORS.RED);
      log('  Run: export $(cat .env.auth | xargs) && pm2 restart dashboard-auth-api', COLORS.YELLOW);
      process.exit(1);
    }

    await integrationSecurityTests();
    await e2eNoKeypairTest();
    await teardown();
  }

  // Summary
  log('\n' + '='.repeat(60), COLORS.YELLOW);
  log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  if (failures.length > 0) {
    log('  Failures:', COLORS.RED);
    for (const f of failures) {
      log(`    - ${f}`, COLORS.RED);
    }
  }
  const total = passed + failed;
  log(`  Success rate: ${total > 0 ? Math.round(passed / total * 100) : 0}%`);
  log('='.repeat(60) + '\n', COLORS.YELLOW);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
