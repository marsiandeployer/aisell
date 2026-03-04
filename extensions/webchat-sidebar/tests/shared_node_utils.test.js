#!/usr/bin/env node
const assert = require('assert');
const { parseCliArgs } = require('../scripts/shared/cli_args');
const { escapeHtml, escapeHtmlAttr } = require('../scripts/shared/html_escape');

function test(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

test('parseCliArgs reads key-value and boolean flags', () => {
  const parsed = parseCliArgs([
    'node',
    'script.js',
    '--name',
    'Sidebar',
    '--url',
    'https://coderbox.wpmix.net',
    '--dry-run',
    '--version',
    '1.2.3',
  ]);

  assert.deepStrictEqual(parsed, {
    name: 'Sidebar',
    url: 'https://coderbox.wpmix.net',
    'dry-run': 'true',
    version: '1.2.3',
  });
});

test('parseCliArgs supports custom startIndex', () => {
  const parsed = parseCliArgs(['--one', '1', '--flag'], { startIndex: 0 });
  assert.deepStrictEqual(parsed, { one: '1', flag: 'true' });
});

test('escapeHtml escapes reserved symbols', () => {
  const value = `<a href="x&y">'ok'</a>`;
  assert.strictEqual(
    escapeHtml(value),
    '&lt;a href=&quot;x&amp;y&quot;&gt;&#039;ok&#039;&lt;/a&gt;'
  );
});

test('escapeHtmlAttr is equivalent to escapeHtml', () => {
  const value = `"quoted" & 'single'`;
  assert.strictEqual(escapeHtmlAttr(value), escapeHtml(value));
});

process.stdout.write('all tests passed\n');
