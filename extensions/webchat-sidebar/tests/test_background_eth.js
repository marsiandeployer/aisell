#!/usr/bin/env node
/**
 * Tests for background.js eth_request handler: eth_requestAccounts, personal_sign,
 * no-keypair error, and ensuring other message types are not affected.
 *
 * Mocks chrome.storage.local.
 *
 * Run: node tests/test_background_eth.js
 */

'use strict';

// Load ethers for keypair generation and signature verification
const ethersPath = require('path').join(__dirname, '..', 'src', 'ethers.min.js');
const ethers = require(ethersPath);
// Also set on globalThis so eth-request-handler.js can find it
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

// We test the eth_request handler logic extracted into a testable module.
// background.js will import and use handleEthRequest from eth-request-handler.js.

async function runTests() {
  console.log('=== Background eth_request Handler Tests ===\n');

  let handleEthRequest;
  try {
    const mod = require('../src/eth-request-handler.js');
    handleEthRequest = mod.handleEthRequest;
  } catch (e) {
    console.error('Could not load eth-request-handler.js:', e.message);
    console.error('This module must be created as part of the implementation.');
    process.exit(1);
  }

  // test_eth_request_accounts_success
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const result = await handleEthRequest(
      { method: 'eth_requestAccounts', params: [] },
      storage
    );
    assert(
      result && Array.isArray(result.result) && result.result[0] === wallet.address,
      'eth_requestAccounts with stored keypair returns [address]'
    );
  }

  // test_eth_personal_sign_success
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const challenge = JSON.stringify({ dashboardId: '123', timestamp: Date.now(), nonce: 'abc' });
    const result = await handleEthRequest(
      { method: 'personal_sign', params: [challenge, wallet.address] },
      storage
    );

    assert(
      result && typeof result.result === 'string',
      'personal_sign returns a signature string'
    );

    // Verify EIP-191 signature
    const recovered = ethers.verifyMessage(challenge, result.result);
    assert(
      recovered === wallet.address,
      'personal_sign signature is a valid EIP-191 signature verifiable with ethers.verifyMessage'
    );
  }

  // test_eth_no_keypair_error
  {
    const storage = createMockStorage();
    // No keypair in storage

    const result = await handleEthRequest(
      { method: 'eth_requestAccounts', params: [] },
      storage
    );
    assert(
      result && result.error && result.error.code === 'NO_KEYPAIR',
      'eth_requestAccounts with empty storage returns error with code NO_KEYPAIR'
    );
  }

  // test_eth_no_keypair_personal_sign
  {
    const storage = createMockStorage();

    const result = await handleEthRequest(
      { method: 'personal_sign', params: ['challenge', '0x123'] },
      storage
    );
    assert(
      result && result.error && result.error.code === 'NO_KEYPAIR',
      'personal_sign with empty storage returns error with code NO_KEYPAIR'
    );
  }

  // test_unsupported_method
  {
    const storage = createMockStorage();
    const wallet = ethers.Wallet.createRandom();
    storage._store.sd_keypair = { address: wallet.address, privateKey: wallet.privateKey };

    const result = await handleEthRequest(
      { method: 'eth_chainId', params: [] },
      storage
    );
    assert(
      result && result.error && result.error.code === 'UNSUPPORTED_METHOD',
      'unsupported method returns error with code UNSUPPORTED_METHOD'
    );
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
