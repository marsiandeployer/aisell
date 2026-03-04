/**
 * Content script relay for SimpleDashboard Ethereum provider.
 * Runs in ISOLATED world on d*.wpmix.net pages.
 *
 * Bridges between the MAIN world ethereum-provider.js and the
 * extension background.js service worker:
 *   - Listens for CustomEvent('sd-eth-request') from page world
 *   - Forwards to background.js via chrome.runtime.sendMessage
 *   - Dispatches CustomEvent('sd-eth-response') back to page world
 *
 * Both MAIN and ISOLATED worlds share the same window object in MV3,
 * so CustomEvent dispatch/listen works across worlds.
 */

(function() {
  'use strict';

  window.addEventListener('sd-eth-request', function(event) {
    var detail = event.detail;
    if (!detail || !detail.requestId) return;

    var requestId = detail.requestId;
    var method = detail.method;
    var params = detail.params || [];

    // Relay to background.js service worker
    try {
      chrome.runtime.sendMessage(
        { type: 'eth_request', method: method, params: params, requestId: requestId },
        function(response) {
          // Guard against extension context invalidation
          if (chrome.runtime.lastError) {
            window.dispatchEvent(new CustomEvent('sd-eth-response', {
              detail: {
                requestId: requestId,
                error: {
                  code: 'EXTENSION_ERROR',
                  message: chrome.runtime.lastError.message || 'Extension communication failed'
                }
              }
            }));
            return;
          }

          // Forward response back to page world
          var responseDetail = {
            requestId: requestId
          };

          if (response && response.error) {
            responseDetail.error = response.error;
          } else if (response && response.result !== undefined) {
            responseDetail.result = response.result;
          } else {
            responseDetail.error = {
              code: 'INVALID_RESPONSE',
              message: 'Invalid response from extension'
            };
          }

          window.dispatchEvent(new CustomEvent('sd-eth-response', {
            detail: responseDetail
          }));
        }
      );
    } catch (e) {
      // Extension context invalidated (e.g., extension updated mid-session)
      window.dispatchEvent(new CustomEvent('sd-eth-response', {
        detail: {
          requestId: requestId,
          error: {
            code: 'EXTENSION_ERROR',
            message: 'Extension not available: ' + (e.message || 'unknown error')
          }
        }
      }));
    }
  });
})();
