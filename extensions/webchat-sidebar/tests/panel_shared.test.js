#!/usr/bin/env node
const assert = require('assert');
const {
  escapeHtml,
  readFileCreatedPayload,
  normalizeUserId,
  buildPreviewUrl,
  hasIndexHtmlCreatedSignal,
  buildFileCreatedMessageFromHistory,
  toOpenPreviewAction,
} = require('../src/panel_shared');

function test(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

test('escapeHtml escapes html entities', () => {
  assert.strictEqual(
    escapeHtml(`<div class="x">Tom & 'Jerry'</div>`),
    '&lt;div class=&quot;x&quot;&gt;Tom &amp; &#039;Jerry&#039;&lt;/div&gt;'
  );
});

test('readFileCreatedPayload reads direct payload', () => {
  const value = readFileCreatedPayload({
    filename: 'index.html',
    url: 'https://d123.wpmix.net/',
  });
  assert.deepStrictEqual(value, {
    filename: 'index.html',
    url: 'https://d123.wpmix.net/',
  });
});

test('readFileCreatedPayload reads nested data payload', () => {
  const value = readFileCreatedPayload({
    type: 'file_created',
    data: {
      filename: 'index.html',
      url: 'https://d999.wpmix.net/',
    },
  });
  assert.deepStrictEqual(value, {
    filename: 'index.html',
    url: 'https://d999.wpmix.net/',
  });
});

test('toOpenPreviewAction builds open_preview action only for index.html', () => {
  assert.deepStrictEqual(
    toOpenPreviewAction({ filename: 'index.html', url: 'https://d1.wpmix.net/' }),
    { type: 'open_preview', url: 'https://d1.wpmix.net/' }
  );
  assert.strictEqual(
    toOpenPreviewAction({ filename: 'styles.css', url: 'https://d1.wpmix.net/' }),
    null
  );
  assert.strictEqual(
    toOpenPreviewAction({ filename: 'index.html', url: '' }),
    null
  );
});

test('normalizeUserId strips user_ prefix', () => {
  assert.strictEqual(normalizeUserId('user_12345'), '12345');
  assert.strictEqual(normalizeUserId('67890'), '67890');
  assert.strictEqual(normalizeUserId(''), '');
});

test('buildPreviewUrl builds workspace URL', () => {
  assert.strictEqual(buildPreviewUrl('user_42'), 'https://d42.wpmix.net/');
  assert.strictEqual(buildPreviewUrl('42'), 'https://d42.wpmix.net/');
  assert.strictEqual(buildPreviewUrl(''), '');
});

test('hasIndexHtmlCreatedSignal detects creation phrases', () => {
  assert.strictEqual(hasIndexHtmlCreatedSignal('Файл index.html создан успешно'), true);
  assert.strictEqual(hasIndexHtmlCreatedSignal('File index.html created'), true);
  assert.strictEqual(hasIndexHtmlCreatedSignal('index.html saved to disk'), true);
  assert.strictEqual(hasIndexHtmlCreatedSignal('main.js created'), false);
});

test('buildFileCreatedMessageFromHistory returns event only for valid assistant tail message', () => {
  const event = buildFileCreatedMessageFromHistory(
    [{ role: 'assistant', text: 'File index.html created' }],
    'user_777'
  );
  assert.deepStrictEqual(event, {
    type: 'file_created',
    filename: 'index.html',
    url: 'https://d777.wpmix.net/',
  });

  assert.strictEqual(
    buildFileCreatedMessageFromHistory(
      [{ role: 'assistant', text: 'main.js created' }],
      'user_777'
    ),
    null
  );
});

process.stdout.write('all tests passed\n');
