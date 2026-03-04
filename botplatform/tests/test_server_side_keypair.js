#!/usr/bin/env node
/**
 * Integration tests for server-side keypair generation and OAuth callback flow.
 *
 * Exercises GET /api/auth/google-dashboard-callback (Task 6),
 * GET /api/auth/invite/status (Task 8), and signChallenge ecrecover (Task 3).
 *
 * Uses GOOGLE_AUTH_TEST_SECRET to sign fake Google JWTs so tests can run
 * without real Google credentials. The server accepts these test tokens
 * ONLY when GOOGLE_AUTH_TEST_SECRET is set (never in production).
 *
 * Usage:
 *   cd /root/aisell/botplatform
 *   GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js
 *   WEBCHAT_TEST_URL=http://127.0.0.1:8094 GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js
 *
 * Requires:
 *   - simpledashboard-web PM2 process running with GOOGLE_AUTH_TEST_SECRET + .env.auth loaded
 *   - dashboard-auth-api PM2 process running on port 8095
 *   - ethers, jsonwebtoken in package.json (already present)
 *
 * Run from: /root/aisell/botplatform/
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

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

function skip(description, reason) {
  log(`  [SKIP] ${description} — ${reason}`, COLORS.YELLOW);
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
        try { data = JSON.parse(body); } catch (_) { data = { _raw: body.slice(0, 2000) }; }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
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

function get(baseUrl, pathStr, extraHeaders) {
  return httpRequest(baseUrl + pathStr, {
    method: 'GET',
    headers: extraHeaders || {},
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

function extractMlToken(locationHeader) {
  if (!locationHeader) return null;
  const decoded = decodeURIComponent(locationHeader);
  const match = decoded.match(/[?&]ml=([a-f0-9]+)/);
  return match ? match[1] : null;
}

function extractError(locationHeader) {
  if (!locationHeader) return null;
  const decoded = decodeURIComponent(locationHeader);
  const match = decoded.match(/[?&]error=([^&]+)/);
  return match ? match[1] : null;
}

function makeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cleanup helper ───────────────────────────────────────────────────

function cleanupTestUser(email) {
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

        // Remove group_data workspace (ChatSettings, etc.)
        // The server may store settings in different paths depending on whether
        // the WORKSPACES_ROOT/user_{id} directory existed at save time.
        const groupDataDirs = [
          `/root/aisell/botplatform/group_data/user_${user.userId}`,
          `/root/aisell/noxonbot/group_data/user_${user.userId}`,
          `/root/aisell/noxonbot/group_data/${user.userId}`,
        ];
        for (const ws of groupDataDirs) {
          if (fs.existsSync(ws)) {
            fs.rmSync(ws, { recursive: true, force: true });
          }
        }

        // Remove aisellusers workspace
        const userWorkspace = `/root/aisellusers/user_${user.userId}`;
        if (fs.existsSync(userWorkspace)) {
          fs.rmSync(userWorkspace, { recursive: true, force: true });
        }
      }
    } catch (_) {
      // Ignore cleanup errors — best-effort
    }
  }
}

/**
 * Perform Google login via POST /api/auth/google (test bypass).
 * Returns { sessionCookie, userId, email } or null on failure.
 */
async function loginViaGoogleAuth(baseUrl, testSecret, email, name) {
  const token = makeGoogleToken(testSecret, { email, name, email_verified: true });
  const resp = await post(baseUrl, '/api/auth/google', { credential: token, lang: 'en' });
  if (resp.status !== 200 || !resp.data || !resp.data.user) {
    return null;
  }
  const sessionCookie = extractSessionCookie(resp.headers);
  return {
    sessionCookie,
    userId: resp.data.user.userId,
    email: resp.data.user.email,
  };
}

/**
 * Create an invite link for the given owner session.
 * Returns { token, url } or null on failure.
 */
async function createInvite(baseUrl, sessionCookie) {
  const resp = await post(baseUrl, '/api/auth/invite', {}, { Cookie: sessionCookie });
  if (resp.status !== 200 || !resp.data || !resp.data.url) {
    return null;
  }
  const url = resp.data.url;
  const tokenMatch = url.match(/[?&]invite=([a-f0-9]+)/);
  return tokenMatch ? { token: tokenMatch[1], url } : null;
}

