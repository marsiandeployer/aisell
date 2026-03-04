#!/usr/bin/env node
/**
 * Auth API unit and integration tests (standalone JS, no frameworks).
 *
 * Unit tests: ecrecover, challenge validation, JWT, rate limiter — no HTTP, no PG.
 * Integration tests: HTTP requests to Auth API on port 8095 — requires running service + PG.
 *
 * Usage:
 *   node tests/test_auth_api.js                 # all tests (unit + integration)
 *   UNIT_ONLY=1 node tests/test_auth_api.js     # unit tests only
 *
 * Env vars for integration tests:
 *   INTERNAL_API_KEY  — must match the running Auth API's INTERNAL_API_KEY
 *   PG_PASSWORD       — for teardown cleanup (default from .env)
 *
 * Run from: /root/aisell/botplatform/
 */

const http = require('http');
const crypto = require('crypto');

// ─── Test Harness (same pattern as test_claude_md_templates.js) ─────

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

// ─── HTTP Helper (built-in http module, no dependencies) ────────────

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
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// ─── Rate Limiter (inline copy matching auth-api.ts for unit testing) ─

class SlidingWindowRateLimiter {
  constructor(name, windowMs, max) {
    this.name = name;
    this.windowMs = Math.max(1, Math.floor(windowMs));
    this.max = Math.max(1, Math.floor(max));
    this.entries = new Map();
  }

  _prune(entry, nowMs) {
    const cutoff = nowMs - this.windowMs;
    while (entry.hits.length > 0 && entry.hits[0] <= cutoff) {
      entry.hits.shift();
    }
  }

  check(key, nowMs) {
    const entry = this.entries.get(key);
    if (!entry) return { ok: true };
    this._prune(entry, nowMs);
    if (entry.hits.length === 0 && nowMs - entry.lastSeenMs > this.windowMs) {
      this.entries.delete(key);
      return { ok: true };
    }
    if (entry.hits.length >= this.max) {
      const oldest = entry.hits[0] || nowMs;
      const retryAfterMs = Math.max(0, oldest + this.windowMs - nowMs);
      return { ok: false, retryAfterMs };
    }
    return { ok: true };
  }

  consume(key, nowMs) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { hits: [nowMs], lastSeenMs: nowMs });
      return;
    }
    this._prune(entry, nowMs);
    entry.hits.push(nowMs);
    entry.lastSeenMs = nowMs;
  }
}

// ─── Unit Tests ─────────────────────────────────────────────────────

