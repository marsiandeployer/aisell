#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXT_ROOT = path.resolve(__dirname, '..');
const TMP_RENDER_OUT = '/tmp/webchat_sidebar_prod_integration.png';

function runNode(args, cwd) {
  const result = spawnSync('node', args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stdout = String(result.stdout || '');
    const stderr = String(result.stderr || '');
    throw new Error(`Command failed: node ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return result;
}

function test(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

test('build.js creates unpacked extension and zip using production flow', () => {
  runNode(
    [
      'build.js',
      '--name',
      'Prod Test Sidebar',
      '--short-name',
      'ProdTest',
      '--url',
      'https://coderbox.onout.org',
      '--version',
      '9.9.9',
      '--description',
      'Production integration test build',
    ],
    EXT_ROOT
  );

  const manifestPath = path.join(EXT_ROOT, 'out', 'webchat-sidebar', 'manifest.json');
  const panelPath = path.join(EXT_ROOT, 'out', 'webchat-sidebar', 'panel.html');
  const panelSharedPath = path.join(EXT_ROOT, 'out', 'webchat-sidebar', 'panel_shared.js');
  const zipPath = path.join(EXT_ROOT, 'out', 'webchat-sidebar.zip');

  assert.ok(fs.existsSync(manifestPath), 'manifest.json should exist after build');
  assert.ok(fs.existsSync(panelPath), 'panel.html should exist after build');
  assert.ok(fs.existsSync(panelSharedPath), 'panel_shared.js should exist after build');
  assert.ok(fs.existsSync(zipPath), 'zip archive should exist after build');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.name, 'Prod Test Sidebar');
  assert.strictEqual(manifest.short_name, 'ProdTest');
  assert.strictEqual(manifest.version, '9.9.9');

  const panel = fs.readFileSync(panelPath, 'utf8');
  assert.ok(panel.includes('https://coderbox.onout.org'), 'panel.html should include configured URL');
  assert.ok(panel.includes('panel_shared.js'), 'panel.html should include shared runtime script');
});

test('render_promo_preview.js produces a real png file', () => {
  runNode(
    [
      'scripts/render_promo_preview.js',
      '--html',
      'previews/promo-yoga-with-calendar.html',
      '--out',
      TMP_RENDER_OUT,
    ],
    EXT_ROOT
  );

  assert.ok(fs.existsSync(TMP_RENDER_OUT), 'rendered PNG should exist');
  const buf = fs.readFileSync(TMP_RENDER_OUT);
  assert.ok(buf.length > 1024, 'rendered PNG should not be tiny');

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.ok(buf.subarray(0, 4).equals(pngSignature), 'output should have PNG signature');
});

process.stdout.write('all tests passed\n');