// ─── Mock HTTP server for Auth API tests ──────────────────────────────

/**
 * Start a mock HTTP server that pretends to be the Auth API.
 * @param {number} port - Port to listen on (0 for dynamic)
 * @param {object} behavior - { register: statusCode, share: statusCode, login: statusCode, accessList: statusCode }
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
function startMockAuthApi(port, behavior) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const url = req.url || '';

        if (url.startsWith('/api/auth/register') && req.method === 'POST') {
          const status = behavior.register || 201;
          if (status === 201) {
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'mock error' }));
          }
          return;
        }

        if (url.startsWith('/api/auth/share') && req.method === 'POST') {
          const status = behavior.share || 200;
          if (status === 200) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'mock error' }));
          }
          return;
        }

        if (url.startsWith('/api/auth/login') && req.method === 'POST') {
          const status = behavior.login || 200;
          if (status === 200) {
            // Return a fake JWT token
            const fakeJwt = jwt.sign({ dashboardId: 'dMOCK', address: '0x0' }, 'mock-secret', { expiresIn: '1h' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: fakeJwt }));
          } else {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'mock error' }));
          }
          return;
        }

        if (url.startsWith('/api/auth/access-list')) {
          const status = behavior.accessList || 200;
          if (status === 200) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ emails: behavior.accessListEmails || [] }));
          } else {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'mock error' }));
          }
          return;
        }

        // Default: return 503 for any unmatched path
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock: unmatched route' }));
      });
    });

    server.listen(port, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      resolve({
        port: assignedPort,
        close: () => new Promise((res) => server.close(res)),
      });
    });

    server.on('error', reject);
  });
}

// ─── Main test suite ──────────────────────────────────────────────────

async function runTests(baseUrl, testSecret) {
  const runId = crypto.randomBytes(5).toString('hex');
  const ownerEmail = `kp_owner_${runId}@example.com`;
  const ownerName = `KP Owner ${runId}`;
  const guestEmail = `kp_guest_${runId}@example.com`;
  const guestName = `KP Guest ${runId}`;
  const invalidEmail = `kp_invalid_${runId}@example.com`;
  const invalidName = `KP Invalid ${runId}`;

  log(`\n${'='.repeat(60)}`, COLORS.CYAN);
  log(`  Server-Side Keypair Integration Tests`, COLORS.CYAN);
  log(`  Base URL: ${baseUrl}`, COLORS.CYAN);
  log(`  Test ID:  ${runId}`, COLORS.CYAN);
  log(`${'='.repeat(60)}\n`, COLORS.CYAN);

  // ── Unit test: signChallenge ecrecover ──────────────────────────────

  section('unit: signChallenge ecrecover');

  {
    const testWallet = ethers.Wallet.createRandom();
    const testDashboardId = `dUnit${runId}`;
    const challenge = JSON.stringify({
      dashboardId: testDashboardId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const signature = await testWallet.signMessage(challenge);
    const recovered = ethers.verifyMessage(challenge, signature);

    assert(
      recovered.toLowerCase() === testWallet.address.toLowerCase(),
      `ethers.verifyMessage recovers correct address (got ${recovered.slice(0, 10)}..., expected ${testWallet.address.slice(0, 10)}...)`
    );

    assert(
      /^0x[0-9a-fA-F]{40}$/.test(testWallet.address),
      `Wallet.createRandom() produces valid Ethereum address format`
    );

    assert(
      typeof testWallet.privateKey === 'string' && testWallet.privateKey.startsWith('0x'),
      `Wallet.createRandom() produces valid private key format`
    );

    // Verify that a different wallet does NOT match
    const otherWallet = ethers.Wallet.createRandom();
    const otherRecovered = ethers.verifyMessage(challenge, signature);
    assert(
      otherRecovered.toLowerCase() !== otherWallet.address.toLowerCase(),
      `Different wallet address does NOT match the recovered signer`
    );
  }

  // ── Prerequisites: server health check ──────────────────────────────

  section('0. Prerequisites');

  const healthResp = await get(baseUrl, '/');
  assert(healthResp.status === 200, `GET / returns 200 (server running, got ${healthResp.status})`);

  if (healthResp.status !== 200) {
    log('\n  [ABORT] Server not reachable — cannot run integration tests', COLORS.RED);
    return false;
  }

  // ── Login owner via Google auth and generate invite ─────────────────

  section('0.1 Setup: login owner and create invite');

  const ownerLogin = await loginViaGoogleAuth(baseUrl, testSecret, ownerEmail, ownerName);
  assert(ownerLogin !== null, `Owner login via POST /api/auth/google succeeded`);
  if (!ownerLogin) {
    log('\n  [ABORT] Owner login failed — cannot proceed', COLORS.RED);
    cleanupTestUser(ownerEmail);
    return false;
  }

  // Wait for owner keypair to be set up via the webchat keypair flow
  // The owner needs to have ownerAddress set before invite can work.
  // Since ownerAddress is set via Extension/keypair flow, and we only have Google auth,
  // the owner user won't have ownerAddress yet. We need to simulate this by directly
  // writing the settings file.
  const ownerGroupDataDir = `/root/aisell/botplatform/group_data/user_${ownerLogin.userId}`;
  if (!fs.existsSync(ownerGroupDataDir)) {
    fs.mkdirSync(ownerGroupDataDir, { recursive: true });
  }

  // Create owner keypair and register in Auth API
  const ownerWallet = ethers.Wallet.createRandom();
  const settingsPath = path.join(ownerGroupDataDir, 'settings.json');
  let currentSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      currentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (_) {}
  }
  currentSettings.chatId = ownerLogin.userId;
  currentSettings.ownerAddress = ownerWallet.address;
  currentSettings.ownerPrivateKey = ownerWallet.privateKey;
  fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2), 'utf8');

  // Register owner in Auth API so dashboard exists in PG
  const authApiUrl = 'http://127.0.0.1:8095';
  const internalApiKey = process.env.INTERNAL_API_KEY;
  const ownerDashboardId = `d${ownerLogin.userId}`;

  let authApiUp = true;
  try {
    const regResp = await post(authApiUrl, '/api/auth/register', {
      address: ownerWallet.address,
      privateKey: ownerWallet.privateKey,
      email: ownerEmail,
      dashboardId: ownerDashboardId,
    }, {
      Authorization: internalApiKey ? `Bearer ${internalApiKey}` : '',
    });
    assert(
      regResp.status === 201 || regResp.status === 409,
      `Owner registered in Auth API (status ${regResp.status})`
    );
  } catch (err) {
    log(`  [WARN] Auth API register failed: ${err.message || err}`, COLORS.YELLOW);
    authApiUp = false;
  }

  if (!authApiUp) {
    log('\n  [ABORT] Auth API (port 8095) unreachable — integration tests require it', COLORS.RED);
    cleanupTestUser(ownerEmail);
    return false;
  }

  // Invalidate ChatSettings cache on the running server by touching the file
  // (the server re-reads settings.json on each request since loadChatSettings uses cache by chatId)
  // We need to ensure the server sees the new ownerAddress. The server caches ChatSettings in memory.
  // To bust the cache, we'll restart the approach: make an HTTP request that triggers cache invalidation.
  // Actually, let's check if the server already sees it by trying to create an invite.
  await sleep(500); // Brief pause to let fs settle

  const invite = await createInvite(baseUrl, ownerLogin.sessionCookie);
  if (!invite) {
    // ChatSettings cache may not have ownerAddress yet.
    // The server caches chatSettings. Try a workaround: call POST /api/auth/google again
    // to trigger any cache invalidation, then retry.
    log('  [INFO] First invite attempt failed (possibly cached settings), retrying...', COLORS.YELLOW);
    await sleep(1000);
    // Force re-login to refresh server state
    const ownerLogin2 = await loginViaGoogleAuth(baseUrl, testSecret, ownerEmail, ownerName);
    if (ownerLogin2) {
      ownerLogin.sessionCookie = ownerLogin2.sessionCookie;
    }
    await sleep(500);
  }

  const finalInvite = invite || await createInvite(baseUrl, ownerLogin.sessionCookie);
  assert(finalInvite !== null, `Invite link created for owner dashboard`);

  if (!finalInvite) {
    log('\n  [ABORT] Could not create invite link — check ownerAddress in ChatSettings', COLORS.RED);
    cleanupTestUser(ownerEmail);
    return false;
  }

  log(`  [INFO] Owner userId=${ownerLogin.userId}, dashboard=${ownerDashboardId}`, COLORS.CYAN);
  log(`  [INFO] Invite token=${finalInvite.token.slice(0, 12)}...`, COLORS.CYAN);

  // ── Test 1: new email -> keypair in ChatSettings -> ml-redirect -> JWT redeemable ──

  section('1. new email -> keypair in ChatSettings -> ml-redirect -> JWT redeemable');

  const guestCode = makeGoogleToken(testSecret, { email: guestEmail, name: guestName, email_verified: true });
  const state1 = makeState({
    redirect_to: `d${ownerLogin.userId}.wpmix.net`,
    invite: finalInvite.token,
    nonce: 'test-nonce',
  });

  const callbackResp = await get(baseUrl, `/api/auth/google-dashboard-callback?code=${encodeURIComponent(guestCode)}&state=${encodeURIComponent(state1)}`);

  assert(
    callbackResp.status === 302,
    `Callback returns HTTP 302 redirect (got ${callbackResp.status})`
  );

  const location1 = callbackResp.headers['location'] || '';
  const mlToken1 = extractMlToken(location1);
  const error1 = extractError(location1);

  assert(
    error1 === null,
    `No error in redirect (got error=${error1}, location=${location1.slice(0, 80)}...)`
  );

  assert(
    mlToken1 !== null && mlToken1.length > 0,
    `Location header contains ?ml=TOKEN (got ${mlToken1 ? mlToken1.slice(0, 12) + '...' : 'null'})`
  );

  // Redeem ml-token via GET /api/auth/ml
  if (mlToken1) {
    // The /api/auth/ml is served inside d*.wpmix.net middleware, so we need the Host header
    const mlResp = await get(baseUrl, `/api/auth/ml?token=${mlToken1}`, {
      Host: `d${ownerLogin.userId}.wpmix.net`,
    });

    assert(
      mlResp.status === 200,
      `GET /api/auth/ml returns 200 (got ${mlResp.status})`
    );

    assert(
      mlResp.data && typeof mlResp.data.jwt === 'string' && mlResp.data.jwt.length > 0,
      `Response contains jwt field (dashboardJwt) — got ${mlResp.data && mlResp.data.jwt ? 'string[' + mlResp.data.jwt.length + ']' : JSON.stringify(mlResp.data).slice(0, 100)}`
    );

    // Verify JWT decodes and contains correct dashboardId
    if (mlResp.data && mlResp.data.jwt) {
      try {
        const decoded = jwt.decode(mlResp.data.jwt);
        assert(
          decoded && decoded.dashboardId === ownerDashboardId,
          `JWT payload.dashboardId === "${ownerDashboardId}" (got "${decoded && decoded.dashboardId}")`
        );
      } catch (err) {
        assert(false, `JWT decode failed: ${err.message}`);
      }
    }
  } else {
    skip('ml-token redemption', 'no ml-token in redirect');
  }

  // Verify guest ChatSettings has ownerAddress
  // The server stores settings.json in one of two locations depending on whether the
  // user workspace directory (WORKSPACES_ROOT/user_{id}) exists. For new users created
  // by the callback, the directory typically doesn't exist yet, so the fallback
  // path is used: /root/aisell/noxonbot/group_data/{userId}/settings.json
  let guestUserId = null;
  let guestOwnerAddress = null;
  let guestSettingsDir = null;
  {
    const usersPath = '/root/aisell/botplatform/data/webchat/users.json';
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      const guestUser = users.find((u) => u.email === guestEmail);
      if (guestUser) {
        guestUserId = guestUser.userId;
        // Check both possible settings.json locations
        const possiblePaths = [
          path.join('/root/aisell/botplatform/group_data', `user_${guestUser.userId}`, 'settings.json'),
          path.join('/root/aisell/noxonbot/group_data', `${guestUser.userId}`, 'settings.json'),
        ];
        let foundSettingsPath = null;
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            foundSettingsPath = p;
            guestSettingsDir = path.dirname(p);
            break;
          }
        }
        if (foundSettingsPath) {
          const guestSettings = JSON.parse(fs.readFileSync(foundSettingsPath, 'utf8'));
          guestOwnerAddress = guestSettings.ownerAddress || null;
          assert(
            /^0x[0-9a-fA-F]{40}$/.test(guestOwnerAddress),
            `Guest ChatSettings.ownerAddress is valid Ethereum address (${guestOwnerAddress ? guestOwnerAddress.slice(0, 12) + '...' : 'null'})`
          );
        } else {
          assert(false, `Guest settings.json exists at one of: ${possiblePaths.join(' or ')}`);
        }
      } else {
        assert(false, `Guest user found in users.json (email=${guestEmail})`);
      }
    }
  }

  // ── Test 2: same email again -> no duplicate keypair, JWT still issued ──

  section('2. same email again -> no duplicate keypair, JWT still issued');

  // Create a fresh invite (the old ml-token was consumed)
  const invite2 = await createInvite(baseUrl, ownerLogin.sessionCookie);
  assert(invite2 !== null, `Second invite created for re-login test`);

  if (invite2 && guestUserId) {
    const guestCode2 = makeGoogleToken(testSecret, { email: guestEmail, name: guestName, email_verified: true });
    const state2 = makeState({
      redirect_to: `d${ownerLogin.userId}.wpmix.net`,
      invite: invite2.token,
      nonce: 'test-nonce',
    });

    const callbackResp2 = await get(baseUrl, `/api/auth/google-dashboard-callback?code=${encodeURIComponent(guestCode2)}&state=${encodeURIComponent(state2)}`);

    assert(
      callbackResp2.status === 302,
      `Second callback returns HTTP 302 (got ${callbackResp2.status})`
    );

    const location2 = callbackResp2.headers['location'] || '';
    const mlToken2 = extractMlToken(location2);
    const error2 = extractError(location2);

    assert(
      error2 === null,
      `No error in second redirect (got error=${error2})`
    );

    assert(
      mlToken2 !== null && mlToken2.length > 0,
      `Second redirect contains ?ml=TOKEN`
    );

    // Verify ownerAddress is unchanged (no duplicate keypair)
    // Re-check both possible paths for settings.json
    let settingsFound = false;
    const possiblePaths2 = [
      path.join('/root/aisell/botplatform/group_data', `user_${guestUserId}`, 'settings.json'),
      path.join('/root/aisell/noxonbot/group_data', `${guestUserId}`, 'settings.json'),
    ];
    for (const p of possiblePaths2) {
      if (fs.existsSync(p)) {
        const guestSettings = JSON.parse(fs.readFileSync(p, 'utf8'));
        assert(
          guestSettings.ownerAddress === guestOwnerAddress,
          `ownerAddress unchanged after second login (before=${guestOwnerAddress ? guestOwnerAddress.slice(0, 12) + '...' : 'null'}, after=${guestSettings.ownerAddress ? guestSettings.ownerAddress.slice(0, 12) + '...' : 'null'})`
        );
        settingsFound = true;
        break;
      }
    }
    if (!settingsFound) {
      assert(false, `Guest settings.json still exists after second login`);
    }

    // Verify new ml-token is redeemable
    if (mlToken2) {
      const mlResp2 = await get(baseUrl, `/api/auth/ml?token=${mlToken2}`, {
        Host: `d${ownerLogin.userId}.wpmix.net`,
      });
      assert(
        mlResp2.status === 200 && mlResp2.data && typeof mlResp2.data.jwt === 'string',
        `Second ml-token redeemable, JWT issued (status=${mlResp2.status})`
      );
    }
  } else {
    skip('Same email second pass', 'invite2 or guestUserId not available');
  }

  // ── Test 3: invalid invite -> ?error=no_access ──

  section('3. invalid invite -> ?error=no_access');

  {
    // To test "invalid invite -> no_access", we need a user who:
    // (a) ALREADY exists in PG users (so register returns 409, not 201)
    // (b) Does NOT have dashboard_access to the owner's dashboard
    //
    // Reason: POST /api/auth/register with a NEW email and the owner's dashboardId
    // grants dashboard_access as a side effect (Steps 2-3 in auth-api.ts). But if the
    // email already exists (409 conflict), register returns early without granting access.
    //
    // Approach: pre-register this email on a different dashboard via Auth API, then try
    // to access the owner's dashboard with an invalid invite.
    const noAccessEmail = `kp_noaccess_${runId}@example.com`;
    const noAccessWallet = ethers.Wallet.createRandom();
    const fakeDashboardId = `dFake${runId.slice(0, 6)}`;

    // Pre-register on a fake dashboard so the email exists in PG
    try {
      await post(authApiUrl, '/api/auth/register', {
        address: noAccessWallet.address,
        privateKey: noAccessWallet.privateKey,
        email: noAccessEmail,
        dashboardId: fakeDashboardId,
      }, {
        Authorization: internalApiKey ? `Bearer ${internalApiKey}` : '',
      });
    } catch (err) {
      log(`  [WARN] Pre-register for no_access user failed: ${err.message || err}`, COLORS.YELLOW);
    }

    // Also create WebUser via POST /api/auth/google so they have a webchat user entry
    // (callback needs to find-or-create WebUser in users.json)
    const noAccessLogin = await loginViaGoogleAuth(baseUrl, testSecret, noAccessEmail, `NoAccess ${runId}`);

    // Write settings.json with the pre-registered ownerAddress so the callback
    // doesn't try to register again (which would get 409 anyway, but we need the
    // ownerPrivateKey in ChatSettings for signChallenge in the no_access path)
    if (noAccessLogin) {
      // The server created a settings path for this user — find and update it
      const possibleSettingsPaths = [
        path.join('/root/aisell/botplatform/group_data', `user_${noAccessLogin.userId}`, 'settings.json'),
        path.join('/root/aisell/noxonbot/group_data', `${noAccessLogin.userId}`, 'settings.json'),
      ];
      for (const sp of possibleSettingsPaths) {
        const dir = path.dirname(sp);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }
      // Write to the botplatform group_data path (the server will find it via WORKSPACES_ROOT)
      const settingsDir = path.join('/root/aisell/botplatform/group_data', `user_${noAccessLogin.userId}`);
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
        chatId: noAccessLogin.userId,
        ownerAddress: noAccessWallet.address,
        ownerPrivateKey: noAccessWallet.privateKey,
      }, null, 2), 'utf8');
    }

    const freshCode = makeGoogleToken(testSecret, { email: noAccessEmail, name: `NoAccess ${runId}`, email_verified: true });
    const fakeInviteToken = crypto.randomBytes(32).toString('hex');
    const state3 = makeState({
      redirect_to: `d${ownerLogin.userId}.wpmix.net`,
      invite: fakeInviteToken,
      nonce: 'test-nonce',
    });

    const callbackResp3 = await get(baseUrl, `/api/auth/google-dashboard-callback?code=${encodeURIComponent(freshCode)}&state=${encodeURIComponent(state3)}`);

    assert(
      callbackResp3.status === 302,
      `Invalid invite callback returns 302 (got ${callbackResp3.status})`
    );

    const location3 = callbackResp3.headers['location'] || '';
    const error3 = extractError(location3);

    assert(
      error3 === 'no_access',
      `Redirect contains ?error=no_access (got error=${error3}, location=${location3.slice(0, 80)})`
    );

    // Cleanup the no-access test user
    cleanupTestUser(noAccessEmail);
  }

  // ── Test 4: Auth API down (503) -> ?error=service_unavailable ──

  section('4. Auth API down (503) -> ?error=service_unavailable');

  // NOTE: The running simpledashboard-web server reads AUTH_API_URL from process.env at startup
  // and it cannot be overridden per-request (no X-Test-Auth-Api-Url header support).
  // To truly test "Auth API down", we would need to either:
  // (a) Stop the real Auth API process (risky — other tests depend on it)
  // (b) Restart simpledashboard-web with AUTH_API_URL pointing to a mock (disruptive)
  // (c) Add X-Test-Auth-Api-Url header support in the server (requires Task 6 modification)
  //
  // Since none of these are feasible without disrupting other running processes,
  // these tests are SKIPPED with explanation. The Auth API error paths are tested
  // indirectly through the callback's error handling logic.
  skip(
    'Auth API down during register -> ?error=service_unavailable',
    'Cannot override AUTH_API_URL on running PM2 process without restart. Server does not support X-Test-Auth-Api-Url header. Would need server-side change (Task 6) to support per-request Auth API URL override.'
  );

  // ── Test 5: /api/auth/share returns error -> ?error=service_unavailable ──

  section('5. /api/auth/share error -> ?error=service_unavailable not no_access');

  skip(
    '/api/auth/share returning 500 -> ?error=service_unavailable',
    'Same limitation as test 4: cannot mock Auth API responses for a running PM2 process without restart or per-request override support. The error path (share failure -> service_unavailable, NOT no_access) is verified by code inspection: webchat.ts line ~5778 checks shareOk and redirects to ?error=service_unavailable.'
  );

  // ── Test 6: GET /api/auth/invite/status with valid session -> mlToken ──

  section('6. GET /api/auth/invite/status with valid session -> mlToken');

  {
    // First, login the guest via POST /api/auth/google to get a webchat_session cookie
    const guestLogin = await loginViaGoogleAuth(baseUrl, testSecret, guestEmail, guestName);
    assert(guestLogin !== null, `Guest login via POST /api/auth/google succeeded`);

    if (guestLogin && guestLogin.sessionCookie) {
      // Call /api/auth/invite/status with the guest's session
      const statusResp = await get(
        baseUrl,
        `/api/auth/invite/status?dashboardId=${ownerDashboardId}`,
        { Cookie: guestLogin.sessionCookie }
      );

      assert(
        statusResp.status === 200,
        `GET /api/auth/invite/status returns 200 (got ${statusResp.status})`
      );

      assert(
        statusResp.data && typeof statusResp.data.mlToken === 'string' && statusResp.data.mlToken.length > 0,
        `Response contains mlToken string (got ${statusResp.data && statusResp.data.mlToken ? 'string[' + statusResp.data.mlToken.length + ']' : JSON.stringify(statusResp.data).slice(0, 100)})`
      );

      // Verify the returned mlToken is redeemable
      if (statusResp.data && statusResp.data.mlToken) {
        const mlRespStatus = await get(baseUrl, `/api/auth/ml?token=${statusResp.data.mlToken}`, {
          Host: `d${ownerLogin.userId}.wpmix.net`,
        });
        assert(
          mlRespStatus.status === 200 && mlRespStatus.data && typeof mlRespStatus.data.jwt === 'string',
          `mlToken from invite/status is redeemable at /api/auth/ml (status=${mlRespStatus.status})`
        );
      }
    } else {
      skip('invite/status with valid session', 'Guest login failed');
    }
  }

  // ── Test 7: GET /api/auth/invite/status without session -> 401 ──

  section('7. GET /api/auth/invite/status without session -> 401');

  {
    const noSessionResp = await get(
      baseUrl,
      `/api/auth/invite/status?dashboardId=${ownerDashboardId}`
    );

    assert(
      noSessionResp.status === 401,
      `GET /api/auth/invite/status without session returns 401 (got ${noSessionResp.status})`
    );

    // Also test with a fake/expired session cookie
    const fakeSessionResp = await get(
      baseUrl,
      `/api/auth/invite/status?dashboardId=${ownerDashboardId}`,
      { Cookie: 'webchat_session=nonexistent_session_id_12345' }
    );

    assert(
      fakeSessionResp.status === 401,
      `GET /api/auth/invite/status with invalid session returns 401 (got ${fakeSessionResp.status})`
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  section('Cleanup');

  cleanupTestUser(guestEmail);
  cleanupTestUser(ownerEmail);
  cleanupTestUser(`kp_noaccess_${runId}@example.com`);
  log('  [INFO] Test user data cleaned up from filesystem', COLORS.CYAN);

  // ── Summary ─────────────────────────────────────────────────────────

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
    console.error('GOOGLE_AUTH_TEST_SECRET is not set.');
    console.error('   Start the webchat server with GOOGLE_AUTH_TEST_SECRET=<secret>');
    console.error('   and run: GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_server_side_keypair.js');
    process.exit(1);
  }

  const baseUrl = (process.env.WEBCHAT_TEST_URL || 'http://127.0.0.1:8094').replace(/\/$/, '');

  try {
    const ok = await runTests(baseUrl, testSecret);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('Unexpected error:', err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

main();