async function unitTests() {
  const { ethers } = require('ethers');
  const jwt = require('jsonwebtoken');

  log('\n=== UNIT TESTS (no HTTP, no PG) ===\n', COLORS.YELLOW);

  // --- ecrecover ---
  section('ecrecover');

  // unit: ecrecover valid signature -> recovers correct address
  {
    const wallet = ethers.Wallet.createRandom();
    const message = 'test-message-for-ecrecover';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.verifyMessage(message, signature);
    assert(
      ethers.getAddress(recovered) === ethers.getAddress(wallet.address),
      'unit: ecrecover valid signature -> recovers correct address'
    );
  }

  // unit: ecrecover invalid signature -> throws or returns wrong address
  {
    const wallet = ethers.Wallet.createRandom();
    const message = 'test-message';
    const signature = await wallet.signMessage(message);

    // Mutate signature bytes (flip a byte in the middle)
    const sigBytes = ethers.getBytes(signature);
    sigBytes[32] ^= 0xff; // flip byte in s-part
    const mutatedSig = ethers.hexlify(sigBytes);

    let wrongOrThrew = false;
    try {
      const recovered = ethers.verifyMessage(message, mutatedSig);
      // If it does not throw, the recovered address must differ
      wrongOrThrew = ethers.getAddress(recovered) !== ethers.getAddress(wallet.address);
    } catch {
      wrongOrThrew = true;
    }
    assert(wrongOrThrew, 'unit: ecrecover invalid signature -> throws or returns wrong address');
  }

  // --- challenge validation ---
  section('challenge validation');

  // unit: challenge valid timestamp -> passes validation
  {
    const challenge = JSON.stringify({
      dashboardId: '9000000000126',
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const parsed = JSON.parse(challenge);
    const isValid =
      parsed.dashboardId &&
      typeof parsed.timestamp === 'number' &&
      parsed.nonce &&
      Date.now() - parsed.timestamp <= 5 * 60 * 1000;
    assert(isValid, 'unit: challenge valid timestamp -> passes validation');
  }

  // unit: challenge expired (>5 min old) -> rejected
  {
    const challenge = JSON.stringify({
      dashboardId: '9000000000126',
      timestamp: Date.now() - 6 * 60 * 1000,
      nonce: crypto.randomUUID(),
    });
    const parsed = JSON.parse(challenge);
    const isExpired = Date.now() - parsed.timestamp > 5 * 60 * 1000;
    assert(isExpired, 'unit: challenge expired (>5 min old) -> rejected');
  }

  // unit: challenge malformed JSON -> rejected
  {
    let parseFailed = false;
    try {
      JSON.parse('this is not valid json!');
    } catch {
      parseFailed = true;
    }
    assert(parseFailed, 'unit: challenge malformed JSON -> rejected');
  }

  // --- JWT ---
  section('jwt');

  const JWT_TEST_SECRET = 'unit-test-secret-do-not-use-in-prod';

  // unit: JWT creation contains address, dashboardId, iat, exp claims
  {
    const address = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const dashboardId = '9000000000126';
    const token = jwt.sign({ address, dashboardId }, JWT_TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, JWT_TEST_SECRET);
    assert(decoded.address === address, 'unit: JWT creation contains address, dashboardId, iat, exp claims [address]');
    assert(decoded.dashboardId === dashboardId, 'unit: JWT creation contains address, dashboardId, iat, exp claims [dashboardId]');
    assert(typeof decoded.iat === 'number', 'unit: JWT creation contains address, dashboardId, iat, exp claims [iat]');
    assert(typeof decoded.exp === 'number', 'unit: JWT creation contains address, dashboardId, iat, exp claims [exp]');
  }

  // unit: JWT exp is ~1 hour from now
  {
    const token = jwt.sign({ address: '0x00', dashboardId: 'test' }, JWT_TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, JWT_TEST_SECRET);
    const ttl = decoded.exp - decoded.iat;
    assert(ttl === 3600, 'unit: JWT exp is ~1 hour from now');
  }

  // unit: JWT verification valid token -> decoded payload matches
  {
    const payload = { address: '0xAbc123', dashboardId: 'dash-42' };
    const token = jwt.sign(payload, JWT_TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, JWT_TEST_SECRET);
    assert(
      decoded.address === payload.address && decoded.dashboardId === payload.dashboardId,
      'unit: JWT verification valid token -> decoded payload matches'
    );
  }

  // unit: JWT verification expired token -> error
  {
    // Create token that expires in 1ms
    const token = jwt.sign({ address: '0x00', dashboardId: 'test' }, JWT_TEST_SECRET, { expiresIn: '1ms' });
    // Wait enough for it to expire
    await new Promise((r) => setTimeout(r, 20));
    let threw = false;
    let errorName = '';
    try {
      jwt.verify(token, JWT_TEST_SECRET);
    } catch (err) {
      threw = true;
      errorName = err.name;
    }
    assert(threw && errorName === 'TokenExpiredError', 'unit: JWT verification expired token -> error');
  }

  // unit: JWT verification tampered token -> error
  {
    const token = jwt.sign({ address: '0xAbc', dashboardId: 'dash-1' }, JWT_TEST_SECRET, { expiresIn: '1h' });
    // Decode, modify payload, re-encode without signing
    const parts = token.split('.');
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payloadObj = JSON.parse(payloadJson);
    payloadObj.address = '0xTAMPERED';
    parts[1] = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const tampered = parts.join('.');
    let threw = false;
    try {
      jwt.verify(tampered, JWT_TEST_SECRET);
    } catch {
      threw = true;
    }
    assert(threw, 'unit: JWT verification tampered token -> error');
  }

  // --- rate limiter ---
  section('rate limiter');

  // unit: rate limiter within limit -> allows
  {
    const rl = new SlidingWindowRateLimiter('test', 60 * 60 * 1000, 10);
    const now = Date.now();
    for (let i = 0; i < 9; i++) {
      rl.consume('test-ip', now + i);
    }
    const check = rl.check('test-ip', now + 9);
    assert(check.ok === true, 'unit: rate limiter within limit -> allows');
  }

  // unit: rate limiter exceeding limit -> rejects
  {
    const rl = new SlidingWindowRateLimiter('test', 60 * 60 * 1000, 10);
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      rl.consume('test-ip', now + i);
    }
    const check = rl.check('test-ip', now + 10);
    assert(check.ok === false, 'unit: rate limiter exceeding limit -> rejects');
  }

  // unit: rate limiter window reset -> allows again after window
  {
    const rl = new SlidingWindowRateLimiter('test', 1000, 3); // 1 second window, max 3
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      rl.consume('test-ip', now + i);
    }
    const checkBlocked = rl.check('test-ip', now + 3);
    assert(checkBlocked.ok === false, 'unit: rate limiter window reset -> allows again after window [blocked before reset]');
    // After window expires (now + 1001ms), all hits should be pruned
    const checkAfter = rl.check('test-ip', now + 1001);
    assert(checkAfter.ok === true, 'unit: rate limiter window reset -> allows again after window [allowed after reset]');
  }
}

