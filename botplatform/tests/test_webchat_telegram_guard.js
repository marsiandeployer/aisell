#!/usr/bin/env node
/**
 * Test: ctx.telegram guards in webchat context
 *
 * bot.ts is shared between Telegram and Webchat.
 * In webchat, ctx.telegram is undefined → any unguarded call crashes the process.
 *
 * This test:
 * 1. Static analysis — every ctx.telegram.* call must be inside try/catch or have a guard
 * 2. Specific check — scheduleSendDraft (the method that crashed) has a guard
 * 3. Runtime — send a webchat message, verify process doesn't crash
 *
 * Run: node tests/test_webchat_telegram_guard.js
 * Env: WEBCHAT_PORT (default 8094)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m',
};

let passed = 0;
let failed = 0;

function log(msg, color = COLORS.RESET) {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function assert(condition, description) {
  if (condition) {
    log(`  ✅ ${description}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  ❌ ${description}`, COLORS.RED);
    failed++;
  }
}

// ─── Test 1: Static — all ctx.telegram calls must be in try/catch or guarded ─

log('\n🔍 Test 1: Static analysis — ctx.telegram protection\n', COLORS.CYAN);

const botTsPath = path.join(__dirname, '..', 'src', 'bot.ts');
const content = fs.readFileSync(botTsPath, 'utf8');
const lines = content.split('\n');

// Find all ctx.telegram.* calls (skip comments and guard lines)
const telegramCallLines = [];
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
  if (trimmed.includes('!ctx.telegram') || trimmed.includes('typeof ctx.telegram')) continue;
  if (/ctx\.telegram\.\w+/.test(trimmed)) {
    telegramCallLines.push({ lineNum: i + 1, code: trimmed });
  }
}

assert(telegramCallLines.length > 0, `Found ${telegramCallLines.length} ctx.telegram calls to check`);

/**
 * For each call, walk backwards to find:
 *   (a) a try { in the enclosing scope → protected by try/catch
 *   (b) if (!ctx.telegram) in the same method → protected by guard
 * We also accept callers wrapping the call in try/catch (check method invocations).
 */
let unprotectedCount = 0;

for (const { lineNum, code } of telegramCallLines) {
  // Walk backwards to find method boundary and check protection
  let foundTry = false;
  let foundGuard = false;
  let braceBalance = 0;

  for (let i = lineNum - 2; i >= Math.max(0, lineNum - 80); i--) {
    const l = lines[i];

    // Track brace balance going backwards
    for (let c = l.length - 1; c >= 0; c--) {
      if (l[c] === '}') braceBalance++;
      if (l[c] === '{') braceBalance--;
    }

    // Only look at same scope level or enclosing
    if (braceBalance > 0) continue;

    if (/\btry\s*\{?\s*$/.test(l.trim()) || l.trim() === 'try {') {
      foundTry = true;
      break;
    }
    if (/if\s*\(\s*!ctx\.telegram/.test(l)) {
      foundGuard = true;
      break;
    }

    // Hit method boundary — stop searching
    if (/^\s+(private|public|protected|async)\s/.test(l) && braceBalance <= 0) {
      break;
    }
  }

  const protected_ = foundTry || foundGuard;
  if (!protected_) {
    log(`  ⚠️  Line ${lineNum}: ${code.slice(0, 70)}`, COLORS.YELLOW);
    unprotectedCount++;
  }
}

// Allow known Telegram-only methods (downloadFile is only called from Telegram handlers,
// all callers wrap in try/catch). If a NEW unprotected call appears, the test fails.
const KNOWN_TELEGRAM_ONLY_LINES = 1; // downloadFile line 1915
assert(
  unprotectedCount <= KNOWN_TELEGRAM_ONLY_LINES,
  `Unprotected ctx.telegram calls: ${unprotectedCount} (allowed: ${KNOWN_TELEGRAM_ONLY_LINES} Telegram-only)`
);

// ─── Test 2: scheduleSendDraft specifically has guard (the method that crashed) ─

log('\n🔍 Test 2: scheduleSendDraft guard\n', COLORS.CYAN);

// Find the method by searching for its signature and extracting until next method
const sigIdx = lines.findIndex(l => /scheduleSendDraft\s*\(/.test(l) && /private/.test(l));
assert(sigIdx !== -1, 'scheduleSendDraft method found');

if (sigIdx !== -1) {
  // Collect method body (up to 40 lines or next private/public method)
  const bodyLines = [];
  for (let i = sigIdx + 1; i < Math.min(sigIdx + 40, lines.length); i++) {
    if (/^\s+(private|public|protected)\s/.test(lines[i]) && i > sigIdx + 2) break;
    bodyLines.push(lines[i]);
  }
  const body = bodyLines.join('\n');

  const hasGuard = /if\s*\(\s*!ctx\.telegram\b/.test(body);
  assert(hasGuard, 'scheduleSendDraft has if (!ctx.telegram) guard');

  if (hasGuard) {
    const guardPos = body.indexOf('!ctx.telegram');
    const callApiPos = body.indexOf('callApi');
    assert(
      callApiPos === -1 || guardPos < callApiPos,
      'Guard appears BEFORE callApi call'
    );
  }
}

// ─── Test 3: Runtime — webchat message doesn't crash the process ─────────────

log('\n🔍 Test 3: Runtime — webchat stability\n', COLORS.CYAN);

const WEBCHAT_PORT = process.env.WEBCHAT_PORT || 8094;

function getRestartCount() {
  try {
    const out = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8' });
    const procs = JSON.parse(out);
    const proc = procs.find(p => p.name === 'simpledashboard-web');
    return proc ? proc.pm2_env.restart_time : -1;
  } catch {
    return -1;
  }
}

function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (chunk) => (chunks += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRuntimeTest() {
  const restartsBefore = getRestartCount();
  if (restartsBefore === -1) {
    log('  ⏭  SKIP: simpledashboard-web not running in PM2', COLORS.YELLOW);
    return;
  }

  assert(true, `Process restart count before: ${restartsBefore}`);

  // Send a message to webchat (field name is "text", not "message")
  try {
    const chatId = `test_guard_${Date.now()}`;
    const res = await httpPost(WEBCHAT_PORT, '/api/message', {
      chatId,
      text: 'test guard — reply OK',
    });

    // 200 = message accepted, 401/403 = auth required (also acceptable — process didn't crash)
    const acceptable = [200, 401, 403].includes(res.status);
    assert(acceptable, `POST /api/message returned HTTP ${res.status} (acceptable: 200/401/403)`);

    // Wait for streaming path to execute (scheduleSendDraft is called during streaming)
    await sleep(3000);

    const restartsAfter = getRestartCount();
    assert(
      restartsAfter === restartsBefore,
      `Process stable: restarts before=${restartsBefore}, after=${restartsAfter}`
    );
  } catch (err) {
    assert(false, `Runtime test error: ${err.message}`);
  }
}

async function main() {
  await runRuntimeTest();

  // ─── Summary ──────────────────────────────────────────────────────────
  log('\n' + '═'.repeat(60), COLORS.CYAN);
  log(`📊 Results: ✅ ${passed} passed, ❌ ${failed} failed`, failed > 0 ? COLORS.RED : COLORS.GREEN);
  log('═'.repeat(60) + '\n', COLORS.CYAN);

  process.exit(failed > 0 ? 1 : 0);
}

main();
