// Manifest V3 service worker.
// Opens side panel + new tab with /showcases on icon click.
// Handles eth_request messages from content scripts for Web3 wallet operations.

importScripts('ethers.min.js');
importScripts('eth-request-handler.js');

const WEBCHAT_URL = '__WEBCHAT_URL__';

function getShowcasesUrl() {
  try {
    const origin = new URL(WEBCHAT_URL).origin;
    const url = new URL('/showcases/', origin);
    url.searchParams.set('ext_id', chrome.runtime.id);
    return url.toString();
  } catch (_e) {
    return '';
  }
}

async function setOpenOnClickBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (_e) {}
}

async function openSidePanelFromAction(tab) {
  try {
    if (!chrome.sidePanel || !chrome.sidePanel.open) return;

    await setOpenOnClickBehavior();

    const winId = tab && typeof tab.windowId === 'number'
      ? tab.windowId
      : (await chrome.windows.getCurrent()).id;
    if (typeof winId !== 'number') return;

    await chrome.sidePanel.open({ windowId: winId });

    // Open /showcases in a new tab
    const showcasesUrl = getShowcasesUrl();
    if (showcasesUrl) {
      chrome.tabs.create({ url: showcasesUrl, active: true });
    }
  } catch (_e) {}
}

chrome.runtime.onInstalled.addListener(() => void setOpenOnClickBehavior());
chrome.runtime.onStartup.addListener(() => void setOpenOnClickBehavior());
chrome.action.onClicked.addListener((tab) => void openSidePanelFromAction(tab));

// Auto-open preview when index.html is created,
// and handle eth_request messages from content scripts.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'open_preview' && message.url) {
    chrome.tabs.create({ url: message.url, active: true });
    return;
  }

  // Web3 wallet: relay eth_request from content scripts to chrome.storage
  if (message && message.type === 'eth_request') {
    const handler = globalThis.__ethRequestHandler;
    if (!handler) {
      sendResponse({ error: { code: 'HANDLER_ERROR', message: 'eth-request-handler not loaded' } });
      return true;
    }
    handler.handleEthRequest(
      { method: message.method, params: message.params || [] },
      chrome.storage.local
    ).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      sendResponse({ error: { code: 'HANDLER_ERROR', message: err.message || 'Unknown error' } });
    });
    return true; // Required for async sendResponse
  }
});

// Allow web pages (showcases/demo) to send prompt into extension chat.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'open_webchat_prompt') {
    sendResponse({ ok: false, error: 'unsupported_message' });
    return;
  }
  const prompt = String(message.prompt || '').trim().slice(0, 8000);
  if (!prompt) {
    sendResponse({ ok: false, error: 'empty_prompt' });
    return;
  }
  chrome.runtime.sendMessage({ type: 'external_open_webchat_prompt', prompt }, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      sendResponse({ ok: false, error: err.message || 'forward_failed' });
      return;
    }
    sendResponse({ ok: true });
  });
  return true;
});