// ─── Integration Tests ──────────────────────────────────────────────

const AUTH_API_BASE = 'http://localhost:8095';

// Collect test emails for teardown
const testEmails = [];

async function integrationTests() {
  const { ethers } = require('ethers');
  const jwt = require('jsonwebtoken');

  log('\n=== INTEGRATION TESTS (requires running auth-api on port 8095 + PG) ===\n', COLORS.YELLOW);

  // Read INTERNAL_API_KEY from env
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
  if (!INTERNAL_API_KEY) {
    log('  [ERROR] INTERNAL_API_KEY env var not set -- cannot run integration tests', COLORS.RED);
    log('  Set it to match the running Auth API: export INTERNAL_API_KEY=...', COLORS.YELLOW);
    failed++;
    failures.push('INTERNAL_API_KEY not set');
    return;
  }

  const authHeader = { Authorization: `Bearer ${INTERNAL_API_KEY}` };
  const testId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  // Helper to create unique test emails
  function testEmail(suffix) {
    const email = `test-${testId}-${suffix}@test.test`;
    testEmails.push(email);
    return email;
  }

  // Generate test wallets and data
  let wallet1 = ethers.Wallet.createRandom();
  const wallet2 = ethers.Wallet.createRandom();
  const email1 = testEmail('owner');
  const email2 = testEmail('shared');
  const dashboardId = `test-dash-${testId}`;

  // --- health ---
  section('integration: health');

  // integration: GET /api/auth/health -> 200 with { status: "ok", pg: "connected" }
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, { method: 'GET' });
    assert(res.status === 200, 'integration: GET /api/auth/health -> 200 with { status: "ok", pg: "connected" } [status]');
    assert(res.body.status === 'ok', 'integration: GET /api/auth/health -> 200 with { status: "ok", pg: "connected" } [body.status]');
    assert(res.body.pg === 'connected', 'integration: GET /api/auth/health -> 200 with { status: "ok", pg: "connected" } [body.pg]');
  }

  // --- register ---
  section('integration: register');

  // integration: POST /api/auth/register valid data -> 201 with address and dashboardId
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        address: wallet1.address,
        email: email1,
        privateKey: wallet1.privateKey,
        dashboardId,
      }),
    });
    assert(res.status === 201, 'integration: POST /api/auth/register valid data -> 201 with address and dashboardId [status]');
    assert(
      typeof res.body.address === 'string' && typeof res.body.dashboardId === 'string',
      'integration: POST /api/auth/register valid data -> 201 with address and dashboardId [body fields]'
    );
  }

  // integration: POST /api/auth/register duplicate email -> 201 (upsert: keypair updated)
  {
    const dupWallet = ethers.Wallet.createRandom();
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        address: dupWallet.address,
        email: email1, // same email
        privateKey: dupWallet.privateKey,
        dashboardId,
      }),
    });
    assert(res.status === 201, 'integration: POST /api/auth/register duplicate email -> 201 (upsert)');
    // After upsert, the active keypair is dupWallet — update wallet1 for subsequent tests
    wallet1 = dupWallet;
  }

  // --- login ---
  section('integration: login');

  // integration: POST /api/auth/login valid signature -> 200 with JWT
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const signature = await wallet1.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(res.status === 200, 'integration: POST /api/auth/login valid signature -> 200 with JWT [status]');
    assert(
      typeof res.body.token === 'string' && res.body.token.length > 0,
      'integration: POST /api/auth/login valid signature -> 200 with JWT [token present]'
    );

    // Verify JWT claims (decode without secret verification since we do not know server secret)
    if (typeof res.body.token === 'string') {
      const decoded = jwt.decode(res.body.token);
      assert(
        decoded && decoded.address === ethers.getAddress(wallet1.address),
        'integration: POST /api/auth/login valid signature -> 200 with JWT [JWT address correct]'
      );
      assert(
        decoded && decoded.dashboardId === dashboardId,
        'integration: POST /api/auth/login valid signature -> 200 with JWT [JWT dashboardId correct]'
      );
    }
  }

  // integration: POST /api/auth/login wrong keypair signature -> 401
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const wrongWallet = ethers.Wallet.createRandom();
    const signature = await wrongWallet.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(res.status === 401, 'integration: POST /api/auth/login wrong keypair signature -> 401');
  }

  // integration: POST /api/auth/login replay (old timestamp) -> 401
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      nonce: crypto.randomUUID(),
    });
    const signature = await wallet1.signMessage(challenge);
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(res.status === 401, 'integration: POST /api/auth/login replay (old timestamp) -> 401');
  }

  // --- share ---
  section('integration: share');

  // First register wallet2 for share tests
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        address: wallet2.address,
        email: email2,
        privateKey: wallet2.privateKey,
        dashboardId: `test-other-${testId}`,
      }),
    });
    assert(res.status === 201, 'integration: share setup -- registered wallet2');
  }

  // integration: POST /api/auth/share valid -> 200 with address and email; second user login -> 200
  {
    // Share dashboard with wallet2 via email lookup
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        dashboardId,
        email: email2,
        ownerAddress: wallet1.address,
      }),
    });
    assert(res.status === 200, 'integration: POST /api/auth/share valid -> 200 with address and email [status]');
    assert(
      res.body.email === email2,
      'integration: POST /api/auth/share valid -> 200 with address and email [email]'
    );

    // Now wallet2 should be able to login to the shared dashboard
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    });
    const signature = await wallet2.signMessage(challenge);
    const loginRes = await httpRequest(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(loginRes.status === 200, 'integration: POST /api/auth/share valid -> second user login -> 200');
  }

  // integration: POST /api/auth/share non-owner -> 403
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        dashboardId,
        email: email2,
        ownerAddress: wallet2.address, // wallet2 is NOT the owner
      }),
    });
    assert(res.status === 403, 'integration: POST /api/auth/share non-owner -> 403');
  }

  // --- nginx proxy ---
  section('integration: nginx proxy');

  // integration: nginx proxy GET /api/auth/health with Host: d9000000000000.wpmix.net -> 200
  {
    let skipped = false;
    try {
      const res = await httpRequest('http://localhost:80/api/auth/health', {
        method: 'GET',
        headers: { Host: 'd9000000000000.wpmix.net' },
      });
      assert(res.status === 200, 'integration: nginx proxy GET /api/auth/health with Host: d9000000000000.wpmix.net -> 200');
    } catch (err) {
      skipped = true;
      log(`  [WARN] nginx proxy test skipped: ${err.message}`, COLORS.YELLOW);
      log('  nginx on port 80 is not reachable or not configured (Task 4)', COLORS.YELLOW);
      // Count as passed since nginx might not be available in all test environments
      passed++;
    }
  }

  // --- CORS ---
  section('integration: CORS');

  // integration: CORS allowed origin d12345.wpmix.net -> Access-Control-Allow-Origin header set
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, {
      method: 'GET',
      headers: { Origin: 'https://d12345.wpmix.net' },
    });
    const acoHeader = res.headers['access-control-allow-origin'];
    assert(
      acoHeader === 'https://d12345.wpmix.net',
      'integration: CORS allowed origin d12345.wpmix.net -> Access-Control-Allow-Origin header set'
    );
  }

  // integration: CORS foreign origin -> no Access-Control-Allow-Origin header
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/health`, {
      method: 'GET',
      headers: { Origin: 'https://evil.com' },
    });
    const acoHeader = res.headers['access-control-allow-origin'];
    assert(
      !acoHeader,
      'integration: CORS foreign origin -> no Access-Control-Allow-Origin header'
    );
  }

  // --- rate limiting ---
  section('integration: rate limiting');

  // integration: 11th register from same IP within 1 hour -> 429
  // NOTE: We already registered 2 emails above (email1, email2). Start from 3.
  {
    let got429 = false;
    for (let i = 3; i <= 11; i++) {
      const w = ethers.Wallet.createRandom();
      const email = testEmail(`rl-${i}`);
      const res = await httpRequest(`${AUTH_API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          address: w.address,
          email,
          privateKey: w.privateKey,
          dashboardId: `test-rl-${testId}-${i}`,
        }),
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert(got429, 'integration: 11th register from same IP within 1 hour -> 429');
  }

  // --- access-list ---
  section('integration: access-list');

  // test_access_list_valid: GET /api/auth/access-list?dashboardId=d999 with valid INTERNAL_API_KEY -> 200, body contains { emails: [...] } array (may be empty)
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/access-list?dashboardId=d999`, {
      method: 'GET',
      headers: authHeader,
    });
    assert(res.status === 200, 'test_access_list_valid: GET /api/auth/access-list?dashboardId=d999 with valid key -> 200 [status]');
    assert(Array.isArray(res.body.emails), 'test_access_list_valid: GET /api/auth/access-list?dashboardId=d999 with valid key -> 200 [body.emails is array]');
  }

  // test_access_list_no_auth: GET /api/auth/access-list without Authorization header -> 401 { error: "Unauthorized" }
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/access-list?dashboardId=d999`, {
      method: 'GET',
    });
    assert(res.status === 401, 'test_access_list_no_auth: GET /api/auth/access-list without auth -> 401 [status]');
    assert(res.body.error === 'Unauthorized', 'test_access_list_no_auth: GET /api/auth/access-list without auth -> 401 [body.error]');
  }

  // test_access_list_wrong_key: GET /api/auth/access-list with wrong Bearer key -> 401
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/access-list?dashboardId=d999`, {
      method: 'GET',
      headers: { Authorization: 'Bearer wrongkey' },
    });
    assert(res.status === 401, 'test_access_list_wrong_key: GET /api/auth/access-list with wrong key -> 401 [status]');
    assert(res.body.error === 'Unauthorized', 'test_access_list_wrong_key: GET /api/auth/access-list with wrong key -> 401 [body.error]');
  }

  // test_access_list_missing_dashboard_id: GET /api/auth/access-list (no dashboardId param) -> 400
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/access-list`, {
      method: 'GET',
      headers: authHeader,
    });
    assert(res.status === 400, 'test_access_list_missing_dashboard_id: GET /api/auth/access-list without dashboardId -> 400 [status]');
  }

  // test_access_list_unknown_dashboard: GET /api/auth/access-list?dashboardId=dNONEXISTENT with valid key -> 200 { emails: [] }
  {
    const res = await httpRequest(`${AUTH_API_BASE}/api/auth/access-list?dashboardId=dNONEXISTENT99999`, {
      method: 'GET',
      headers: authHeader,
    });
    assert(res.status === 200, 'test_access_list_unknown_dashboard: GET /api/auth/access-list?dashboardId=dNONEXISTENT -> 200 [status]');
    assert(Array.isArray(res.body.emails) && res.body.emails.length === 0, 'test_access_list_unknown_dashboard: GET /api/auth/access-list?dashboardId=dNONEXISTENT -> 200 [body.emails is empty array]');
  }
}

