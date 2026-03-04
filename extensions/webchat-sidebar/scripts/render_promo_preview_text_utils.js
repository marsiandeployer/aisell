const ASSISTANT_BUBBLE_SELECTOR = '.bubble.assistant[data-kind="assistant"]';
const ASSISTANT_TEXT_SELECTOR = `${ASSISTANT_BUBBLE_SELECTOR} .text`;
const PROGRESS_PREFIXES = ['⏳', '⌛'];
const PROGRESS_MARKERS = [
  'launching claude',
  'still working',
  'все еще работает', // cyrillic-ok
  'is still working',
  'prompt:',
  'промпт:', // cyrillic-ok
  'history:',
  'история:', // cyrillic-ok
];

function looksLikeProgressAssistantText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return true;
  if (PROGRESS_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return true;
  }

  const lower = text.toLowerCase();
  return PROGRESS_MARKERS.some((marker) => lower.includes(marker));
}

function pickLatestCompletedAssistantText(texts) {
  if (!Array.isArray(texts)) return '';
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const text = String(texts[i] || '').trim();
    if (!text) continue;
    if (looksLikeProgressAssistantText(text)) continue;
    return text;
  }
  return '';
}

function extractHtmlFromAssistantText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const fencedHtmlMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (fencedHtmlMatch && fencedHtmlMatch[1]) {
    return fencedHtmlMatch[1].trim();
  }

  const fencedMatch = text.match(/```\s*([\s\S]*?)```/);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    if (/<(html|body|head|div|main|section)\b/i.test(candidate)) {
      return candidate;
    }
  }

  if (/^\s*<!doctype html>/i.test(text) || /^\s*<html\b/i.test(text)) {
    return text;
  }

  const anyHtmlOpenTag = /<(?:!doctype\s+html|html|head|body|main|section|article|header|footer|div|svg)\b/i;
  const openTagIndex = text.search(anyHtmlOpenTag);
  if (openTagIndex >= 0) {
    const fragment = text.slice(openTagIndex).trim();
    if (/^<(?:!doctype\s+html|html)\b/i.test(fragment)) {
      return fragment;
    }
    if (fragment.includes('</') || fragment.includes('/>')) {
      return `<!doctype html><html><head><meta charset="UTF-8"></head><body>${fragment}</body></html>`;
    }
  }

  return '';
}

module.exports = {
  ASSISTANT_BUBBLE_SELECTOR,
  ASSISTANT_TEXT_SELECTOR,
  PROGRESS_MARKERS,
  looksLikeProgressAssistantText,
  pickLatestCompletedAssistantText,
  extractHtmlFromAssistantText,
};
