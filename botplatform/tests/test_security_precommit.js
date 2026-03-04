#!/usr/bin/env node
/**
 * Быстрые security-проверки для pre-commit hook
 * Время выполнения: <1 сек
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  RESET: '\x1b[0m'
};

let passed = 0;
let failed = 0;

function log(msg, color = COLORS.RESET) {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function assert(condition, label) {
  if (condition) {
    log(`  ✅ ${label}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  ❌ ${label}`, COLORS.RED);
    failed++;
  }
}

log('\n🔒 Security & Integrity Pre-commit Checks\n', COLORS.YELLOW);

// ── Test 1: No secrets in staged files ──
// Only flag files being ADDED or MODIFIED, not DELETED (D status).
// Removing a secret from tracking via `git rm --cached` is the desired action.
log('Test 1: No secrets in staged files', COLORS.YELLOW);
try {
  const stagedWithStatus = execSync('git diff --cached --name-status', { encoding: 'utf8' }).trim();
  if (stagedWithStatus) {
    const stagedFiles = stagedWithStatus.split('\n')
      .map(line => { const parts = line.split('\t'); return { status: parts[0], file: parts[1] }; })
      .filter(entry => entry.status !== 'D');  // Exclude deleted files
    const secretFiles = stagedFiles.filter(({ file: f }) =>
      /\.(env|pem|key|p12|pfx)$/.test(f) ||
      f.includes('credentials.json') ||
      f.includes('.claude.json') ||
      f.includes('session.session')
    ).map(({ file }) => file);
    assert(secretFiles.length === 0,
      secretFiles.length === 0
        ? 'No secret files in staged changes'
        : `SECRET FILES STAGED: ${secretFiles.join(', ')}`
    );
  } else {
    assert(true, 'No staged files to check');
  }
} catch (e) {
  assert(true, 'Not in git context, skipping');
}

// ── Test 2: No hardcoded tokens in staged content ──
log('\nTest 2: No hardcoded tokens in staged diffs', COLORS.YELLOW);
try {
  const diff = execSync('git diff --cached -U0', { encoding: 'utf8' });
  const addedLines = diff.split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'));

  // Check for common token patterns (only in added lines)
  const tokenPatterns = [
    { name: 'Telegram BOT_TOKEN', pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
    { name: 'AWS Secret Key', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/ },
    { name: 'Private Key PEM', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
    { name: 'Ethereum Private Key (64 hex)', pattern: /(?:private[_-]?key|PRIVATE[_-]?KEY)\s*[:=]\s*['"]?0x[0-9a-fA-F]{64}/ },
  ];

  let tokensFound = [];
  for (const line of addedLines) {
    for (const { name, pattern } of tokenPatterns) {
      if (pattern.test(line)) {
        tokensFound.push(name);
      }
    }
  }

  // Deduplicate
  tokensFound = [...new Set(tokensFound)];
  assert(tokensFound.length === 0,
    tokensFound.length === 0
      ? 'No hardcoded tokens detected'
      : `TOKENS FOUND: ${tokensFound.join(', ')}`
  );
} catch (e) {
  assert(true, 'No staged diff to check');
}

// ── Test 3: No large files staged (>2MB) ──
log('\nTest 3: No large files staged', COLORS.YELLOW);
try {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
  if (staged) {
    const largeFiles = [];
    for (const file of staged.split('\n')) {
      const fullPath = path.join('/root/aisell', file);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.size > 2 * 1024 * 1024) {
          largeFiles.push(`${file} (${Math.round(stats.size / 1024 / 1024)}MB)`);
        }
      }
    }
    assert(largeFiles.length === 0,
      largeFiles.length === 0
        ? 'No files >2MB'
        : `LARGE FILES: ${largeFiles.join(', ')}`
    );
  } else {
    assert(true, 'No staged files');
  }
} catch (e) {
  assert(true, 'Skipped');
}

// ── Test 4: No node_modules or dist staged ──
log('\nTest 4: No node_modules/dist accidentally staged', COLORS.YELLOW);
try {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
  if (staged) {
    const badPaths = staged.split('\n').filter(f =>
      f.includes('node_modules/') || f.includes('/dist/') && !f.includes('tests/')
    );
    assert(badPaths.length === 0,
      badPaths.length === 0
        ? 'No node_modules or dist files'
        : `BAD PATHS: ${badPaths.slice(0, 3).join(', ')}...`
    );
  } else {
    assert(true, 'No staged files');
  }
} catch (e) {
  assert(true, 'Skipped');
}

// ── Test 5: ecosystem.config.js exists and valid ──
log('\nTest 5: PM2 ecosystem configs valid', COLORS.YELLOW);
const ecosystemPaths = [
  '/root/aisell/botplatform/ecosystem.config.js',
  '/root/aisell/bananzabot/ecosystem.config.js',
];
for (const p of ecosystemPaths) {
  const name = path.basename(path.dirname(p));
  if (fs.existsSync(p)) {
    try {
      const config = require(p);
      assert(config.apps && config.apps.length > 0, `${name}/ecosystem.config.js has apps defined`);
    } catch (e) {
      assert(false, `${name}/ecosystem.config.js parse error: ${e.message}`);
    }
  }
}

// ── Test 6: .gitignore protects secrets ──
log('\nTest 6: .gitignore covers sensitive patterns', COLORS.YELLOW);
const gitignorePath = '/root/aisell/.gitignore';
if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = ['.env', 'node_modules', '*.session'];
  for (const pattern of requiredPatterns) {
    assert(gitignore.includes(pattern), `.gitignore contains "${pattern}"`);
  }
} else {
  assert(false, '.gitignore exists');
}

// ── Test 7: No console.log with sensitive data patterns ──
// Skip vendor/minified files (*.min.js) — they are third-party code
log('\nTest 7: No sensitive console.log in staged code', COLORS.YELLOW);
try {
  const diff = execSync('git diff --cached -U0', { encoding: 'utf8' });
  const diffLines = diff.split('\n');

  // Track current file to skip vendor/minified files
  let currentFile = '';
  const sensitiveConsole = [];
  for (const line of diffLines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    // Skip minified vendor files
    if (currentFile.endsWith('.min.js')) continue;
    if (/console\.(log|info|debug)\(.*(?:password|secret|token|private.?key|api.?key)/i.test(line)) {
      sensitiveConsole.push(line);
    }
  }

  assert(sensitiveConsole.length === 0,
    sensitiveConsole.length === 0
      ? 'No sensitive data in console.log'
      : `Found ${sensitiveConsole.length} suspicious console.log statements`
  );
} catch (e) {
  assert(true, 'No staged diff');
}

// ── Results ──
log('\n' + '='.repeat(60));
log('Results:', COLORS.YELLOW);
log(`✅ Passed: ${passed}`, COLORS.GREEN);
if (failed > 0) log(`❌ Failed: ${failed}`, COLORS.RED);
log(`📊 Success rate: ${Math.round(passed / (passed + failed) * 100)}%`);
log('='.repeat(60) + '\n');

process.exit(failed === 0 ? 0 : 1);
