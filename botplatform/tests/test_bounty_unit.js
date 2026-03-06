#!/usr/bin/env node
/**
 * Unit tests for Bounty Escrow logic (Task 3).
 *
 * These are autonomous tests — no HTTP, no real filesystem.
 * File I/O is mocked via dependency injection: readJsonFile / writeJsonAtomic
 * are replaced with in-memory stubs.
 *
 * Test cases:
 *   escrow_debit_success         — debit at balance(100) > reward(50)
 *   escrow_debit_exact           — debit at balance(50) === reward(50)
 *   escrow_debit_insufficient    — debit at balance(30) < reward(50) → 402
 *   escrow_debit_rollback        — post-write balance < 0 → rollback, 409
 *   escrow_cold_start            — readEscrow with ENOENT → default { balance: 0 }
 *   escrow_deposit_negative      — deposit with amount=-1 → 400
 *   escrow_deposit_zero          — deposit with amount=0  → 400
 *   escrow_balance_warning       — balance=0 → { balance: 0, warning: true }
 *   escrow_tx_initiated_by       — debit with initiatedBy='auto-approve' → tx has it
 *
 * Usage:
 *   cd /root/aisell/botplatform && node tests/test_bounty_unit.js
 */

'use strict';

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

// ─── Mock File System ─────────────────────────────────────────────────────────

/**
 * Creates a mock file system for escrow tests.
 * Returns { readJsonFile, writeJsonAtomic, getFiles } where getFiles()
 * returns the in-memory file map for assertions.
 */
function createMockFs(initialFiles = {}) {
  // Deep clone initial files to avoid mutation issues
  const files = {};
  for (const [k, v] of Object.entries(initialFiles)) {
    files[k] = JSON.parse(JSON.stringify(v));
  }

  function readJsonFile(filePath, fallback) {
    if (filePath in files) {
      // Deep clone to prevent external mutation
      return JSON.parse(JSON.stringify(files[filePath]));
    }
    return fallback;
  }

  function writeJsonAtomic(filePath, value) {
    files[filePath] = JSON.parse(JSON.stringify(value));
  }

  return { readJsonFile, writeJsonAtomic, getFiles: () => files };
}

// ─── Escrow Logic (extracted for unit testing) ────────────────────────────────

/**
 * Pure escrow logic functions that accept file I/O as parameters.
 * This mirrors the structure in bounty-api.ts but allows mocking.
 */

function getEscrowPath(workspacesRoot, creatorId, campaignId) {
  return `${workspacesRoot}/user_${creatorId}/data/escrow_${campaignId}.json`;
}

function readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId) {
  const filePath = getEscrowPath(workspacesRoot, creatorId, campaignId);
  return readJsonFileFn(filePath, { campaignId, balance: 0, transactions: [] });
}

function writeEscrow(writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, escrow) {
  const filePath = getEscrowPath(workspacesRoot, creatorId, campaignId);
  writeJsonAtomicFn(filePath, escrow);
}

/**
 * Deposit: validates amount > 0, adds to escrow balance, records transaction.
 * Returns { status, balance } or { status, error }.
 */
function deposit(readJsonFileFn, writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { status: 400, error: 'amount must be a positive number greater than 0' };
  }

  const escrow = readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId);
  escrow.balance += amount;
  escrow.transactions.push({
    type: 'deposit',
    amount,
    ref: 'manual',
    initiatedBy: 'creator',
    createdAt: new Date().toISOString(),
  });
  writeEscrow(writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, escrow);
  return { status: 200, balance: escrow.balance };
}

/**
 * Get balance: returns { balance, warning? }.
 */
function getBalance(readJsonFileFn, workspacesRoot, creatorId, campaignId) {
  const escrow = readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId);
  const result = { balance: escrow.balance };
  if (escrow.balance === 0) {
    result.warning = true;
  }
  return result;
}

/**
 * Debit: atomic read-modify-write with post-write rollback.
 * Returns { status, balance } on success.
 * Throws error-like object with { status: 402 | 409 } on failure.
 */
