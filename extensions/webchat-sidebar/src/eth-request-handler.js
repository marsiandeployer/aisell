/**
 * Ethereum request handler for background.js service worker.
 * Extracted for testability — background.js delegates to this function.
 *
 * Handles eth_request messages from content scripts:
 * - eth_requestAccounts: returns [address] from stored keypair
 * - personal_sign: signs challenge with stored private key (EIP-191)
 *
 * Storage schema: { sd_keypair: { address: '0x...', privateKey: '0x...' } }
 */

'use strict';

// In service worker context, ethers is loaded via importScripts('ethers.min.js').
// In Node.js test context, ethers is loaded via require() before this module.
function getEthers() {
  if (typeof globalThis !== 'undefined' && globalThis.ethers) return globalThis.ethers;
  throw new Error('ethers library not available');
}

/**
 * Read keypair from storage.
 * @param {object} storage - chrome.storage.local compatible object
 * @returns {Promise<{address: string, privateKey: string} | null>}
 */
function readKeypair(storage) {
  return new Promise((resolve) => {
    storage.get(['sd_keypair'], (result) => {
      resolve(result && result.sd_keypair ? result.sd_keypair : null);
    });
  });
}

/**
 * Handle an eth_request message from a content script.
 * @param {{method: string, params: Array}} request - Ethereum JSON-RPC-like request
 * @param {object} storage - chrome.storage.local compatible object
 * @returns {Promise<{result: any} | {error: {code: string, message: string}}>}
 */
async function handleEthRequest(request, storage) {
  const { method, params } = request;

  const keypair = await readKeypair(storage);

  if (!keypair) {
    return { error: { code: 'NO_KEYPAIR', message: 'No keypair stored' } };
  }

  switch (method) {
    case 'eth_requestAccounts': {
      return { result: [keypair.address] };
    }

    case 'personal_sign': {
      const lib = getEthers();
      const challenge = params && params[0] ? String(params[0]) : '';
      if (!challenge) {
        return { error: { code: 'INVALID_PARAMS', message: 'challenge (params[0]) is required' } };
      }
      const wallet = new lib.Wallet(keypair.privateKey);
      const signature = await wallet.signMessage(challenge);
      return { result: signature };
    }

    default:
      return { error: { code: 'UNSUPPORTED_METHOD', message: `Method ${method} is not supported` } };
  }
}

// Export for both Node.js (tests) and service worker (background.js via importScripts)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleEthRequest };
}
if (typeof globalThis !== 'undefined') {
  globalThis.__ethRequestHandler = { handleEthRequest };
}
