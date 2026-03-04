(function bootstrapPanelShared(globalObj) {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readFileCreatedPayload(message) {
    const source = message && typeof message === 'object' ? message : {};
    const data = source.data && typeof source.data === 'object' ? source.data : {};
    const filename = String(source.filename || data.filename || '');
    const url = String(source.url || data.url || '');
    return { filename, url };
  }

  function normalizeUserId(rawUserId) {
    const clean = String(rawUserId || '').trim().replace(/^user_/, '');
    return clean || '';
  }

  function buildPreviewUrl(rawUserId) {
    const userId = normalizeUserId(rawUserId);
    if (!userId) return '';
    return `https://d${userId}.wpmix.net/`;
  }

  function hasIndexHtmlCreatedSignal(rawText) {
    const text = String(rawText || '').toLowerCase();
    if (!text.includes('index.html')) return false;
    return (
      text.includes('создан') ||
      text.includes('created') ||
      text.includes('сохран') ||
      text.includes('saved')
    );
  }

  function buildFileCreatedMessageFromHistory(messages, rawUserId) {
    const lastMsg = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMsg || lastMsg.role !== 'assistant') return null;
    if (!hasIndexHtmlCreatedSignal(lastMsg.text || '')) return null;

    const url = buildPreviewUrl(rawUserId);
    if (!url) return null;

    return {
      type: 'file_created',
      filename: 'index.html',
      url,
    };
  }

  function toOpenPreviewAction(message) {
    const payload = readFileCreatedPayload(message);
    if (payload.filename !== 'index.html' || !payload.url) {
      return null;
    }
    return {
      type: 'open_preview',
      url: payload.url,
    };
  }

  const api = {
    escapeHtml,
    readFileCreatedPayload,
    normalizeUserId,
    buildPreviewUrl,
    hasIndexHtmlCreatedSignal,
    buildFileCreatedMessageFromHistory,
    toOpenPreviewAction,
  };

  globalObj.WebchatSidebarShared = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
