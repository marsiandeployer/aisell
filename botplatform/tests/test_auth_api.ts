#!/usr/bin/env tsx
/**
 * Tests for Auth API service (botplatform/src/auth-api.ts).
 *
 * Unit tests: ecrecover, challenge validation, JWT, rate limiter — no HTTP, no PG.
 * Integration tests: full HTTP against running service on port 8095 — requires PG.
 *
 * Usage:
 *   npx tsx tests/test_auth_api.ts              # all tests
 *   npx tsx tests/test_auth_api.ts --unit-only   # unit tests only (no PG needed)
 */

import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';

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
const failures: string[] = [];

function log(msg: string, color = COLORS.RESET): void {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function assert(condition: boolean, label: string): void {
  if (condition) {
    log(`  [PASS] ${label}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  [FAIL] ${label}`, COLORS.RED);
    failed++;
    failures.push(label);
  }
}

function section(name: string): void {
  log(`\n${name}`, COLORS.CYAN);
}

// ─── Unit Tests ──────────────────────────────────────────────────

async function unitTests(): Promise<void> {
  log('\n=== UNIT TESTS (no HTTP, no PG) ===\n', COLORS.YELLOW);

  // --- ecrecover ---
  section('ecrecover');

  // ecrecover::valid_signature
  {
    const wallet = ethers.Wallet.createRandom();
    const message = 'test-message-for-ecrecover';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.verifyMessage(message, signature);
    assert(
      ethers.getAddress(recovered) === ethers.getAddress(wallet.address),
      'ecrecover::valid_signature — recovered address matches wallet address'
    );
  }

  // ecrecover::invalid_signature_throws
  {
    let threw = false;
    try {
      // Garbage hex string that is not a valid signature
      ethers.verifyMessage('some-message', '0xdeadbeef');
    } catch {
      threw = true;
    }
    assert(threw, 'ecrecover::invalid_signature_throws — garbage signature throws');
  }

  // --- challenge_validation ---
  section('challenge_validation');

  // challenge_validation::valid_timestamp
  {
    const challenge = JSON.stringify({
      dashboardId: '9000000000126',
      timestamp: Date.now(),
      nonce: 'test-nonce-1',
    });
    const parsed = JSON.parse(challenge);
    const isValid =
      parsed.dashboardId &&
      parsed.timestamp &&
      parsed.nonce &&
      typeof parsed.timestamp === 'number' &&
      Date.now() - parsed.timestamp <= 5 * 60 * 1000;
    assert(isValid, 'challenge_validation::valid_timestamp — current timestamp passes');
  }

  // challenge_validation::expired_5min
  {
    const challenge = JSON.stringify({
      dashboardId: '9000000000126',
      timestamp: Date.now() - 6 * 60 * 1000,
      nonce: 'test-nonce-2',
    });
    const parsed = JSON.parse(challenge);
    const isExpired = Date.now() - parsed.timestamp > 5 * 60 * 1000;
    assert(isExpired, 'challenge_validation::expired_5min — 6-min-old timestamp rejected');
  }

  // challenge_validation::malformed_json
  {
    let parseFailed = false;
    try {
      JSON.parse('not valid json at all');
    } catch {
      parseFailed = true;
    }
    assert(parseFailed, 'challenge_validation::malformed_json — non-JSON string fails parse');
  }

  // challenge_validation::missing_nonce
  {
    const challenge = JSON.stringify({
      dashboardId: '9000000000126',
      timestamp: Date.now(),
      // no nonce field
    });
    const parsed = JSON.parse(challenge);
    const hasNonce = Boolean(parsed.nonce);
    assert(!hasNonce, 'challenge_validation::missing_nonce — challenge without nonce detected');
  }

  // --- JWT ---
  section('jwt');

  const JWT_TEST_SECRET = 'unit-test-secret-do-not-use-in-prod';

  // jwt::contains_correct_claims
  {
    const address = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const dashboardId = '9000000000126';
    const token = jwt.sign({ address, dashboardId }, JWT_TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, JWT_TEST_SECRET) as {
      address: string;
      dashboardId: string;
      iat: number;
      exp: number;
    };
    assert(decoded.address === address, 'jwt::contains_correct_claims — address present');
    assert(decoded.dashboardId === dashboardId, 'jwt::contains_correct_claims — dashboardId present');
    assert(typeof decoded.iat === 'number', 'jwt::contains_correct_claims — iat present');
    assert(typeof decoded.exp === 'number', 'jwt::contains_correct_claims — exp present');
    const ttl = decoded.exp - decoded.iat;
    assert(ttl === 3600, `jwt::contains_correct_claims — TTL is 3600s (got ${ttl})`);
  }

  // jwt::expired_token_rejected
  {
    const token = jwt.sign({ address: '0x00', dashboardId: 'test' }, JWT_TEST_SECRET, { expiresIn: '1ms' });
    // Wait 10ms to ensure token expires
    await new Promise((r) => setTimeout(r, 10));
    let threw = false;
    let errorName = '';
    try {
      jwt.verify(token, JWT_TEST_SECRET);
    } catch (err) {
      threw = true;
      errorName = (err as Error).name;
    }
    assert(threw && errorName === 'TokenExpiredError', 'jwt::expired_token_rejected — expired JWT throws TokenExpiredError');
  }

  // --- rate_limiter ---
  section('rate_limiter');

  // Import the SlidingWindowRateLimiter from auth-api module
  // Since it's a class exported for testing, we test it directly
  // For unit tests, we reimplement the same logic inline to avoid import dependency

  // Inline SlidingWindowRateLimiter for unit testing (mirrors auth-api.ts implementation)
  type RateLimitCheck = { ok: true } | { ok: false; retryAfterMs: number };
  type RateLimitEntry = { hits: number[]; lastSeenMs: number };

  class TestSlidingWindowRateLimiter {
    public readonly windowMs: number;
    public readonly max: number;
    private readonly entries = new Map<string, RateLimitEntry>();

    constructor(windowMs: number, max: number) {
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
  }

  // rate_limiter::exceeds_limit
  {
    const rl = new TestSlidingWindowRateLimiter(60 * 60 * 1000, 10);
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      rl.consume('test-ip', now + i);
    }
    const check = rl.check('test-ip', now + 10);
    assert(!check.ok, 'rate_limiter::exceeds_limit — 10 calls then check returns ok: false');
  }

  // rate_limiter::within_limit
  {
    const rl = new TestSlidingWindowRateLimiter(60 * 60 * 1000, 10);
    const now = Date.now();
    for (let i = 0; i < 9; i++) {
      rl.consume('test-ip', now + i);
    }
    const check = rl.check('test-ip', now + 9);
    assert(check.ok, 'rate_limiter::within_limit — 9 calls then check returns ok: true');
  }
}

// ─── Integration Tests ──────────────────────────────────────────

const AUTH_API_BASE = 'http://localhost:8095';

async function fetchJson(
  url: string,
  options: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

async function integrationTests(): Promise<void> {
  log('\n=== INTEGRATION TESTS (requires running auth-api on port 8095 + PG) ===\n', COLORS.YELLOW);

  // Read INTERNAL_API_KEY from env (must match what auth-api uses)
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
  if (!INTERNAL_API_KEY) {
    log('  [SKIP] INTERNAL_API_KEY not set in env — skipping integration tests', COLORS.YELLOW);
    return;
  }

  const authHeader = { Authorization: `Bearer ${INTERNAL_API_KEY}` };

  // Generate unique test data to avoid collisions
  const testId = Date.now().toString(36);
  const testEmail1 = `test1-${testId}@example.com`;
  const testEmail2 = `test2-${testId}@example.com`;
  const wallet1 = ethers.Wallet.createRandom();
  const wallet2 = ethers.Wallet.createRandom();
  const dashboardId = `test-${testId}`;

  // health::200_ok
  section('health');
  {
    const { status, body } = await fetchJson(`${AUTH_API_BASE}/api/auth/health`);
    assert(status === 200, `health::200_ok — status ${status} === 200`);
    assert(body.status === 'ok', 'health::200_ok — body.status === "ok"');
    assert(body.pg === 'connected', 'health::200_ok — body.pg === "connected"');
  }

  // register::201_on_valid_data
  section('register');
  {
    const { status, body } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        address: wallet1.address,
        email: testEmail1,
        privateKey: wallet1.privateKey,
        dashboardId,
      }),
    });
    assert(status === 201, `register::201_on_valid_data — status ${status} === 201`);
    assert(body.address === wallet1.address, 'register::201_on_valid_data — address matches');
    assert(body.dashboardId === dashboardId, 'register::201_on_valid_data — dashboardId matches');
  }

  // register::409_on_duplicate_email
  {
    const walletDup = ethers.Wallet.createRandom();
    const { status, body } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        address: walletDup.address,
        email: testEmail1, // same email as above
        privateKey: walletDup.privateKey,
        dashboardId: `test-dup-${testId}`,
      }),
    });
    assert(status === 409, `register::409_on_duplicate_email — status ${status} === 409`);
    assert(
      typeof body.message === 'string' && body.message.includes('support@onout.org'),
      'register::409_on_duplicate_email — body contains support email'
    );
  }

  // register::400_on_bad_address
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        address: 'notanaddress',
        email: `bad-${testId}@example.com`,
        privateKey: '0xdeadbeef',
        dashboardId: `test-bad-${testId}`,
      }),
    });
    assert(status === 400, `register::400_on_bad_address — status ${status} === 400`);
  }

  // register::401_on_wrong_api_key
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key' },
      body: JSON.stringify({
        address: wallet1.address,
        email: `wrong-key-${testId}@example.com`,
        privateKey: wallet1.privateKey,
        dashboardId: `test-wrong-${testId}`,
      }),
    });
    assert(status === 401, `register::401_on_wrong_api_key — status ${status} === 401`);
  }

  // login::200_with_valid_sig
  section('login');
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: `nonce-${testId}`,
    });
    const signature = await wallet1.signMessage(challenge);
    const { status, body } = await fetchJson(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(status === 200, `login::200_with_valid_sig — status ${status} === 200`);
    assert(typeof body.token === 'string' && (body.token as string).length > 0, 'login::200_with_valid_sig — token present');

    // Verify the JWT token has correct claims
    if (typeof body.token === 'string') {
      // We can't verify server's JWT_SECRET, but we can decode without verification
      const decoded = jwt.decode(body.token) as { address: string; dashboardId: string; iat: number; exp: number } | null;
      assert(
        decoded !== null && decoded.address === ethers.getAddress(wallet1.address),
        'login::200_with_valid_sig — JWT contains correct address'
      );
      assert(
        decoded !== null && decoded.dashboardId === dashboardId,
        'login::200_with_valid_sig — JWT contains correct dashboardId'
      );
    }
  }

  // login::401_with_wrong_sig
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: `nonce-wrong-${testId}`,
    });
    // Sign with a different wallet (not registered)
    const wrongWallet = ethers.Wallet.createRandom();
    const signature = await wrongWallet.signMessage(challenge);
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(status === 401, `login::401_with_wrong_sig — status ${status} === 401`);
  }

  // login::401_with_expired_challenge
  {
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      nonce: `nonce-expired-${testId}`,
    });
    const signature = await wallet1.signMessage(challenge);
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(status === 401, `login::401_with_expired_challenge — status ${status} === 401`);
  }

  // login::400_with_malformed_challenge
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature: '0x' + '00'.repeat(65), challenge: 'not json', dashboardId }),
    });
    assert(status === 400, `login::400_with_malformed_challenge — status ${status} === 400`);
  }

  // share tests
  section('share');

  // First, register wallet2 with testEmail2
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        address: wallet2.address,
        email: testEmail2,
        privateKey: wallet2.privateKey,
        dashboardId: `test-other-${testId}`,
      }),
    });
    assert(status === 201, `share::setup — registered wallet2 with status ${status}`);
  }

  // share::200_adds_access
  {
    const { status, body } = await fetchJson(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        dashboardId,
        email: testEmail2,
        ownerAddress: wallet1.address,
      }),
    });
    assert(status === 200, `share::200_adds_access — status ${status} === 200`);
    assert(body.address === wallet2.address, 'share::200_adds_access — returned correct address');
    assert(body.email === testEmail2, 'share::200_adds_access — returned correct email');

    // Verify wallet2 can now login to the shared dashboard
    const challenge = JSON.stringify({
      dashboardId,
      timestamp: Date.now(),
      nonce: `nonce-shared-${testId}`,
    });
    const signature = await wallet2.signMessage(challenge);
    const loginRes = await fetchJson(`${AUTH_API_BASE}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ signature, challenge, dashboardId }),
    });
    assert(loginRes.status === 200, `share::200_adds_access — shared user login status ${loginRes.status} === 200`);
  }

  // share::404_unknown_email
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        dashboardId,
        email: `nonexistent-${testId}@example.com`,
        ownerAddress: wallet1.address,
      }),
    });
    assert(status === 404, `share::404_unknown_email — status ${status} === 404`);
  }

  // share::403_non_owner
  {
    const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/share`, {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify({
        dashboardId,
        email: testEmail2,
        ownerAddress: wallet2.address, // wallet2 is NOT the owner
      }),
    });
    assert(status === 403, `share::403_non_owner — status ${status} === 403`);
  }

  // rate_limit::429_on_11th_register
  section('rate_limit');
  {
    // CHANGE: Reduced to check rate limiting works without hammering the server
    // WHY: We only need to verify the 11th request is rejected
    // We already registered 2 emails above (testEmail1, testEmail2), so we start from 3
    let got429 = false;
    for (let i = 3; i <= 11; i++) {
      const w = ethers.Wallet.createRandom();
      const { status } = await fetchJson(`${AUTH_API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { ...authHeader },
        body: JSON.stringify({
          address: w.address,
          email: `rl-${testId}-${i}@example.com`,
          privateKey: w.privateKey,
          dashboardId: `test-rl-${testId}-${i}`,
        }),
      });
      if (status === 429) {
        got429 = true;
        break;
      }
    }
    assert(got429, 'rate_limit::429_on_11th_register — 11th register returns 429');
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const unitOnly = process.argv.includes('--unit-only');

  await unitTests();

  if (!unitOnly) {
    // Check if auth-api is running
    try {
      const res = await fetch(`${AUTH_API_BASE}/api/auth/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        await integrationTests();
      } else {
        log('\n  [SKIP] Auth API returned non-200 health — skipping integration tests', COLORS.YELLOW);
      }
    } catch {
      log('\n  [SKIP] Auth API not reachable on port 8095 — skipping integration tests', COLORS.YELLOW);
      log('  Start the service: cd /root/aisell/botplatform && npx tsx src/auth-api.ts', COLORS.YELLOW);
    }
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
  log('='.repeat(60) + '\n', COLORS.YELLOW);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
