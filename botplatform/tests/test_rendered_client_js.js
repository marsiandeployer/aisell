#!/usr/bin/env node
/**
 * Checks that the rendered webchat HTML page has valid client-side JavaScript.
 *
 * Problem this test prevents:
 *   When client-side JS is embedded inside a TypeScript template literal,
 *   backslash escape sequences (\/  \d  \.)  are evaluated by the JS engine
 *   at runtime, dropping the backslashes. E.g. the regex /^https?:\/\/d\d+\./
 *   written as-is inside a template literal becomes /^https?://dd+./  in the
 *   rendered page — causing a SyntaxError: Unexpected token '.'.
 *
 *   Fix: double every backslash in regex patterns inside template literals:
 *     \/  → \\/     \d → \\d     \. → \\.     etc.
 *
 * Usage:
 *   node tests/test_rendered_client_js.js
 *   WEBCHAT_PORT=8094 node tests/test_rendered_client_js.js
 */

'use strict';

const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.WEBCHAT_PORT || 8094;
const URL  = `http://localhost:${PORT}/?lang=ru&ext_id=test`;

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';

let passed = 0;
let failed = 0;

function ok(label) { console.log(`${GREEN}  ✅ ${label}${RESET}`); passed++; }
function fail(label, detail) {
  console.log(`${RED}  ❌ ${label}${RESET}`);
  if (detail) console.log(`     ${detail}`);
  failed++;
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function extractInlineScript(html) {
  // Grab everything between the LAST <script> ... </script> pair
  // (the app's inline script is the only large script block)
  const start = html.indexOf('<script>');
  const end   = html.lastIndexOf('</script>');
  if (start === -1 || end === -1) return null;
  return html.slice(start + 8, end);
}

async function main() {
  console.log(`\n${YELLOW}🔍 Rendered client-side JS checks  (${URL})\n${RESET}`);

  // ── 1. Page loads ────────────────────────────────────────────────────────
  let page;
  try {
    page = await fetchPage(URL);
  } catch (e) {
    fail('Page reachable', e.message);
    process.exit(1);
  }

  if (page.status === 200) {
    ok(`HTTP 200`);
  } else {
    fail(`HTTP 200`, `got ${page.status}`);
    process.exit(1);
  }

  const html = page.body;

  // ── 2. Extract inline script ─────────────────────────────────────────────
  const js = extractInlineScript(html);
  if (js && js.length > 1000) {
    ok(`Inline script found (${Math.round(js.length / 1024)}KB)`);
  } else {
    fail('Inline script found', js ? `too short: ${js.length}` : 'not found');
    process.exit(1);
  }

  // ── 3. Broken regex: https?:// (double slash without backslash) ──────────
  // Pattern: a regex literal that has ://  instead of  :\/\/
  // Catches: template literal backslash-drop bug
  const brokenSlash = /https\?:\/\//.source;  // this is the CORRECT pattern string
  // What we're scanning FOR in the rendered JS is the *broken* version:
  const brokenRe = /https\?:\/\/[a-zA-Z0-9$_]/; // regex-in-regex context (not in strings)

  // Simpler: just search the rendered JS text for the broken two-slash sequence
  // inside what looks like a regex literal: !/^https?://
  const brokenPattern = /!\s*\/\^https\?:\/\//;   // broken: //  not  \/\/

  if (brokenPattern.test(js)) {
    fail('No broken regex !/^https?://', 'Found "!/^https?://" — backslashes stripped from template literal. Use \\\\/\\\\/ instead of \\/ \\/ inside template literal.');
  } else {
    ok('No broken regex !/^https?://' );
  }

  // ── 4. Regex backslash patterns (general) ────────────────────────────────
  // Inside a JS string/template literal, \d  \s  \w  \.  become  d  s  w  .
  // So the rendered page should have proper backslashes in regex patterns.
  // Check: any regex literal that should contain \d but has bare digit quantifiers
  // Heuristic: look for  /^d  pattern without backslash before d (common mistake)
  const bareDigit = /\/\^d\(/;   // e.g. /^d(  instead of /^d\(  but this is fine...
  // Better: scan for the specific broken pattern from our codebase
  const knownBroken = [
    { re: /https\?:\/\/dd\+/, label: '\\d lost in https regex (became dd+)' },
  ];
  for (const { re, label } of knownBroken) {
    if (re.test(js)) {
      fail(`No "${label}"`, `Pattern found in rendered JS`);
    } else {
      ok(`No "${label}"`);
    }
  }

  // ── 5. Node.js syntax check ───────────────────────────────────────────────
  // Write script to a temp file and run `node --check`
  const tmp = '/tmp/_webchat_inline_test.js';
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    execSync(`node --check ${tmp}`, { stdio: 'pipe' });
    ok('Node.js syntax check passed');
  } catch (e) {
    const msg = (e.stderr || e.stdout || '').toString().slice(0, 200);
    fail('Node.js syntax check', msg || 'syntax error');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`${GREEN}✅ Passed: ${passed}${RESET}  ${failed > 0 ? RED : ''}❌ Failed: ${failed}${RESET}`);
  console.log('='.repeat(60) + '\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(RED + 'Fatal: ' + e.message + RESET);
  process.exit(1);
});
