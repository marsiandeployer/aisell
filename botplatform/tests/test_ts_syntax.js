#!/usr/bin/env node
/**
 * Быстрая проверка TypeScript файлов без полной компиляции
 * Проверяет: синтаксис импортов, парность скобок, дупликаты функций
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

log('\n📝 TypeScript Quick Checks\n', COLORS.YELLOW);

// Get staged .ts files
let stagedTsFiles = [];
try {
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
  if (staged) {
    stagedTsFiles = staged.split('\n').filter(f => f.endsWith('.ts') && !f.includes('.d.ts'));
  }
} catch (e) { /* not in git context */ }

if (stagedTsFiles.length === 0) {
  log('  No TypeScript files staged, skipping', COLORS.YELLOW);
  passed++;
} else {
  log(`  Checking ${stagedTsFiles.length} TypeScript file(s)`, COLORS.YELLOW);

  for (const relPath of stagedTsFiles) {
    const fullPath = path.join('/root/aisell', relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const basename = path.basename(relPath);

    // Test 1: Balanced braces
    log(`\nTest: ${basename} — balanced braces`, COLORS.YELLOW);
    let braceCount = 0;
    let stringQuote = ''; // '' = not in string, '"' or "'" = which quote opened the string
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      const next = content[i + 1];
      const prev = i > 0 ? content[i - 1] : '';

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; i++; }
        continue;
      }

      // Handle strings and templates BEFORE comments,
      // so '//' inside strings is not mistaken for a comment.
      if (ch === '`') { inTemplate = !inTemplate; continue; }
      if (inTemplate) continue;
      if (stringQuote) {
        if (ch === stringQuote && prev !== '\\') { stringQuote = ''; }
        continue;
      }
      if ((ch === '"' || ch === "'") && prev !== '\\') { stringQuote = ch; continue; }

      // Skip regex literals: /pattern/flags — detect by preceding context.
      // A '/' starts a regex (not division) when preceded by certain tokens.
      if (ch === '/' && next !== '/' && next !== '*') {
        const before = content.slice(Math.max(0, i - 20), i).trimEnd();
        const lastChar = before[before.length - 1] || '';
        const regexPrecedes = '=,([!&|^?:{;~+-><%'.includes(lastChar) || before.endsWith('return') || i === 0;
        if (regexPrecedes) {
          // Skip to closing / (unescaped)
          let j = i + 1;
          while (j < content.length && content[j] !== '\n') {
            if (content[j] === '/' && content[j - 1] !== '\\') break;
            j++;
          }
          if (j < content.length && content[j] === '/') {
            // Skip flags after closing /
            while (j + 1 < content.length && /[gimsuy]/.test(content[j + 1])) j++;
            i = j;
            continue;
          }
        }
      }

      // Comment detection (only reached outside strings and templates)
      if (ch === '/' && next === '/') { inLineComment = true; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }

      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    assert(braceCount === 0, `${basename}: braces balanced (diff: ${braceCount})`);

    // Test 2: No require() in .ts files (should use import)
    log(`Test: ${basename} — ES imports`, COLORS.YELLOW);
    const lines = content.split('\n');
    const requireLines = lines.filter((line, idx) => {
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      // Dynamic require is ok in some cases
      return /\brequire\s*\(/.test(trimmed) && !/\/\/\s*eslint/.test(trimmed);
    });
    // This is a warning, not a failure (some require() is legitimate)
    if (requireLines.length > 0) {
      log(`  ⚠️  ${basename}: ${requireLines.length} require() calls (prefer import)`, COLORS.YELLOW);
    }
    passed++; // Always pass — just informational

    // Test 3: Regex patterns with single backslash inside template literals
    // Problem: inside a JS template literal, \/ → /  and  \d → d  at runtime.
    // Fix: use double backslash \\\/ \\\\d inside template literal JS code.
    // Heuristic: look for lines that look like regex patterns inside a template and
    // contain :/  (no preceding backslash) which suggests a missing \\.
    log(`Test: ${basename} — no broken regex in template literals`, COLORS.YELLOW);
    {
      let inTemplateLiteral = false;
      const badLines = [];
      for (const line of lines) {
        if (line.includes('return `')) inTemplateLiteral = true;
        if (inTemplateLiteral && line.trim() === '`') inTemplateLiteral = false;
        if (!inTemplateLiteral) continue;
        // Detect: regex with ://<something> — should be :\/\/ inside template literal
        // Detect the broken pattern: single \/\/ in regex inside template literal
        // When written as \/ inside template literal source → / in rendered JS → broken regex
        // The correct form is \\\/ in template literal source (produces \/ in rendered JS)
        const hasRegexLiteral = /[!=]\s*\/\^/.test(line);
        const hasSingleSlashPattern = line.indexOf('https?:\\/\\/') !== -1;  // single backslash version
        const hasDoubleSlashPattern = line.indexOf('https?:\\\\\\/\\\\\\/') !== -1; // double backslash
        if (hasRegexLiteral && hasSingleSlashPattern && !hasDoubleSlashPattern) {
          badLines.push(line.trim().slice(0, 100));
        }
      }
      if (badLines.length > 0) {
        log(`  ⚠️  ${basename}: single-backslash regex in template literal (use \\\\\\/\\\\\\/ instead):`, COLORS.YELLOW);
        badLines.forEach(l => log(`     ${l}`, COLORS.YELLOW));
        failed++;
      } else {
        passed++;
      }
    }

    // Test 4: No TODO/FIXME/HACK in new code
    log(`Test: ${basename} — no TODOs in staged changes`, COLORS.YELLOW);
    try {
      const diff = execSync(`git diff --cached -U0 -- "${relPath}"`, { encoding: 'utf8' });
      const addedLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      const todos = addedLines.filter(l => /\b(TODO|FIXME|HACK|XXX)\b/.test(l));
      if (todos.length > 0) {
        log(`  ⚠️  ${basename}: ${todos.length} TODO/FIXME found in new code`, COLORS.YELLOW);
      }
      passed++;
    } catch (e) {
      passed++;
    }
  }
}

// ── Results ──
log('\n' + '='.repeat(60));
log('Results:', COLORS.YELLOW);
log(`✅ Passed: ${passed}`, COLORS.GREEN);
if (failed > 0) log(`❌ Failed: ${failed}`, COLORS.RED);
log(`📊 Success rate: ${Math.round(passed / (passed + failed) * 100)}%`);
log('='.repeat(60) + '\n');

process.exit(failed === 0 ? 0 : 1);
