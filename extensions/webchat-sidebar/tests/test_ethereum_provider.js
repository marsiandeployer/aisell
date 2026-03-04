#!/usr/bin/env node
/**
 * Tests for ethereum-provider.js: window.ethereum setup, CustomEvent dispatch,
 * promise resolution/rejection via sd-eth-response.
 *
 * Uses a minimal DOM mock (no jsdom dependency).
 *
 * Run: node tests/test_ethereum_provider.js
 */

'use strict';

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

// Minimal DOM mock for window, CustomEvent, addEventListener, dispatchEvent
function createMockWindow() {
  const listeners = {};

  const mockWindow = {
    ethereum: undefined,
    crypto: {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10),
    },
    addEventListener: (type, handler) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    dispatchEvent: (event) => {
      const handlers = listeners[event.type] || [];
      for (const h of handlers) h(event);
    },
    // Store dispatched events for assertions
    _dispatchedEvents: [],
    _originalDispatchEvent: null,
  };

  // Wrap dispatchEvent to record calls
  mockWindow._originalDispatchEvent = mockWindow.dispatchEvent;
  mockWindow.dispatchEvent = (event) => {
    mockWindow._dispatchedEvents.push(event);
    mockWindow._originalDispatchEvent(event);
  };

  return mockWindow;
}

// CustomEvent polyfill for Node.js
class CustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = (options && options.detail) || null;
  }
}

function loadProvider(mockWindow) {
  // The provider uses an IIFE that references window and CustomEvent.
  // We load it by executing the source in a VM context to avoid Node.js
  // readonly global.crypto issues.
  const fs = require('fs');
  const vm = require('vm');
  const providerPath = require('path').join(__dirname, '..', 'src', 'ethereum-provider.js');
  const src = fs.readFileSync(providerPath, 'utf8');

  const sandbox = {
    window: mockWindow,
    CustomEvent: CustomEvent,
    crypto: mockWindow.crypto,
  };

  vm.runInNewContext(src, sandbox);
}

async function runTests() {
  console.log('=== Ethereum Provider Tests ===\n');

  // test_window_ethereum_set
  {
    const w = createMockWindow();
    loadProvider(w);
    assert(w.ethereum !== undefined && w.ethereum !== null, 'window.ethereum is set after loading provider');
  }

  // test_is_simple_dashboard_flag
  {
    const w = createMockWindow();
    loadProvider(w);
    assert(w.ethereum.isSimpleDashboard === true, 'window.ethereum.isSimpleDashboard === true');
  }

  // test_request_dispatches_custom_event
  {
    const w = createMockWindow();
    loadProvider(w);
    w._dispatchedEvents = [];

    // Call request but don't await (it will pend until response)
    const promise = w.ethereum.request({ method: 'eth_requestAccounts' });

    const sdRequests = w._dispatchedEvents.filter((e) => e.type === 'sd-eth-request');
    assert(sdRequests.length === 1, 'request() dispatches CustomEvent("sd-eth-request")');
    assert(
      sdRequests[0].detail && sdRequests[0].detail.method === 'eth_requestAccounts',
      'sd-eth-request detail contains method "eth_requestAccounts"'
    );
    assert(
      typeof sdRequests[0].detail.requestId === 'string' && sdRequests[0].detail.requestId.length > 0,
      'sd-eth-request detail contains a non-empty requestId'
    );

    // Clean up: resolve the pending promise to avoid unhandled rejection
    const requestId = sdRequests[0].detail.requestId;
    w._originalDispatchEvent(new CustomEvent('sd-eth-response', {
      detail: { requestId, result: ['0xABC'] }
    }));
    await promise.catch(() => {});
  }

  // test_response_resolves_promise
  {
    const w = createMockWindow();
    loadProvider(w);
    w._dispatchedEvents = [];

    const promise = w.ethereum.request({ method: 'eth_requestAccounts' });

    const sdRequests = w._dispatchedEvents.filter((e) => e.type === 'sd-eth-request');
    const requestId = sdRequests[0].detail.requestId;

    // Simulate response from content script
    w._originalDispatchEvent(new CustomEvent('sd-eth-response', {
      detail: { requestId, result: ['0xABC'] }
    }));

    const result = await promise;
    assert(
      Array.isArray(result) && result[0] === '0xABC',
      'sd-eth-response with result resolves the request() promise with ["0xABC"]'
    );
  }

  // test_error_rejects_promise
  {
    const w = createMockWindow();
    loadProvider(w);
    w._dispatchedEvents = [];

    const promise = w.ethereum.request({ method: 'personal_sign', params: ['challenge', '0x123'] });

    const sdRequests = w._dispatchedEvents.filter((e) => e.type === 'sd-eth-request');
    const requestId = sdRequests[0].detail.requestId;

    // Simulate error response
    w._originalDispatchEvent(new CustomEvent('sd-eth-response', {
      detail: { requestId, error: { code: 'NO_KEYPAIR', message: 'No keypair stored' } }
    }));

    try {
      await promise;
      assert(false, 'sd-eth-response with error rejects the promise');
    } catch (err) {
      assert(
        err && err.code === 'NO_KEYPAIR',
        'sd-eth-response with error rejects the promise with error.code === "NO_KEYPAIR"'
      );
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
