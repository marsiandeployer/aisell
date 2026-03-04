#!/usr/bin/env node
const assert = require('assert');
const {
  PROGRESS_MARKERS,
  looksLikeProgressAssistantText,
  pickLatestCompletedAssistantText,
  extractHtmlFromAssistantText,
} = require('../scripts/render_promo_preview_text_utils');

function test(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

test('progress markers include key statuses', () => {
  assert.ok(PROGRESS_MARKERS.includes('launching claude'));
  assert.ok(PROGRESS_MARKERS.includes('still working'));
  assert.ok(PROGRESS_MARKERS.includes('prompt:'));
  assert.ok(PROGRESS_MARKERS.includes('history:'));
});

test('looksLikeProgressAssistantText detects progress and ignores final answer', () => {
  assert.strictEqual(looksLikeProgressAssistantText('⏳ Launching Claude'), true);
  assert.strictEqual(looksLikeProgressAssistantText('History: previous messages'), true);
  assert.strictEqual(looksLikeProgressAssistantText('still working on your request'), true);
  assert.strictEqual(looksLikeProgressAssistantText('Вот готовый HTML-файл'), false);
});

test('pickLatestCompletedAssistantText returns last non-progress answer', () => {
  const value = pickLatestCompletedAssistantText([
    '⏳ Launching Claude',
    'Prompt: build a booking app',
    'History: loaded',
    '<!doctype html><html><body>done</body></html>',
  ]);
  assert.strictEqual(value, '<!doctype html><html><body>done</body></html>');
});

test('pickLatestCompletedAssistantText returns empty for only progress/statuses', () => {
  assert.strictEqual(
    pickLatestCompletedAssistantText(['Prompt: x', 'History: y', 'still working']),
    ''
  );
  assert.strictEqual(pickLatestCompletedAssistantText([]), '');
});

test('extractHtmlFromAssistantText extracts fenced html block', () => {
  const raw = 'Answer:\n```html\n<div class="ok">Hello</div>\n```';
  assert.strictEqual(extractHtmlFromAssistantText(raw), '<div class="ok">Hello</div>');
});

test('extractHtmlFromAssistantText extracts generic fenced html-like block', () => {
  const raw = '```\n<section><h1>Title</h1></section>\n```';
  assert.strictEqual(extractHtmlFromAssistantText(raw), '<section><h1>Title</h1></section>');
});

test('extractHtmlFromAssistantText preserves full document', () => {
  const raw = '<!doctype html><html><body><p>Ready</p></body></html>';
  assert.strictEqual(extractHtmlFromAssistantText(raw), raw);
});

test('extractHtmlFromAssistantText wraps html fragment into full document', () => {
  const raw = 'Готово:\n<div>Card</div>';
  assert.strictEqual(
    extractHtmlFromAssistantText(raw),
    '<!doctype html><html><head><meta charset="UTF-8"></head><body><div>Card</div></body></html>'
  );
});

test('extractHtmlFromAssistantText returns empty on plain text', () => {
  assert.strictEqual(extractHtmlFromAssistantText('just plain output'), '');
});

process.stdout.write('all tests passed\n');
