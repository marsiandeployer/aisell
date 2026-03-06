#!/usr/bin/env node
/**
 * Integration tests for SD SDK methods and aliases.
 *
 * Tests all new SDK methods by making real HTTP requests to the running
 * simpledashboard-web server. The SDK is a thin wrapper around fetch() calls
 * to /api/data/ endpoints, so we test the underlying HTTP endpoints directly.
 *
 * Test groups:
 *   1. Backward compat — GET/POST/PUT/DELETE /api/data/{col} work as before
 *   2. Aliases        — create/update/patch/delete/list return expected responses
 *   3. getOne         — GET /api/data/{col}/{id} returns single object or null
 *   4. Upsert         — POST twice with same key field, GET shows 1 record
 *   5. getMembers     — GET /api/data/members returns array
 *   6. removeMember   — DELETE from members collection works
 *
 * Prerequisites:
 *   - simpledashboard-web running on port 8094
 *   - JWT_SECRET available (from .env.auth)
 *   - Dashboard 9000000000281 exists with ownerAddress set
 *
 * Usage:
 *   export $(cat .env.auth | xargs) && node tests/test_sdk_methods.js
 *   # or:
 *   JWT_SECRET=<secret> node tests/test_sdk_methods.js
 *
 * Run from: /root/aisell/botplatform/
 */

'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');

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
        let body;
        try { body = JSON.parse(data); } catch { body = { _raw: data }; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// Small delay to avoid overwhelming the server
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://127.0.0.1:8094';
const DASHBOARD_USER_ID = '9000000000281';
const DASHBOARD_ID = `d${DASHBOARD_USER_ID}`;
const HOST_HEADER = `${DASHBOARD_ID}.wpmix.net`;

// Test collection names (cleaned up after tests)
const COL_COMPAT = 'test_sdk_compat';
const COL_GETONE = 'test_sdk_getone';
const COL_UPSERT = 'test_sdk_upsert';
const COL_MEMBERS_TEST = 'test_sdk_members';

// Load JWT_SECRET from env (sourced from .env.auth)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[ERROR] JWT_SECRET env variable is required.');
  console.error('Run: export $(cat .env.auth | xargs) && node tests/test_sdk_methods.js');
  process.exit(1);
}

// Sign a JWT for our test dashboard
const AUTH_TOKEN = jwt.sign(
  { dashboardId: DASHBOARD_ID },
  JWT_SECRET,
  { expiresIn: '1h' }
);