function debit(readJsonFileFn, writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, amount, ref, initiatedBy) {
  // Read snapshot for rollback
  const snapshot = readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId);

  // Pre-check: insufficient funds
  if (snapshot.balance < amount) {
    const err = new Error('Insufficient escrow balance');
    err.status = 402;
    throw err;
  }

  // Modify
  const escrow = readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId);
  escrow.balance -= amount;
  escrow.transactions.push({
    type: 'debit',
    amount,
    ref,
    initiatedBy,
    createdAt: new Date().toISOString(),
  });

  // Write
  writeEscrow(writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, escrow);

  // Post-write check: re-read and verify balance >= 0
  const check = readEscrow(readJsonFileFn, workspacesRoot, creatorId, campaignId);
  if (check.balance < 0) {
    // Rollback: restore snapshot
    writeEscrow(writeJsonAtomicFn, workspacesRoot, creatorId, campaignId, snapshot);
    const err = new Error('Concurrent debit detected, rollback applied');
    err.status = 409;
    throw err;
  }

  return { status: 200, balance: check.balance };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  log('\n============================================================', COLORS.CYAN);
  log('  Bounty Escrow Unit Tests (Task 3)', COLORS.CYAN);
  log('============================================================', COLORS.CYAN);

  const WORKSPACES_ROOT = '/fake/group_data';
  const CREATOR_ID = 123;
  const CAMPAIGN_ID = 'camp-001';

  // ─── escrow_debit_success ─────────────────────────────────────────
  section('escrow_debit_success — debit at balance(100) > reward(50)');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 100, transactions: [] },
    });

    const result = debit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      50, 'sub-001', 'creator'
    );

    assert(result.status === 200, 'debit returns status 200');
    assert(result.balance === 50, 'balance is 50 after debiting 50 from 100');

    const savedEscrow = mockFs.getFiles()[escrowPath];
    assert(savedEscrow.balance === 50, 'saved escrow balance is 50');
    assert(savedEscrow.transactions.length === 1, 'one transaction recorded');
    assert(savedEscrow.transactions[0].type === 'debit', 'transaction type is debit');
    assert(savedEscrow.transactions[0].amount === 50, 'transaction amount is 50');
    assert(savedEscrow.transactions[0].ref === 'sub-001', 'transaction ref is sub-001');
    assert(savedEscrow.transactions[0].initiatedBy === 'creator', 'initiatedBy is creator');
  }

  // ─── escrow_debit_exact ───────────────────────────────────────────
  section('escrow_debit_exact — debit at balance(50) === reward(50)');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 50, transactions: [] },
    });

    const result = debit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      50, 'sub-002', 'creator'
    );

    assert(result.status === 200, 'debit returns status 200');
    assert(result.balance === 0, 'balance is 0 after debiting exact amount');

    const savedEscrow = mockFs.getFiles()[escrowPath];
    assert(savedEscrow.balance === 0, 'saved escrow balance is 0');
    assert(savedEscrow.transactions.length === 1, 'one transaction recorded');
  }

  // ─── escrow_debit_insufficient ────────────────────────────────────
  section('escrow_debit_insufficient — debit at balance(30) < reward(50)');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 30, transactions: [] },
    });

    let thrownError = null;
    try {
      debit(
        mockFs.readJsonFile, mockFs.writeJsonAtomic,
        WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
        50, 'sub-003', 'creator'
      );
    } catch (err) {
      thrownError = err;
    }

    assert(thrownError !== null, 'debit throws error');
    assert(thrownError.status === 402, 'error status is 402 (Payment Required)');

    // Balance must not have changed
    const savedEscrow = mockFs.getFiles()[escrowPath];
    assert(savedEscrow.balance === 30, 'balance unchanged at 30 (pre-check prevented write)');
    assert(savedEscrow.transactions.length === 0, 'no transactions recorded');
  }

  // ─── escrow_debit_rollback ────────────────────────────────────────
  section('escrow_debit_rollback — post-write balance < 0 → rollback 409');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    // We simulate a race condition by having the write succeed,
    // but then having the re-read return a negative balance.
    // We achieve this by making readJsonFile return different values on successive calls.
    let readCount = 0;
    const originalEscrow = { campaignId: CAMPAIGN_ID, balance: 50, transactions: [] };
    let lastWritten = null;

    function raceReadJsonFile(filePath, fallback) {
      readCount++;
      if (readCount === 1) {
        // First read (snapshot): balance = 50
        return JSON.parse(JSON.stringify(originalEscrow));
      } else if (readCount === 2) {
        // Second read (for modification): balance = 50
        return JSON.parse(JSON.stringify(originalEscrow));
      } else if (readCount === 3) {
        // Third read (post-write check): simulate concurrent debit made balance negative
        return { campaignId: CAMPAIGN_ID, balance: -10, transactions: [] };
      }
      return fallback;
    }

    function raceWriteJsonAtomic(filePath, value) {
      lastWritten = JSON.parse(JSON.stringify(value));
    }

    let thrownError = null;
    try {
      debit(
        raceReadJsonFile, raceWriteJsonAtomic,
        WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
        50, 'sub-004', 'creator'
      );
    } catch (err) {
      thrownError = err;
    }

    assert(thrownError !== null, 'debit throws error on race condition');
    assert(thrownError.status === 409, 'error status is 409 (Conflict)');
    // The last write should be the rollback (original snapshot)
    assert(lastWritten !== null, 'rollback write was performed');
    assert(lastWritten.balance === 50, 'rollback restored balance to 50');
    assert(lastWritten.transactions.length === 0, 'rollback restored empty transactions');
  }

  // ─── escrow_cold_start ────────────────────────────────────────────
  section('escrow_cold_start — readEscrow with missing file (ENOENT)');
  {
    // Empty file system — no escrow file exists
    const mockFs = createMockFs({});

    const escrow = readEscrow(
      mockFs.readJsonFile,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID
    );

    assert(escrow.balance === 0, 'cold-start balance is 0');
    assert(Array.isArray(escrow.transactions), 'transactions is an array');
    assert(escrow.transactions.length === 0, 'transactions is empty');
    assert(escrow.campaignId === CAMPAIGN_ID, 'campaignId matches');
  }

  // ─── escrow_deposit_negative ──────────────────────────────────────
  section('escrow_deposit_negative — deposit with amount=-1 → 400');
  {
    const mockFs = createMockFs({});

    const result = deposit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      -1
    );

    assert(result.status === 400, 'deposit returns status 400');
    assert(typeof result.error === 'string', 'error message is a string');
    assert(result.balance === undefined, 'no balance returned on error');
  }

  // ─── escrow_deposit_zero ──────────────────────────────────────────
  section('escrow_deposit_zero — deposit with amount=0 → 400');
  {
    const mockFs = createMockFs({});

    const result = deposit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      0
    );

    assert(result.status === 400, 'deposit returns status 400');
    assert(typeof result.error === 'string', 'error message is a string');
  }

  // ─── escrow_balance_warning ───────────────────────────────────────
  section('escrow_balance_warning — balance=0 → { balance: 0, warning: true }');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 0, transactions: [] },
    });

    const result = getBalance(
      mockFs.readJsonFile,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID
    );

    assert(result.balance === 0, 'balance is 0');
    assert(result.warning === true, 'warning is true when balance === 0');
  }

  // Also test that warning is absent when balance > 0
  section('escrow_balance_no_warning — balance=100 → no warning field');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 100, transactions: [] },
    });

    const result = getBalance(
      mockFs.readJsonFile,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID
    );

    assert(result.balance === 100, 'balance is 100');
    assert(result.warning === undefined, 'warning is undefined when balance > 0');
  }

  // ─── escrow_tx_initiated_by ───────────────────────────────────────
  section('escrow_tx_initiated_by — debit with initiatedBy=auto-approve');
  {
    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const mockFs = createMockFs({
      [escrowPath]: { campaignId: CAMPAIGN_ID, balance: 100, transactions: [] },
    });

    const result = debit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      30, 'sub-005', 'auto-approve'
    );

    assert(result.status === 200, 'debit returns status 200');

    const savedEscrow = mockFs.getFiles()[escrowPath];
    const tx = savedEscrow.transactions[0];
    assert(tx.initiatedBy === 'auto-approve', 'transaction initiatedBy is auto-approve');
    assert(tx.type === 'debit', 'transaction type is debit');
    assert(tx.amount === 30, 'transaction amount is 30');
    assert(tx.ref === 'sub-005', 'transaction ref is sub-005');
    assert(typeof tx.createdAt === 'string', 'createdAt is a string (ISO 8601)');
  }

  // ─── Deposit success (cold-start + positive amount) ───────────────
  section('escrow_deposit_success — deposit 100 on cold-start → balance=100');
  {
    const mockFs = createMockFs({});

    const result = deposit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      100
    );

    assert(result.status === 200, 'deposit returns status 200');
    assert(result.balance === 100, 'balance is 100 after deposit');

    const escrowPath = getEscrowPath(WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID);
    const savedEscrow = mockFs.getFiles()[escrowPath];
    assert(savedEscrow.balance === 100, 'saved escrow balance is 100');
    assert(savedEscrow.transactions.length === 1, 'one transaction recorded');
    assert(savedEscrow.transactions[0].type === 'deposit', 'transaction type is deposit');
    assert(savedEscrow.transactions[0].ref === 'manual', 'transaction ref is manual');
    assert(savedEscrow.transactions[0].initiatedBy === 'creator', 'initiatedBy is creator');
  }

  // ─── Deposit non-numeric amount ───────────────────────────────────
  section('escrow_deposit_non_numeric — deposit with amount="abc" → 400');
  {
    const mockFs = createMockFs({});

    const result = deposit(
      mockFs.readJsonFile, mockFs.writeJsonAtomic,
      WORKSPACES_ROOT, CREATOR_ID, CAMPAIGN_ID,
      'abc'
    );

    assert(result.status === 400, 'deposit returns status 400 for non-numeric');
  }

  // ─── Summary ──────────────────────────────────────────────────────
  log('\n============================================================', COLORS.CYAN);
  log(`  Results: ${passed} passed, ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  log('============================================================', COLORS.CYAN);

  if (failures.length > 0) {
    log('\nFailed tests:', COLORS.RED);
    failures.forEach((f) => log(`  - ${f}`, COLORS.RED));
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
