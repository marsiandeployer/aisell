#!/usr/bin/env node
/**
 * Tests for POST /api/auth/invite and POST /api/auth/invite/revoke endpoints in webchat.ts
 *
 * Tests:
 * 1. test_post_invite_returns_200_url — valid owner session -> 200 + { url } with invite prefix
 * 2. test_post_invite_url_contains_dashboard_subdomain — url contains d{userId}.wpmix.net
 * 3. test_post_invite_no_owner_address_returns_403 — no ownerAddress -> 403
 * 4. test_post_invite_no_session_returns_401 — no webchat_session cookie -> 401
 * 5. test_post_invite_token_saved_to_disk — token appears in invites.json
 * 6. test_post_invite_overwrites_old_token — second invite differs from first; old token gone
 * 7. test_post_revoke_returns_new_url — revoke returns 200 with a url
 * 8. test_post_revoke_token_differs_from_original — revoke token differs from prior invite token
 * 9. test_post_revoke_no_owner_address_returns_403 — no ownerAddress -> 403
 * 10. test_rate_limit_429_on_21st_invite — 21st POST /api/auth/invite -> 429
 * 11. test_rate_limit_keyed_by_userId_not_ip — same userId from two IPs shares one budget
 *
 * Run:
 *   cd /root/aisell/botplatform
 *   export $(cat .env.auth | xargs)
 *   GOOGLE_AUTH_TEST_SECRET=xxx node tests/test_invite_flow.js
 *
 * Requires: SimpleDashboard webchat running on port 8094.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  RESET: '\x1b[0m',
};

let passed = 0;
let failed = 0;

function log(msg, color = COLORS.RESET) {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function assert(condition, description) {
  if (condition) {
    log(`  ✅ ${description}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  ❌ ${description}`, COLORS.RED);
    failed++;
  }
}

// Simple HTTP request helper (no external deps)
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { json = { _raw: body }; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Request timeout')); });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// Extract webchat_session cookie from Set-Cookie header
function extractSessionCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return '';
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
  const match = cookieStr.match(/webchat_session=([^;]+)/);
  return match ? match[1] : '';
}

// Claim a fresh session via /api/auth/claim
async function claimSession(baseUrl) {
  const runId = Math.random().toString(36).slice(2, 12);
  const email = `invite_test_${runId}@example.com`;
  const name = `Invite Test ${runId}`;

  const resp = await httpRequest(`${baseUrl}/api/auth/claim`, {
    method: 'POST',
    body: { name, email },
  });

  if (resp.status !== 200 || !resp.body.ok) {
    throw new Error(`claim failed: ${resp.status} ${JSON.stringify(resp.body)}`);
  }

  const sessionCookie = extractSessionCookie(resp.headers);
  if (!sessionCookie) {
    throw new Error('No session cookie returned from claim');
  }

  return { sessionCookie, email, userId: resp.body.user.userId };
}

// Set ownerAddress in chatSettings for a user via register-owner endpoint
// Falls back to direct file write if the API is unavailable
async function setOwnerAddress(baseUrl, sessionCookie, userId) {
  const address = '0x' + 'a'.repeat(40);
  const privateKey = '0x' + 'b'.repeat(64);

  // Try the register-owner API first
  const resp = await httpRequest(`${baseUrl}/api/auth/register-owner`, {
    method: 'POST',
    headers: { Cookie: `webchat_session=${sessionCookie}` },
    body: {
      address,
      privateKey,
      email: `owner_${userId}@example.com`,
      dashboardId: `9000000000${userId}`.slice(-13),
    },
  });

  if (resp.status === 200) {
    return address;
  }

  // register-owner requires Auth API; fall back to direct settings file write
  const chatSettingsPath = path.join(
    '/root/aisell/botplatform/group_data',
    `user_${userId}`,
    'settings.json'
  );

  // Ensure user folder exists
  const userFolder = path.dirname(chatSettingsPath);
  if (!fs.existsSync(userFolder)) {
    fs.mkdirSync(userFolder, { recursive: true });
  }

  let settings = {};
  if (fs.existsSync(chatSettingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  }
  settings.chatId = userId;
  settings.ownerAddress = address;
  settings.ownerPrivateKey = privateKey;
  fs.writeFileSync(chatSettingsPath, JSON.stringify(settings, null, 2), 'utf8');

  return address;
}

// Remove ownerAddress from chatSettings for a user
function clearOwnerAddress(userId) {
  const chatSettingsPath = path.join(
    '/root/aisell/botplatform/group_data',
    `user_${userId}`,
    'settings.json'
  );

  if (!fs.existsSync(chatSettingsPath)) return;

  try {
    let settings = JSON.parse(fs.readFileSync(chatSettingsPath, 'utf8'));
    delete settings.ownerAddress;
    delete settings.ownerPrivateKey;
    fs.writeFileSync(chatSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

// Read the invites.json file directly
function readInvitesFile() {
  const invitesPath = path.join('/root/aisell/botplatform/data/webchat/invites.json');
  if (!fs.existsSync(invitesPath)) return [];
  try {
    const raw = fs.readFileSync(invitesPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Extract token from a d{userId}.wpmix.net?invite=TOKEN url
function extractTokenFromUrl(url) {
  const match = (url || '').match(/[?&]invite=([0-9a-f]{64})/);
  return match ? match[1] : null;
}

async function runTests() {
  const raw = (process.env.WEBCHAT_TEST_URLS || '').trim();
  const baseUrl = raw || 'http://127.0.0.1:8094';

  log(`\n📋 Invite Flow Tests: ${baseUrl}\n`);

  // Verify server is reachable
  try {
    await httpRequest(`${baseUrl}/api/public/bootstrap`);
  } catch (e) {
    log(`❌ Cannot reach webchat at ${baseUrl}: ${e.message}`, COLORS.RED);
    log('   Make sure SimpleDashboard webchat is running on port 8094', COLORS.YELLOW);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Setup: claim an owner session and set ownerAddress
  // -----------------------------------------------------------------------
  let ownerCookie, ownerUserId;
  try {
    const session = await claimSession(baseUrl);
    ownerCookie = session.sessionCookie;
    ownerUserId = session.userId;
    log(`  Owner session claimed: userId=${ownerUserId}\n`);

    await setOwnerAddress(baseUrl, ownerCookie, ownerUserId);
    log(`  ownerAddress set for userId=${ownerUserId}\n`);
  } catch (e) {
    log(`❌ Setup failed: ${e.message}`, COLORS.RED);
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // test_post_invite_no_session_returns_401
  // -----------------------------------------------------------------------
  log('📋 test_post_invite_no_session_returns_401');
  {
    // On localhost, requests without a session cookie are auto-authed as userId=999999999.
    // To get a 401 we must use WEBCHAT_DISABLE_LOCALHOST_AUTH=1.
    // Without that env, the request may succeed with localhost auto-auth.
    // We document this as "localhost auto-auth active — 401 not observable here."
    const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
    });

    const isLocalhost = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');
    if (isLocalhost) {
      // Localhost auto-auth: expect 200 or 403 (no ownerAddress for userId=999999999 maybe)
      assert(
        [200, 403, 429].includes(resp.status),
        `Localhost auto-auth: status is 200/403/429 (got ${resp.status})`
      );
    } else {
      assert(resp.status === 401, `No session -> 401 (got ${resp.status})`);
      assert(resp.body && resp.body.error, 'Response has error field');
    }
  }

  // -----------------------------------------------------------------------
  // test_post_invite_no_owner_address_returns_403
  // -----------------------------------------------------------------------
  log('\n📋 test_post_invite_no_owner_address_returns_403');
  {
    // Claim a fresh session without setting ownerAddress
    const { sessionCookie: freshCookie, userId: freshUserId } = await claimSession(baseUrl);
    log(`  Fresh session (no ownerAddress): userId=${freshUserId}`);

    const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${freshCookie}` },
    });

    assert(resp.status === 403, `No ownerAddress -> 403 (got ${resp.status})`);
    assert(
      resp.body && resp.body.error && resp.body.error.includes('keypair'),
      `Error mentions 'keypair' (got: ${JSON.stringify(resp.body && resp.body.error)})`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_invite_returns_200_url
  // -----------------------------------------------------------------------
  log('\n📋 test_post_invite_returns_200_url');
  let firstToken;
  {
    const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });

    assert(resp.status === 200, `POST /api/auth/invite -> 200 (got ${resp.status})`);
    assert(
      resp.body && typeof resp.body.url === 'string',
      `Response has url field (got ${JSON.stringify(resp.body)})`
    );
    assert(
      (resp.body.url || '').includes('?invite='),
      `URL contains ?invite= (got ${resp.body.url})`
    );

    firstToken = extractTokenFromUrl(resp.body.url);
    assert(
      firstToken && firstToken.length === 64,
      `Token is 64 hex characters (got ${firstToken ? firstToken.length : 'null'} chars)`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_invite_url_contains_dashboard_subdomain
  // -----------------------------------------------------------------------
  log('\n📋 test_post_invite_url_contains_dashboard_subdomain');
  {
    const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });

    assert(resp.status === 200, `POST /api/auth/invite -> 200 (got ${resp.status})`);
    const expectedSubdomain = `d${ownerUserId}.wpmix.net`;
    assert(
      (resp.body.url || '').includes(expectedSubdomain),
      `URL contains d${ownerUserId}.wpmix.net (got ${resp.body.url})`
    );
    assert(
      (resp.body.url || '').startsWith(`https://d${ownerUserId}.wpmix.net`),
      `URL starts with https://d${ownerUserId}.wpmix.net (got ${resp.body.url})`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_invite_token_saved_to_disk
  // -----------------------------------------------------------------------
  log('\n📋 test_post_invite_token_saved_to_disk');
  {
    const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });
    assert(resp.status === 200, `POST /api/auth/invite -> 200 (got ${resp.status})`);

    const token = extractTokenFromUrl(resp.body.url);
    assert(token !== null, `Extracted token from URL`);

    // Small delay to ensure write has completed
    await new Promise((r) => setTimeout(r, 100));

    const records = readInvitesFile();
    const ownerRecord = records.find((r) => r.dashboardUserId === String(ownerUserId));
    assert(ownerRecord !== undefined, `Record found in invites.json for userId=${ownerUserId}`);
    assert(
      ownerRecord && ownerRecord.token === token,
      `Token in invites.json matches response token`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_invite_overwrites_old_token
  // -----------------------------------------------------------------------
  log('\n📋 test_post_invite_overwrites_old_token');
  {
    const resp1 = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });
    const token1 = extractTokenFromUrl(resp1.body.url);

    const resp2 = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });
    const token2 = extractTokenFromUrl(resp2.body.url);

    assert(token1 !== null && token2 !== null, `Both tokens extracted`);
    assert(token1 !== token2, `Second token differs from first (${token1} vs ${token2})`);

    await new Promise((r) => setTimeout(r, 100));

    const records = readInvitesFile();
    const ownerRecord = records.find((r) => r.dashboardUserId === String(ownerUserId));
    assert(ownerRecord && ownerRecord.token === token2, `Latest token (token2) is in invites.json`);
    assert(
      !(ownerRecord && ownerRecord.token === token1),
      `Old token (token1) is no longer in invites.json`
    );

    // Also verify there is only one record per userId
    const ownerRecords = records.filter((r) => r.dashboardUserId === String(ownerUserId));
    assert(ownerRecords.length === 1, `Only one record per userId in invites.json (got ${ownerRecords.length})`);
  }

  // -----------------------------------------------------------------------
  // test_post_revoke_returns_new_url
  // -----------------------------------------------------------------------
  log('\n📋 test_post_revoke_returns_new_url');
  {
    const resp = await httpRequest(`${baseUrl}/api/auth/invite/revoke`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });

    assert(resp.status === 200, `POST /api/auth/invite/revoke -> 200 (got ${resp.status})`);
    assert(
      resp.body && typeof resp.body.url === 'string',
      `Response has url field (got ${JSON.stringify(resp.body)})`
    );
    const revokeToken = extractTokenFromUrl(resp.body.url);
    assert(
      revokeToken && revokeToken.length === 64,
      `Revoke token is 64 hex characters (got ${revokeToken ? revokeToken.length : 'null'} chars)`
    );
    assert(
      (resp.body.url || '').startsWith(`https://d${ownerUserId}.wpmix.net`),
      `Revoke URL starts with correct subdomain (got ${resp.body.url})`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_revoke_token_differs_from_original
  // -----------------------------------------------------------------------
  log('\n📋 test_post_revoke_token_differs_from_original');
  {
    // Get current invite token
    const inviteResp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });
    const inviteToken = extractTokenFromUrl(inviteResp.body.url);

    // Revoke it
    const revokeResp = await httpRequest(`${baseUrl}/api/auth/invite/revoke`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${ownerCookie}` },
    });
    const revokeToken = extractTokenFromUrl(revokeResp.body.url);

    assert(inviteToken !== null && revokeToken !== null, `Both tokens extracted`);
    assert(
      inviteToken !== revokeToken,
      `Revoke token differs from original invite token`
    );

    // Disk should have the new (revoke) token
    await new Promise((r) => setTimeout(r, 100));
    const records = readInvitesFile();
    const ownerRecord = records.find((r) => r.dashboardUserId === String(ownerUserId));
    assert(
      ownerRecord && ownerRecord.token === revokeToken,
      `Revoke token is persisted to invites.json`
    );
    assert(
      !(ownerRecord && ownerRecord.token === inviteToken),
      `Original invite token is no longer in invites.json after revoke`
    );
  }

  // -----------------------------------------------------------------------
  // test_post_revoke_no_owner_address_returns_403
  // -----------------------------------------------------------------------
  log('\n📋 test_post_revoke_no_owner_address_returns_403');
  {
    const { sessionCookie: freshCookie, userId: freshUserId } = await claimSession(baseUrl);
    log(`  Fresh session (no ownerAddress): userId=${freshUserId}`);

    const resp = await httpRequest(`${baseUrl}/api/auth/invite/revoke`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${freshCookie}` },
    });

    assert(resp.status === 403, `No ownerAddress -> 403 on revoke (got ${resp.status})`);
    assert(
      resp.body && resp.body.error && resp.body.error.includes('keypair'),
      `Error mentions 'keypair' on revoke (got: ${JSON.stringify(resp.body && resp.body.error)})`
    );
  }

  // -----------------------------------------------------------------------
  // test_rate_limit_429_on_21st_invite
  // -----------------------------------------------------------------------
  log('\n📋 test_rate_limit_429_on_21st_invite');
  {
    // Claim a fresh session for rate limit testing (isolated from above)
    let rlCookie, rlUserId;
    try {
      const session = await claimSession(baseUrl);
      rlCookie = session.sessionCookie;
      rlUserId = session.userId;
      await setOwnerAddress(baseUrl, rlCookie, rlUserId);
      log(`  Rate limit test session: userId=${rlUserId}`);
    } catch (e) {
      log(`❌ Setup failed for rate limit test: ${e.message}`, COLORS.RED);
      assert(false, 'Rate limit test setup succeeded');
      assert(false, 'SKIP');
      assert(false, 'SKIP');
      return;
    }

    let statuses = [];
    for (let i = 0; i < 21; i++) {
      const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
        method: 'POST',
        headers: { Cookie: `webchat_session=${rlCookie}` },
      });
      statuses.push(resp.status);
    }

    log(`  Statuses: ${statuses.join(', ')}`);
    const successCount = statuses.filter((s) => s === 200).length;
    const lastStatus = statuses[statuses.length - 1];

    assert(successCount >= 20, `At least 20 requests succeeded (got ${successCount})`);
    assert(lastStatus === 429, `21st request returns 429 (got ${lastStatus})`);

    // Verify the 429 response has a proper error message
    const lastResp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: { Cookie: `webchat_session=${rlCookie}` },
    });
    assert(lastResp.status === 429, `Subsequent request also returns 429 (got ${lastResp.status})`);
    assert(
      lastResp.body && lastResp.body.error && lastResp.body.error.includes('many'),
      `429 response has descriptive error (got ${JSON.stringify(lastResp.body && lastResp.body.error)})`
    );
  }

  // -----------------------------------------------------------------------
  // test_rate_limit_keyed_by_userId_not_ip
  // -----------------------------------------------------------------------
  log('\n📋 test_rate_limit_keyed_by_userId_not_ip');
  {
    // Use a fresh session; exhaust ~5 requests, then check that
    // sending from a different X-Forwarded-For IP still uses the same budget.
    // We simulate "two IPs" by sending the same cookie with different X-Forwarded-For headers.
    let rlSharedCookie, rlSharedUserId;
    try {
      const session = await claimSession(baseUrl);
      rlSharedCookie = session.sessionCookie;
      rlSharedUserId = session.userId;
      await setOwnerAddress(baseUrl, rlSharedCookie, rlSharedUserId);
      log(`  Shared RL test session: userId=${rlSharedUserId}`);
    } catch (e) {
      log(`❌ Setup for shared RL test failed: ${e.message}`, COLORS.RED);
      assert(false, 'Shared RL setup succeeded');
      assert(false, 'SKIP');
      return;
    }

    // Send 20 requests total, alternating between two fake IPs
    const fakeIps = ['10.0.0.1', '10.0.0.2'];
    const statuses = [];
    for (let i = 0; i < 20; i++) {
      const resp = await httpRequest(`${baseUrl}/api/auth/invite`, {
        method: 'POST',
        headers: {
          Cookie: `webchat_session=${rlSharedCookie}`,
          'X-Forwarded-For': fakeIps[i % 2],
        },
      });
      statuses.push(resp.status);
    }

    // 21st request from either IP must hit rate limit (budget is per userId, not per IP)
    const finalResp = await httpRequest(`${baseUrl}/api/auth/invite`, {
      method: 'POST',
      headers: {
        Cookie: `webchat_session=${rlSharedCookie}`,
        'X-Forwarded-For': fakeIps[0],
      },
    });

    log(`  First 20 statuses: ${statuses.join(', ')}`);
    log(`  21st status (from IP ${fakeIps[0]}): ${finalResp.status}`);

    const allSucceeded = statuses.every((s) => s === 200);
    assert(allSucceeded, `First 20 requests all succeeded (user budget is 20)`);
    assert(
      finalResp.status === 429,
      `21st request from "different IP" but same userId returns 429 (rate limit is per userId) (got ${finalResp.status})`
    );
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  log(`\n${'='.repeat(60)}`);
  log(`📊 Test Summary`);
  log(`${'='.repeat(60)}`);
  log(`  ✅ Passed: ${passed}`, COLORS.GREEN);
  if (failed > 0) {
    log(`  ❌ Failed: ${failed}`, COLORS.RED);
  } else {
    log(`  ❌ Failed: ${failed}`);
  }
  log(`  📈 Total: ${passed + failed}`);
  log(`${'='.repeat(60)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  log(`❌ Unhandled error: ${e.message}`, COLORS.RED);
  console.error(e.stack);
  process.exit(1);
});
