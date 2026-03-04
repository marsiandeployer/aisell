#!/usr/bin/env node
/**
 * Tests for panel.js keypair handlers: generate_keypair, get_address,
 * sign_challenge, import_keypair.
 *
 * Mocks chrome.storage.local and chrome.runtime, then exercises handleMessage
 * via simulated postMessage events.
 *
 * Run: node tests/test_panel_keypair.js
 */

'use strict';

// Load ethers for verification — ethers.min.js exports directly as CJS module
const ethersPath = require('path').join(__dirname, '..', 'src', 'ethers.min.js');
const ethers = require(ethersPath);
// Also set on globalThis so keypair-handlers.js can find it
globalThis.ethers = ethers;

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.log(`  FAIL: ${description}`);
    failed++;
  }
}

// Mock chrome.storage.local
function createMockStorage() {
  const store = {};
  return {
    get: (keys, cb) => {
      if (typeof keys === 'string') keys = [keys];
      const result = {};
      for (const k of keys) {
        if (store[k] !== undefined) result[k] = store[k];
      }
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set: (items, cb) => {
      Object.assign(store, items);
      if (cb) cb();
      return Promise.resolve();
    },
    _store: store,
  };
}

// Isolate the panel keypair handlers by extracting the logic
// Since panel.js runs as an IIFE that depends on DOM, we test the handler logic
// by extracting it into a testable module pattern.
// We import the handler functions from a test helper that panel.js also exports.

// Instead, we'll test the handler functions directly by reimporting the keypair
// handler module that we'll extract into panel.js.

// Approach: We load the keypair handler functions that panel.js uses.
// These are exported via a global for testing.
function createKeypairHandlers(storage) {
  // This mirrors the logic that will be added to panel.js
  const { handleKeypairMessage } = require('../src/keypair-handlers.js');
  return handleKeypairMessage;
}

// Alternative approach: test the functions directly without panel.js IIFE context.
// We'll create a small test adapter.

async function runTests() {
  console.log('=== Panel Keypair Handler Tests ===\n');

  // We test the keypair logic by loading keypair-handlers.js which panel.js will use.
  // This avoids needing to mock the entire DOM/iframe environment of panel.js.
  let handleKeypairMessage;
  try {
    const mod = require('../src/keypair-handlers.js');
    handleKeypairMessage = mod.handleKeypairMessage;
  } catch (e) {
    console.error('Could not load keypair-handlers.js:', e.message);
    console.error('This module must be created as part of the implementation.');
    process.exit(1);
  }

  // test_generate_keypair_creates_new
  {
    const storage = createMockStorage();
    const result = await handleKeypairMessage('generate_keypair', {}, storage);
    assert(
      result && typeof result.address === 'string' && result.address.startsWith('0x'),
      'generate_keypair with empty storage creates keypair with valid address'
    );
    assert(
      result && typeof result.privateKey === 'string' && result.privateKey.startsWith('0x'),
      'generate_keypair returns privateKey starting with 0x'
    );
    assert(
      storage._store.sd_keypair && storage._store.sd_keypair.address === result.address,
      'generate_keypair stores keypair in chrome.storage.local under sd_keypair'
    );
  }

  // test_generate_keypair_returns_existing
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const result = await handleKeypairMessage('generate_keypair', {}, storage);
    assert(
      result.address === wallet.address && result.privateKey === wallet.privateKey,
      'generate_keypair with existing keypair returns the same one without generating new'
    );
  }

  // test_get_address_success
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const result = await handleKeypairMessage('get_address', {}, storage);
    assert(
      result && result.address === wallet.address,
      'get_address with stored keypair returns correct address'
    );
    assert(
      !result.privateKey,
      'get_address does not return privateKey'
    );
  }

  // test_get_address_missing
  {
    const storage = createMockStorage();
    try {
      await handleKeypairMessage('get_address', {}, storage);
      assert(false, 'get_address with empty storage throws error');
    } catch (err) {
      assert(
        err && err.code === 'NO_KEYPAIR',
        'get_address with empty storage throws error with code NO_KEYPAIR'
      );
    }
  }

  // test_sign_challenge_success
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const challenge = 'test challenge message';
    const result = await handleKeypairMessage('sign_challenge', { challenge }, storage);
    assert(
      result && typeof result.signature === 'string',
      'sign_challenge returns a signature string'
    );

    // Verify signature with ethers
    const recovered = ethers.verifyMessage(challenge, result.signature);
    assert(
      recovered === wallet.address,
      'sign_challenge signature is verifiable via ethers.verifyMessage'
    );
  }

  // test_import_keypair_valid
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();

    const result = await handleKeypairMessage('import_keypair', { privateKey: wallet.privateKey }, storage);
    assert(
      result && result.address === wallet.address,
      'import_keypair with valid key returns derived address'
    );
    assert(
      storage._store.sd_keypair && storage._store.sd_keypair.address === wallet.address,
      'import_keypair stores keypair in storage'
    );
  }

  // test_import_keypair_invalid
  {
    const storage = createMockStorage();
    const beforeStore = { ...storage._store };

    try {
      await handleKeypairMessage('import_keypair', { privateKey: 'not-a-valid-key' }, storage);
      assert(false, 'import_keypair with invalid key throws error');
    } catch (err) {
      assert(
        err && typeof err.message === 'string',
        'import_keypair with invalid key throws error with message'
      );
    }
    assert(
      !storage._store.sd_keypair,
      'import_keypair with invalid key does not modify storage'
    );
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