// Helper: build headers with Host and Authorization
function authHeaders() {
  return {
    Host: HOST_HEADER,
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

// Helper: API request to /api/data/ with auth
function apiGet(collection, itemId) {
  const pathSuffix = itemId
    ? `${encodeURIComponent(collection)}/${encodeURIComponent(itemId)}`
    : encodeURIComponent(collection);
  return httpRequest(`${BASE_URL}/api/data/${pathSuffix}`, {
    method: 'GET',
    headers: authHeaders(),
  });
}

function apiPost(collection, item) {
  return httpRequest(`${BASE_URL}/api/data/${encodeURIComponent(collection)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: item,
  });
}

function apiPut(collection, id, item) {
  return httpRequest(`${BASE_URL}/api/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: item,
  });
}

function apiDelete(collection, id) {
  const pathSuffix = id
    ? `${encodeURIComponent(collection)}/${encodeURIComponent(id)}`
    : encodeURIComponent(collection);
  return httpRequest(`${BASE_URL}/api/data/${pathSuffix}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

// Clear a test collection (DELETE without itemId)
async function clearCollection(collection) {
  await apiDelete(collection);
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function testBackwardCompat() {
  section('--- Group 1: Backward Compatibility (GET/POST/PUT/DELETE) ---');

  // Clean slate
  await clearCollection(COL_COMPAT);

  // 1a. GET empty collection -> []
  const getEmpty = await apiGet(COL_COMPAT);
  assert(getEmpty.status === 200, `GET empty collection -> 200 (got ${getEmpty.status})`);
  assert(Array.isArray(getEmpty.body) && getEmpty.body.length === 0, `GET empty collection -> [] (got ${JSON.stringify(getEmpty.body)})`);

  // 1b. POST creates item with generated id
  const postRes = await apiPost(COL_COMPAT, { name: 'Test Item', value: 42 });
  assert(postRes.status === 201, `POST -> 201 (got ${postRes.status})`);
  assert(postRes.body && typeof postRes.body.id === 'string', `POST response has id (got ${JSON.stringify(postRes.body)})`);
  assert(postRes.body.name === 'Test Item', `POST response has correct name`);
  assert(postRes.body.value === 42, `POST response has correct value`);

  const itemId = postRes.body.id;

  // 1c. GET collection after POST -> 1 item
  const getAfterPost = await apiGet(COL_COMPAT);
  assert(getAfterPost.status === 200, `GET after POST -> 200`);
  assert(Array.isArray(getAfterPost.body) && getAfterPost.body.length === 1, `GET after POST -> 1 item`);
  assert(getAfterPost.body[0].id === itemId, `GET returns item with correct id`);

  // 1d. PUT updates item
  const putRes = await apiPut(COL_COMPAT, itemId, { name: 'Updated Item', value: 99 });
  assert(putRes.status === 200, `PUT -> 200 (got ${putRes.status})`);
  assert(putRes.body.name === 'Updated Item', `PUT response has updated name`);
  assert(putRes.body.value === 99, `PUT response has updated value`);
  assert(putRes.body.id === itemId, `PUT preserves item id`);

  // 1e. PUT non-existent item -> 404
  const putMissing = await apiPut(COL_COMPAT, 'nonexistent_xyz_123', { name: 'Ghost' });
  assert(putMissing.status === 404, `PUT nonexistent item -> 404 (got ${putMissing.status})`);

  // 1f. DELETE item
  const delRes = await apiDelete(COL_COMPAT, itemId);
  assert(delRes.status === 200, `DELETE -> 200 (got ${delRes.status})`);
  assert(delRes.body && delRes.body.deleted === itemId, `DELETE response has { deleted: id } (got ${JSON.stringify(delRes.body)})`);

  // 1g. GET after DELETE -> []
  const getAfterDel = await apiGet(COL_COMPAT);
  assert(getAfterDel.body.length === 0, `GET after DELETE -> [] (got ${getAfterDel.body.length} items)`);

  // Cleanup
  await clearCollection(COL_COMPAT);
}

async function testAliases() {
  section('--- Group 2: Aliases (list/create/update/patch/delete) ---');

  // Since aliases are SDK-level (client JS), they call the same HTTP endpoints.
  // We verify the endpoint behavior matches what each alias would produce.

  await clearCollection(COL_COMPAT);

  // 2a. list = GET (same as SD.data.list -> SD.data.get)
  const listRes = await apiGet(COL_COMPAT);
  assert(listRes.status === 200, `list (GET) -> 200`);
  assert(Array.isArray(listRes.body), `list (GET) -> array`);

  // 2b. create = POST (same as SD.data.create -> SD.data.post)
  const createRes = await apiPost(COL_COMPAT, { title: 'Created via alias', done: false });
  assert(createRes.status === 201, `create (POST) -> 201 (got ${createRes.status})`);
  assert(createRes.body && typeof createRes.body.id === 'string', `create returns object with id`);
  assert(createRes.body.title === 'Created via alias', `create returns correct data`);

  const createdId = createRes.body.id;

  // 2c. update = PUT (same as SD.data.update -> SD.data.put)
  const updateRes = await apiPut(COL_COMPAT, createdId, { title: 'Updated via alias', done: true });
  assert(updateRes.status === 200, `update (PUT) -> 200`);
  assert(updateRes.body.title === 'Updated via alias', `update returns updated data`);
  assert(updateRes.body.done === true, `update returns updated field`);
  assert(updateRes.body.id === createdId, `update preserves id`);

  // 2d. patch = PUT (same as SD.data.patch -> SD.data.put)
  //     patch is partial update; backend merges fields
  const patchRes = await apiPut(COL_COMPAT, createdId, { priority: 'high' });
  assert(patchRes.status === 200, `patch (PUT) -> 200`);
  assert(patchRes.body.priority === 'high', `patch adds new field`);
  assert(patchRes.body.title === 'Updated via alias', `patch preserves existing fields`);
  assert(patchRes.body.id === createdId, `patch preserves id`);

  // 2e. delete = DELETE (same as SD.data.delete -> SD.data.del)
  const deleteRes = await apiDelete(COL_COMPAT, createdId);
  assert(deleteRes.status === 200, `delete (DELETE) -> 200`);
  assert(deleteRes.body && deleteRes.body.deleted === createdId, `delete returns { deleted: id }`);

  // Verify item is gone
  const verifyGone = await apiGet(COL_COMPAT);
  assert(verifyGone.body.length === 0, `After delete, collection is empty`);

  // Cleanup
  await clearCollection(COL_COMPAT);
}

async function testGetOne() {
  section('--- Group 3: getOne (GET /api/data/{col}/{id}) ---');

  await clearCollection(COL_GETONE);

  // 3a. Create a test item first
  const createRes = await apiPost(COL_GETONE, { name: 'Single Item', status: 'active' });
  assert(createRes.status === 201, `Setup: created test item`);
  const itemId = createRes.body.id;

  // 3b. getOne with existing id -> single object (not array)
  const getOneRes = await apiGet(COL_GETONE, itemId);
  assert(getOneRes.status === 200, `getOne existing -> 200 (got ${getOneRes.status})`);
  assert(getOneRes.body !== null && typeof getOneRes.body === 'object', `getOne returns an object`);
  assert(!Array.isArray(getOneRes.body), `getOne returns object, NOT array`);
  assert(getOneRes.body.id === itemId, `getOne returns correct id`);
  assert(getOneRes.body.name === 'Single Item', `getOne returns correct data`);
  assert(getOneRes.body.status === 'active', `getOne returns all fields`);

  // 3c. getOne with nonexistent id -> null (HTTP 200)
  const getOneNull = await apiGet(COL_GETONE, 'nonexistent_id_xyz_999');
  assert(getOneNull.status === 200, `getOne nonexistent -> 200 (got ${getOneNull.status})`);
  assert(getOneNull.body === null, `getOne nonexistent -> null (got ${JSON.stringify(getOneNull.body)})`);

  // 3d. getOne on empty collection -> null
  await clearCollection(COL_GETONE);
  const getOneEmpty = await apiGet(COL_GETONE, 'any_id');
  assert(getOneEmpty.status === 200, `getOne on empty collection -> 200`);
  assert(getOneEmpty.body === null, `getOne on empty collection -> null`);

  // Cleanup
  await clearCollection(COL_GETONE);
}

async function testUpsert() {
  section('--- Group 4: Upsert Logic (POST + PUT simulate client-side upsert) ---');

  // upsert is client-side: GET -> find by keyField -> PUT (update) or POST (create).
  // We simulate this by doing the sequence manually via HTTP.

  await clearCollection(COL_UPSERT);

  // 4a. First "upsert" — no existing record -> POST (create)
  const email = 'upsert_test@example.com';
  const createRes = await apiPost(COL_UPSERT, { email, name: 'Alice', visits: 1 });
  assert(createRes.status === 201, `Upsert create -> 201`);
  assert(createRes.body.email === email, `Upsert create has correct email`);
  const createdId = createRes.body.id;

  // 4b. Verify exactly 1 record
  const getAfterCreate = await apiGet(COL_UPSERT);
  assert(getAfterCreate.body.length === 1, `After first upsert -> 1 record`);

  // 4c. Second "upsert" — simulate: GET -> find by email -> PUT
  //     This is what SDK.data.upsert('col', 'email', data) does internally
  const allItems = getAfterCreate.body;
  const found = allItems.find((item) => item.email === email);
  assert(found !== undefined, `Found existing record by email key`);
  assert(found.id === createdId, `Found record has correct id`);

  // Update via PUT (as upsert would)
  const updateRes = await apiPut(COL_UPSERT, found.id, { email, name: 'Alice Updated', visits: 2 });
  assert(updateRes.status === 200, `Upsert update -> 200`);
  assert(updateRes.body.name === 'Alice Updated', `Upsert update has new name`);
  assert(updateRes.body.visits === 2, `Upsert update has new visits`);

  // 4d. Verify still exactly 1 record (not 2)
  const getAfterUpdate = await apiGet(COL_UPSERT);
  assert(getAfterUpdate.body.length === 1, `After upsert update -> still 1 record (not 2)`);
  assert(getAfterUpdate.body[0].name === 'Alice Updated', `Record has updated name`);
  assert(getAfterUpdate.body[0].id === createdId, `Record id unchanged after upsert`);

  // 4e. Upsert with different email -> creates new record (no match)
  const createRes2 = await apiPost(COL_UPSERT, { email: 'bob@example.com', name: 'Bob', visits: 1 });
  assert(createRes2.status === 201, `Upsert new key -> 201 (create)`);

  const getAfterBob = await apiGet(COL_UPSERT);
  assert(getAfterBob.body.length === 2, `After upsert with new key -> 2 records`);

  // Cleanup
  await clearCollection(COL_UPSERT);
}

async function testGetMembers() {
  section('--- Group 5: getMembers (GET /api/data/members) ---');

  // SD.admin.getMembers() calls SD.data.get('members') + enriches with isOwner.
  // The isOwner enrichment is client-side, so we can only test the HTTP part:
  // GET /api/data/members returns an array.

  // We use a separate test collection to avoid polluting real members data
  await clearCollection(COL_MEMBERS_TEST);

  // 5a. Empty members collection -> empty array
  const emptyRes = await apiGet(COL_MEMBERS_TEST);
  assert(emptyRes.status === 200, `GET empty members -> 200`);
  assert(Array.isArray(emptyRes.body), `GET empty members -> array`);
  assert(emptyRes.body.length === 0, `GET empty members -> length 0`);

  // 5b. Add test members
  const member1 = await apiPost(COL_MEMBERS_TEST, { email: 'owner@example.com', name: 'Owner', role: 'admin' });
  assert(member1.status === 201, `Added member 1`);

  const member2 = await apiPost(COL_MEMBERS_TEST, { email: 'viewer@example.com', name: 'Viewer', role: 'viewer' });
  assert(member2.status === 201, `Added member 2`);

  // 5c. GET members -> 2 records
  const membersRes = await apiGet(COL_MEMBERS_TEST);
  assert(membersRes.status === 200, `GET members -> 200`);
  assert(membersRes.body.length === 2, `GET members -> 2 records`);
  assert(membersRes.body[0].email !== undefined, `Members have email field`);

  // 5d. Also verify real 'members' collection is accessible
  const realMembers = await apiGet('members');
  assert(realMembers.status === 200, `GET real members collection -> 200`);
  assert(Array.isArray(realMembers.body), `Real members collection is array`);

  // Cleanup test collection
  await clearCollection(COL_MEMBERS_TEST);
}

async function testRemoveMember() {
  section('--- Group 6: removeMember (DELETE from members by id) ---');

  // SD.admin.removeMember(email) does:
  //   1. GET members -> find by email -> DELETE by id
  //   2. revokeAccess(email) via Auth API
  // We test the data layer part (steps 1 above) via HTTP.

  await clearCollection(COL_MEMBERS_TEST);

  // 6a. Add a member to remove
  const addRes = await apiPost(COL_MEMBERS_TEST, { email: 'toremove@example.com', name: 'Remove Me' });
  assert(addRes.status === 201, `Added member for removal`);
  const memberId = addRes.body.id;

  // 6b. Verify member exists
  const beforeDel = await apiGet(COL_MEMBERS_TEST);
  assert(beforeDel.body.length === 1, `1 member before removal`);

  // 6c. Simulate removeMember: GET -> find by email -> DELETE by id
  const foundMember = beforeDel.body.find((m) => m.email === 'toremove@example.com');
  assert(foundMember !== undefined, `Found member by email`);
  assert(foundMember.id === memberId, `Found member has correct id`);

  const delRes = await apiDelete(COL_MEMBERS_TEST, foundMember.id);
  assert(delRes.status === 200, `DELETE member -> 200`);
  assert(delRes.body.deleted === memberId, `DELETE returns { deleted: id }`);

  // 6d. Verify member is gone
  const afterDel = await apiGet(COL_MEMBERS_TEST);
  assert(afterDel.body.length === 0, `0 members after removal`);

  // 6e. getOne for removed member -> null
  const removedCheck = await apiGet(COL_MEMBERS_TEST, memberId);
  assert(removedCheck.body === null, `getOne for removed member -> null`);

  // Cleanup
  await clearCollection(COL_MEMBERS_TEST);
}

async function testStatusCodes() {
  section('--- Group 7: Status Codes ---');

  await clearCollection(COL_COMPAT);

  // 7a. POST -> 201
  const postRes = await apiPost(COL_COMPAT, { check: 'status' });
  assert(postRes.status === 201, `POST -> 201 Created`);
  const id = postRes.body.id;

  // 7b. GET collection -> 200
  const getRes = await apiGet(COL_COMPAT);
  assert(getRes.status === 200, `GET collection -> 200 OK`);

  // 7c. GET item (getOne) -> 200
  const getOneRes = await apiGet(COL_COMPAT, id);
  assert(getOneRes.status === 200, `GET item -> 200 OK`);

  // 7d. PUT -> 200
  const putRes = await apiPut(COL_COMPAT, id, { check: 'updated' });
  assert(putRes.status === 200, `PUT -> 200 OK`);

  // 7e. DELETE -> 200
  const delRes = await apiDelete(COL_COMPAT, id);
  assert(delRes.status === 200, `DELETE item -> 200 OK`);

  // 7f. DELETE collection (clear) -> 200
  const clearRes = await apiDelete(COL_COMPAT);
  assert(clearRes.status === 200, `DELETE collection (clear) -> 200 OK`);
  assert(clearRes.body && clearRes.body.cleared === true, `Clear returns { cleared: true }`);

  // 7g. Invalid collection name -> 400
  const badCol = await httpRequest(`${BASE_URL}/api/data/${'a'.repeat(100)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  assert(badCol.status === 400, `Invalid collection name -> 400 (got ${badCol.status})`);

  // 7h. PUT nonexistent item -> 404
  const putMissing = await apiPut(COL_COMPAT, 'no_such_id', { check: 'ghost' });
  assert(putMissing.status === 404, `PUT nonexistent -> 404 (got ${putMissing.status})`);

  // 7i. No Authorization on protected dashboard -> 401
  const noAuthRes = await httpRequest(`${BASE_URL}/api/data/${COL_COMPAT}`, {
    method: 'GET',
    headers: { Host: HOST_HEADER },
  });
  assert(noAuthRes.status === 401, `No auth on protected dashboard -> 401 (got ${noAuthRes.status})`);

  // Cleanup
  await clearCollection(COL_COMPAT);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`\n${'='.repeat(60)}`);
  log(`  SD SDK Methods — Integration Tests`);
  log(`  Server: ${BASE_URL}`);
  log(`  Dashboard: ${DASHBOARD_ID} (${HOST_HEADER})`);
  log(`${'='.repeat(60)}`);

  // Verify server is reachable
  try {
    await httpRequest(`${BASE_URL}/`, { method: 'GET', headers: {} });
  } catch (e) {
    log(`\n[FATAL] Cannot reach server at ${BASE_URL}: ${e.message}`, COLORS.RED);
    log('Make sure simpledashboard-web is running on port 8094', COLORS.YELLOW);
    process.exit(1);
  }

  // Verify auth works (quick sanity check)
  const authCheck = await apiGet(COL_COMPAT);
  if (authCheck.status === 401) {
    log('\n[FATAL] JWT auth failed. Check JWT_SECRET matches the running server.', COLORS.RED);
    process.exit(1);
  }

  try {
    await testBackwardCompat();
    await delay(50);
    await testAliases();
    await delay(50);
    await testGetOne();
    await delay(50);
    await testUpsert();
    await delay(50);
    await testGetMembers();
    await delay(50);
    await testRemoveMember();
    await delay(50);
    await testStatusCodes();
  } finally {
    // Final cleanup: ensure all test collections are cleared
    section('--- Cleanup ---');
    const testCollections = [COL_COMPAT, COL_GETONE, COL_UPSERT, COL_MEMBERS_TEST];
    for (const col of testCollections) {
      try {
        await clearCollection(col);
      } catch {
        // Ignore cleanup errors
      }
    }
    log('  Test collections cleared.', COLORS.YELLOW);
  }

  // Summary
  log(`\n${'='.repeat(60)}`);
  log(`  Test Summary`);
  log(`${'='.repeat(60)}`);
  log(`  Passed: ${passed}`, COLORS.GREEN);
  if (failed > 0) {
    log(`  Failed: ${failed}`, COLORS.RED);
    log(`\n  Failures:`, COLORS.RED);
    for (const f of failures) {
      log(`    - ${f}`, COLORS.RED);
    }
  } else {
    log(`  Failed: ${failed}`);
  }
  log(`  Total:  ${passed + failed}`);
  log(`${'='.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`\n[FATAL] ${err.message}`, COLORS.RED);
  console.error(err);
  process.exit(1);
});
