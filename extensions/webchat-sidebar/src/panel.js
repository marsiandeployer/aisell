// Panel script for WebChat sidebar with tab interaction capabilities.
// Provides: current tab info, page content reading, screenshot capture, developer mode element selection.
// UI controls (dev mode, showcases) live in webchat's hamburger menu — not in panel.html.

(function() {
  'use strict';

  const shared = (typeof window !== 'undefined' && window.WebchatSidebarShared)
    ? window.WebchatSidebarShared
    : null;
  const localEscapeHtml = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const iframe = document.querySelector('iframe');
  if (!iframe) return;

  const configuredWebchatUrl = String(iframe.getAttribute('data-webchat-url') || iframe.getAttribute('src') || '').trim();
  const normalizedIframeUrl = normalizeWebchatUrl(configuredWebchatUrl);
  if (!normalizedIframeUrl) return;

  let iframeOrigin = normalizedIframeUrl.origin;
  iframe.src = normalizedIframeUrl.href;
  const capabilities = ['tab_info', 'read_page', 'screenshot', 'developer_mode', 'element_selection'];

  let developerModeEnabled = false;
  let bridgeInitialized = false;
  let messageListenerBound = false;

  iframe.addEventListener('load', initCommunication);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  function initCommunication() {
    if (!messageListenerBound) {
      window.addEventListener('message', (event) => void handleMessage(event));
      messageListenerBound = true;
    }

    if (bridgeInitialized) return;
    if (!sendToWebchat({ type: 'extension_ready', capabilities })) return;
    sendDeveloperModeChanged();
    bridgeInitialized = true;
  }

  async function handleMessage(event) {
    if (event.origin !== iframeOrigin) return;

    const message = event.data || {};
    const { type, requestId } = message;

    try {
      switch (type) {
        case 'get_tab_info':
          await handleGetTabInfo(requestId);
          break;
        case 'read_page_content':
          await handleReadPageContent(requestId);
          break;
        case 'capture_screenshot':
          await handleCaptureScreenshot(requestId);
          break;
        case 'set_developer_mode': {
          const enabled = readEnabledFlag(message);
          await setDeveloperMode(enabled);
          sendResponse(requestId, { enabled: developerModeEnabled });
          break;
        }
        case 'get_developer_mode_state':
          sendResponse(requestId, { enabled: developerModeEnabled });
          break;
        case 'clear_selected_element':
          await clearSelectionInActiveTab();
          sendResponse(requestId, { cleared: true });
          break;
        case 'file_created':
          handleFileCreated(message);
          break;
        case 'open_showcases':
          // Webchat requests to open /showcases in main browser tab
          try {
            const requestedShowcasesUrl = readRequestedShowcasesUrl(message);
            chrome.tabs.create({ url: requestedShowcasesUrl || buildShowcasesUrl(), active: true });
          } catch (_e) {}
          break;
        case 'open_webchat_prompt':
          handleOpenWebchatPrompt(message);
          break;
        case 'generate_keypair':
        case 'get_address':
        case 'sign_challenge':
        case 'import_keypair':
          await handleKeypairRequest(type, message, requestId);
          break;
      }
    } catch (error) {
      sendToWebchat({
        type: 'response',
        requestId,
        error: error && error.message ? error.message : 'Unknown error'
      });
    }
  }

  function handleFileCreated(message) {
    const action = shared && typeof shared.toOpenPreviewAction === 'function'
      ? shared.toOpenPreviewAction(message)
      : null;
    if (!action) return;
    chrome.runtime.sendMessage(action);
  }

  function handleOpenWebchatPrompt(message) {
    const prompt = readPromptValue(message);
    if (!prompt) return;

    const nextUrl = new URL('/', iframeOrigin);
    nextUrl.searchParams.set('prompt', prompt);
    bridgeInitialized = false;
    iframe.src = nextUrl.toString();
  }

  async function handleKeypairRequest(type, message, requestId) {
    const handlers = (typeof globalThis !== 'undefined' && globalThis.__keypairHandlers)
      ? globalThis.__keypairHandlers
      : null;
    if (!handlers) {
      sendResponse(requestId, { error: 'Keypair handlers not loaded' });
      return;
    }
    try {
      const result = await handlers.handleKeypairMessage(type, message, chrome.storage.local);
      sendResponse(requestId, result);
    } catch (err) {
      sendToWebchat({
        type: 'response',
        requestId,
        error: err.message || 'Keypair operation failed'
      });
    }
  }

  async function handleGetTabInfo(requestId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    sendResponse(requestId, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      id: tab.id
    });
  }

  async function handleReadPageContent(requestId) {
    const tab = await getActiveTabOrThrow();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    if (!results || !results[0]) {
      throw new Error('Failed to extract page content');
    }

    sendResponse(requestId, {
      title: tab.title,
      url: tab.url,
      content: results[0].result
    });
  }

  async function handleCaptureScreenshot(requestId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    // captureVisibleTab requires activeTab permission to be active.
    // In MV3 side panels, it may not be granted automatically — request it explicitly.
    let dataUrl = null;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (captureErr) {
      // Permission not granted yet — request activeTab for the current tab
      try {
        await chrome.permissions.request({ origins: ['*://*.wpmix.net/*'] });
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      } catch (_e) {
        // captureVisibleTab unavailable (e.g. chrome:// pages) — send null screenshot
        dataUrl = null;
      }
    }

    sendResponse(requestId, {
      title: tab.title,
      url: tab.url,
      screenshot: dataUrl
    });
  }

  function handleRuntimeMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'dev_mode_element_selected') {
      const data = normalizeElementPayload(message.payload);
      sendToWebchat({
        type: 'dev_element_selected',
        data: {
          ...data,
          chatText: formatElementForChat(data)
        }
      });
    } else if (message.type === 'dev_mode_selection_cleared') {
      sendToWebchat({ type: 'dev_element_selection_cleared' });
    } else if (message.type === 'external_open_webchat_prompt') {
      handleOpenWebchatPrompt(message);
    }
  }

  async function setDeveloperMode(enabled) {
    const nextState = Boolean(enabled);
    const tab = await getActiveTabOrThrow();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: setElementPickerMode,
      args: [nextState]
    });

    developerModeEnabled = nextState;
    sendDeveloperModeChanged(tab.id);
  }

  async function clearSelectionInActiveTab() {
    const tab = await getActiveTabOrThrow();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clearElementPickerSelection
    });

    sendDeveloperModeChanged(tab.id);
  }

  async function getActiveTabOrThrow() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active tab found');
    }
    return tab;
  }

  function sendResponse(requestId, data) {
    sendToWebchat({
      type: 'response',
      requestId,
      data
    });
  }

  function sendDeveloperModeChanged(tabId) {
    sendToWebchat({
      type: 'developer_mode_changed',
      data: {
        enabled: developerModeEnabled,
        tabId: typeof tabId === 'number' ? tabId : null
      }
    });
  }

  function sendToWebchat(message) {
    if (!iframe.contentWindow) return false;
    try {
      iframe.contentWindow.postMessage(message, iframeOrigin);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function buildShowcasesUrl() {
    try {
      const url = new URL('/showcases/', iframeOrigin);
      url.searchParams.set('ext_id', chrome.runtime.id);
      return url.toString();
    } catch (_e) {
      return iframeOrigin + '/showcases';
    }
  }

  function readRequestedShowcasesUrl(message) {
    try {
      const requested = String(message && message.url ? message.url : '').trim();
      if (!requested) return '';
      const parsed = new URL(requested);
      if (parsed.origin !== iframeOrigin) return '';
      if (!parsed.pathname.startsWith('/showcases')) return '';
      return parsed.toString();
    } catch (_e) {
      return '';
    }
  }

  function normalizeWebchatUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      if (parsed.protocol === 'http:' && !isLocalhostHostname(parsed.hostname)) {
        parsed.protocol = 'https:';
      }
      if (!parsed.searchParams.has('lang')) {
        parsed.searchParams.set('lang', inferLangCode());
      }
      if (!parsed.searchParams.has('ext_id')) {
        try {
          const runtimeId = String((chrome && chrome.runtime && chrome.runtime.id) || '').trim();
          if (/^[a-z]{32}$/.test(runtimeId)) parsed.searchParams.set('ext_id', runtimeId);
        } catch (_e) {}
      }
      return {
        href: parsed.toString(),
        origin: parsed.origin
      };
    } catch (_e) {
      return null;
    }
  }

  function inferLangCode() {
    const nav = (navigator.language || '').toLowerCase();
    return nav.startsWith('ru') ? 'ru' : 'en';
  }

  function isLocalhostHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  }

  function readEnabledFlag(message) {
    if (typeof message.enabled === 'boolean') return message.enabled;
    if (message.data && typeof message.data.enabled === 'boolean') return message.data.enabled;
    throw new Error('`enabled` boolean is required');
  }

  function readPromptValue(message) {
    const direct = message && typeof message.prompt === 'string' ? message.prompt : '';
    const nested = message && message.data && typeof message.data.prompt === 'string'
      ? message.data.prompt
      : '';
    return String(direct || nested || '').trim().slice(0, 8000);
  }

  function normalizeElementPayload(payload) {
    const safe = payload && typeof payload === 'object' ? payload : {};
    return {
      tag: String(safe.tag || '').toLowerCase() || 'unknown',
      id: String(safe.id || ''),
      classes: String(safe.classes || ''),
      selector: String(safe.selector || '')
    };
  }

  function formatElementForChat(element) {
    return [
      'Element selected:',
      `- Tag: ${element.tag || '(unknown)'}`,
      `- ID: ${element.id || '(none)'}`,
      `- Classes: ${element.classes || '(none)'}`,
      `- Selector: ${element.selector || '(unknown)'}`
    ].join('\n');
  }

  // This function runs in the context of the active tab.
  function extractPageContent() {
    const textContent = document.body.innerText || '';
    const htmlContent = document.documentElement.outerHTML;

    const meta = {
      description: document.querySelector('meta[name="description"]')?.content || '',
      keywords: document.querySelector('meta[name="keywords"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || ''
    };

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((h) => ({ tag: h.tagName, text: h.innerText }))
      .slice(0, 20);

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({ href: a.href, text: a.innerText }))
      .slice(0, 50);

    return {
      text: textContent.substring(0, 50000),
      html: htmlContent.substring(0, 100000),
      meta,
      headings,
      links
    };
  }

  // This function runs in the context of the active tab.
  function setElementPickerMode(enabled) {
    const KEY = '__webchatSidebarElementPicker__';
    const HIGHLIGHT_OUTLINE = '2px solid #22c55e';

    function escapeCssIdent(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    function restoreSelection(state) {
      if (!state || !state.selected) return;
      const { element, outline, outlineOffset } = state.selected;
      if (element && element.isConnected) {
        element.style.outline = outline;
        element.style.outlineOffset = outlineOffset;
      }
      state.selected = null;
    }

    function getClassNames(element) {
      if (!element) return '';
      if (typeof element.className === 'string') return element.className.trim();
      const classAttr = element.getAttribute && element.getAttribute('class');
      return classAttr ? String(classAttr).trim() : '';
    }

    function segmentFor(element) {
      const tag = element.tagName.toLowerCase();
      if (element.id) {
        return `${tag}#${escapeCssIdent(element.id)}`;
      }

      const classNames = Array.from(element.classList || []).filter(Boolean).slice(0, 2);
      if (classNames.length > 0) {
        return `${tag}${classNames.map((cls) => `.${escapeCssIdent(cls)}`).join('')}`;
      }

      const parent = element.parentElement;
      if (!parent) return tag;

      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      if (sameTagSiblings.length <= 1) return tag;

      const index = sameTagSiblings.indexOf(element) + 1;
      return `${tag}:nth-of-type(${index})`;
    }

    function buildSelector(element) {
      const segments = [];
      let current = element;
      let depth = 0;
      while (current && current.nodeType === Node.ELEMENT_NODE && depth < 10) {
        segments.unshift(segmentFor(current));
        if (current.id) break;
        current = current.parentElement;
        depth += 1;
      }
      return segments.join(' > ');
    }

    function sendSelectionPayload(element) {
      const payload = {
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        classes: getClassNames(element),
        selector: buildSelector(element)
      };
      try {
        chrome.runtime.sendMessage({ type: 'dev_mode_element_selected', payload });
      } catch (_e) {}
    }

    const existing = window[KEY];
    if (!enabled) {
      if (existing) {
        restoreSelection(existing);
        document.removeEventListener('click', existing.onClick, true);
        document.removeEventListener('keydown', existing.onKeyDown, true);
        delete window[KEY];
      }
      return { enabled: false };
    }

    if (existing && existing.enabled) {
      return { enabled: true };
    }

    const state = existing || { enabled: true, selected: null, onClick: null, onKeyDown: null };
    state.enabled = true;

    state.onClick = function(event) {
      if (!event || !event.target || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      const element = event.target;
      restoreSelection(state);

      state.selected = {
        element,
        outline: element.style.outline || '',
        outlineOffset: element.style.outlineOffset || ''
      };

      element.style.outline = HIGHLIGHT_OUTLINE;
      element.style.outlineOffset = '2px';
      sendSelectionPayload(element);
    };

    state.onKeyDown = function(event) {
      if (!event || event.key !== 'Escape') return;
      restoreSelection(state);
      try {
        chrome.runtime.sendMessage({ type: 'dev_mode_selection_cleared' });
      } catch (_e) {}
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    };

    document.addEventListener('click', state.onClick, true);
    document.addEventListener('keydown', state.onKeyDown, true);

    window[KEY] = state;
    return { enabled: true };
  }

  // This function runs in the context of the active tab.
  function clearElementPickerSelection() {
    const KEY = '__webchatSidebarElementPicker__';
    const state = window[KEY];
    if (!state || !state.selected) return { cleared: false };

    const { element, outline, outlineOffset } = state.selected;
    if (element && element.isConnected) {
      element.style.outline = outline;
      element.style.outlineOffset = outlineOffset;
    }
    state.selected = null;

    try {
      chrome.runtime.sendMessage({ type: 'dev_mode_selection_cleared' });
    } catch (_e) {}

    return { cleared: true };
  }
})();