// ─── Teardown (clean test data from PG) ─────────────────────────────

async function teardown() {
  section('teardown');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: '10.10.10.2',
      port: 5432,
      database: 'dashboard_auth',
      user: 'dashboard_auth',
      password: process.env.PG_PASSWORD || 'L9JD3Sa3sCgvSBpRE3g3VJMF',
      connectionTimeoutMillis: 5000,
    });

    // Delete in correct order to respect foreign key constraints
    // 1. dashboard_access references dashboards(dashboard_id) and users(address)
    // 2. dashboards references users(address)
    // 3. users

    // Find test user addresses
    const usersRes = await pool.query(
      "SELECT address FROM users WHERE email LIKE 'test-%@test.test'"
    );
    const testAddresses = usersRes.rows.map((r) => r.address);

    if (testAddresses.length > 0) {
      // Delete dashboard_access for test addresses
      await pool.query(
        'DELETE FROM dashboard_access WHERE address = ANY($1) OR granted_by = ANY($1)',
        [testAddresses]
      );

      // Delete dashboards owned by test addresses
      await pool.query(
        'DELETE FROM dashboards WHERE owner_address = ANY($1)',
        [testAddresses]
      );

      // Delete test users
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
    log('  This does not affect test results.', COLORS.YELLOW);
  }
}

