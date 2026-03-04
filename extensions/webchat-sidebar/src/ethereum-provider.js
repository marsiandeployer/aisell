/**
 * Ethereum provider for SimpleDashboard.
 * Runs in MAIN world on d*.wpmix.net pages.
 *
 * Sets window.ethereum with a minimal EIP-1193-like interface.
 * Communicates with the ISOLATED world content script via CustomEvent bridge:
 *   - Dispatches 'sd-eth-request' with {requestId, method, params}
 *   - Listens for 'sd-eth-response' with {requestId, result?, error?}
 *
 * Supported methods: eth_requestAccounts, personal_sign.
 */

(function() {
  'use strict';

  // Guard against double-injection
  if (window.ethereum && window.ethereum.isSimpleDashboard) return;

  // Pending request map: requestId -> { resolve, reject }
  var pending = {};

  // Listen for responses from the isolated world content script
  window.addEventListener('sd-eth-response', function(event) {
    var detail = event.detail;
    if (!detail || !detail.requestId) return;

    var entry = pending[detail.requestId];
    if (!entry) return;
    delete pending[detail.requestId];

    if (detail.error) {
      var err = new Error(detail.error.message || 'Provider error');
      err.code = detail.error.code || 'UNKNOWN_ERROR';
      entry.reject(err);
    } else {
      entry.resolve(detail.result);
    }
  });

  var provider = {
    isSimpleDashboard: true,

    /**
     * Send a JSON-RPC-like request to the extension.
     * @param {{method: string, params?: Array}} args
     * @returns {Promise<any>}
     */
    request: function(args) {
      var method = args && args.method;
      var params = args && args.params || [];

      return new Promise(function(resolve, reject) {
        var requestId = crypto.randomUUID();

        pending[requestId] = { resolve: resolve, reject: reject };

        window.dispatchEvent(new CustomEvent('sd-eth-request', {
          detail: {
            requestId: requestId,
            method: method,
            params: params
          }
        }));
      });
    }
  };

  window.ethereum = provider;
})();
