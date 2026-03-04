#!/usr/bin/env node
/**
 * Production-oriented auto-preview checks.
 *
 * This file intentionally imports runtime helpers used by sidebar/webchat.
 * No duplicated mock implementations.
 */

const assert = require('assert');
const {
  buildFileCreatedMessageFromHistory,
  toOpenPreviewAction,
  buildPreviewUrl,
} = require('./src/panel_shared');

function test(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

test('webchat helper builds file_created event for assistant index.html message', () => {
  const event = buildFileCreatedMessageFromHistory(
    [{ role: 'assistant', text: 'Файл index.html создан успешно!' }],
    'user_123456'
  );
  assert.deepStrictEqual(event, {
    type: 'file_created',
    filename: 'index.html',
    url: 'https://d123456.wpmix.net/',
  });
});

test('webchat helper ignores non-assistant or non-index messages', () => {
  assert.strictEqual(
    buildFileCreatedMessageFromHistory([{ role: 'user', text: 'создай index.html' }], 'user_123'),
    null
  );
  assert.strictEqual(
    buildFileCreatedMessageFromHistory([{ role: 'assistant', text: 'создал main.js' }], 'user_123'),
    null
  );
});

test('panel helper converts file_created to open_preview action', () => {
  const action = toOpenPreviewAction({
    type: 'file_created',
    filename: 'index.html',
    url: 'https://d999.wpmix.net/',
  });
  assert.deepStrictEqual(action, {
    type: 'open_preview',
    url: 'https://d999.wpmix.net/',
  });
});

test('panel helper supports nested payload style', () => {
  const action = toOpenPreviewAction({
    type: 'file_created',
    data: {
      filename: 'index.html',
      url: 'https://d555.wpmix.net/',
    },
  });
  assert.deepStrictEqual(action, {
    type: 'open_preview',
    url: 'https://d555.wpmix.net/',
  });
});

test('full flow: assistant message -> file_created -> open_preview', () => {
  const fileCreated = buildFileCreatedMessageFromHistory(
    [{ role: 'assistant', text: 'File index.html created successfully!' }],
    'user_42'
  );
  const action = toOpenPreviewAction(fileCreated);
  assert.deepStrictEqual(action, {
    type: 'open_preview',
    url: buildPreviewUrl('user_42'),
  });
});

process.stdout.write('all tests passed\n');