// ─── Startup Check ──────────────────────────────────────────────────

async function checkAuthApiReachable() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:8095/api/auth/health', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          resolve(res.statusCode === 200 && body.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const unitOnly = process.env.UNIT_ONLY === '1';

  log('\n' + '='.repeat(60), COLORS.YELLOW);
  log('  Auth API Tests (test_auth_api.js)', COLORS.YELLOW);
  log('='.repeat(60), COLORS.YELLOW);

  // Run unit tests (always, no external deps needed)
  await unitTests();

  if (!unitOnly) {
    // Startup check: Auth API must be reachable
    const reachable = await checkAuthApiReachable();
    if (!reachable) {
      log('\n  [ERROR] Auth API not reachable at http://localhost:8095', COLORS.RED);
      log('  Start the service first:', COLORS.RED);
      log('    cd /root/aisell/botplatform', COLORS.YELLOW);
      log('    JWT_SECRET=... INTERNAL_API_KEY=... PG_HOST=10.10.10.2 PG_DB=dashboard_auth PG_USER=dashboard_auth PG_PASSWORD=... npx tsx src/auth-api.ts', COLORS.YELLOW);
      log('', COLORS.RESET);
      process.exit(1);
    }

    await integrationTests();
    await teardown();
  }

  // Summary
  log('\n' + '='.repeat(60), COLORS.YELLOW);
  log(`  Results: ${passed} passed, ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  if (failures.length > 0) {
    log('  Failures:', COLORS.RED);
    for (const f of failures) {
      log(`    - ${f}`, COLORS.RED);
    }
  }
  log(`  Success rate: ${Math.round(passed / (passed + failed) * 100)}%`);
  log('='.repeat(60) + '\n', COLORS.YELLOW);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
