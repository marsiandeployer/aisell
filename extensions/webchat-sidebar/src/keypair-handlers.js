/**
 * Keypair management handlers for panel.js.
 * Extracted for testability — panel.js delegates to these functions.
 *
 * Handles: generate_keypair, get_address, sign_challenge, import_keypair.
 * All operations use chrome.storage.local via the passed `storage` parameter.
 *
 * Storage schema: { sd_keypair: { address: '0x...', privateKey: '0x...' } }
 */

'use strict';

// In extension context, ethers is loaded via <script> in panel.html.
// In Node.js test context, ethers is loaded via require() before this module.
function getEthers() {
  if (typeof globalThis !== 'undefined' && globalThis.ethers) return globalThis.ethers;
  if (typeof window !== 'undefined' && window.ethers) return window.ethers;
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
 * Write keypair to storage.
 * @param {object} storage - chrome.storage.local compatible object
 * @param {{address: string, privateKey: string}} keypair
 * @returns {Promise<void>}
 */
function writeKeypair(storage, keypair) {
  return new Promise((resolve) => {
    storage.set({ sd_keypair: keypair }, () => resolve());
  });
}

/**
 * Handle a keypair-related message.
 * @param {string} type - Message type: generate_keypair, get_address, sign_challenge, import_keypair
 * @param {object} message - Full message object (may contain challenge, privateKey, etc.)
 * @param {object} storage - chrome.storage.local compatible object
 * @returns {Promise<object>} Response data
 * @throws {object} Error with code and message properties
 */
async function handleKeypairMessage(type, message, storage) {
  const lib = getEthers();

  switch (type) {
    case 'generate_keypair': {
      const existing = await readKeypair(storage);
      if (existing) {
        return { address: existing.address, privateKey: existing.privateKey };
      }
      const wallet = lib.Wallet.createRandom();
      const keypair = { address: wallet.address, privateKey: wallet.privateKey };
      await writeKeypair(storage, keypair);
      return { address: keypair.address, privateKey: keypair.privateKey };
    }

    case 'get_address': {
      const keypair = await readKeypair(storage);
      if (!keypair) {
        const err = new Error('No keypair stored');
        err.code = 'NO_KEYPAIR';
        throw err;
      }
      return { address: keypair.address };
    }

    case 'sign_challenge': {
      const keypair = await readKeypair(storage);
      if (!keypair) {
        const err = new Error('No keypair stored');
        err.code = 'NO_KEYPAIR';
        throw err;
      }
      const challenge = String(message.challenge || '');
      if (!challenge) {
        throw new Error('challenge is required');
      }
      const wallet = new lib.Wallet(keypair.privateKey);
      const signature = await wallet.signMessage(challenge);
      return { signature };
    }

    case 'import_keypair': {
      const privateKey = String(message.privateKey || '');
      if (!privateKey) {
        throw new Error('privateKey is required');
      }
      // Validate by constructing a wallet — throws if invalid
      let wallet;
      try {
        wallet = new lib.Wallet(privateKey);
      } catch (e) {
        throw new Error('Invalid private key: ' + (e.message || 'unknown error'));
      }
      const keypair = { address: wallet.address, privateKey: wallet.privateKey };
      await writeKeypair(storage, keypair);
      return { address: keypair.address };
    }

    default:
      throw new Error('Unknown keypair message type: ' + type);
  }
}

// Export for both Node.js (tests) and browser (panel.js via <script>)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleKeypairMessage };
}
if (typeof globalThis !== 'undefined') {
  globalThis.__keypairHandlers = { handleKeypairMessage };
}
