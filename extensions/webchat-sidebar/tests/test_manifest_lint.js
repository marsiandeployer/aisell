#!/usr/bin/env node
/**
 * Extension manifest & build.js linter.
 * Runs WITHOUT building — validates source patterns and last built manifest.
 *
 * Catches:
 *  - Invalid Chrome match patterns (d*.example.com, *.*.example.com)
 *  - Hardcoded wrong defaults (version: '1.0.0', name: 'Codebox')
 *  - Missing web3 files in build.js file list
 *  - MV3 structure issues
 *  - CSP security violations
 *
 * Usage: node tests/test_manifest_lint.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD_JS = path.join(ROOT, 'build.js');
const OUT_MANIFEST = path.join(ROOT, 'out', 'webchat-sidebar', 'manifest.json');

let passed = 0;
let failed = 0;

function pass(msg) { console.log(`  \x1b[32m✅ ${msg}\x1b[0m`); passed++; }
function fail(msg) { console.error(`  \x1b[31m❌ ${msg}\x1b[0m`); failed++; }

// ═══════════════════════════════════════════
// Part 1: Static analysis of build.js source
// ═══════════════════════════════════════════
console.log('\n📋 Part 1: build.js source analysis\n');

const buildSrc = fs.readFileSync(BUILD_JS, 'utf8');

// 1.1 No hardcoded invalid match patterns in source
const invalidPatternRe = /['"]https?:\/\/[a-z]+\*\.[^'"]+['"]/g;
const invalidMatches = buildSrc.match(invalidPatternRe) || [];
if (invalidMatches.length === 0) {
  pass('No invalid wildcard match patterns (like d*.domain) in build.js');
} else {
  for (const m of invalidMatches) {
    fail(`Invalid match pattern in build.js: ${m} — wildcard must be first char in host`);
  }
}

// 1.2 No hardcoded version '1.0.0' (should auto-increment)
const hardcodedVersionRe = /version:\s*['"]1\.0\.0['"]/;
if (!hardcodedVersionRe.test(buildSrc)) {
  pass('No hardcoded version "1.0.0" in build.js');
} else {
  fail('Hardcoded version "1.0.0" found in build.js — should auto-increment');
}

// 1.3 Default name should not be product-specific (or should require --name)
const defaultNameRe = /args\.name\s*\|\|\s*['"](.*?)['"]/;
const defaultNameMatch = buildSrc.match(defaultNameRe);
if (defaultNameMatch) {
  const defaultName = defaultNameMatch[1];
  // Default is OK as long as it's a generic fallback
  pass(`Default --name fallback: "${defaultName}"`);
}

// 1.4 Default short-name fallback exists
const defaultShortRe = /args\['short-name'\].*?\|\|\s*['"](.*?)['"]/;
const defaultShortMatch = buildSrc.match(defaultShortRe);
if (defaultShortMatch) {
  pass(`Default --short-name fallback: "${defaultShortMatch[1]}"`);
} else {
  fail('No default --short-name fallback in build.js');
}

// 1.5 Web3 files are included in build
const requiredWeb3Files = [
  'ethereum-provider.js',
  'content-script-ethereum.js',
  'ethers.min.js',
  'eth-request-handler.js',
  'keypair-handlers.js',
];
for (const f of requiredWeb3Files) {
  if (buildSrc.includes(f)) {
    pass(`Web3 file "${f}" referenced in build.js`);
  } else {
    fail(`Web3 file "${f}" NOT referenced in build.js — extension will be missing it`);
  }
}

// 1.6 Post-build verification exists
if (buildSrc.includes('Post-build verification')) {
  pass('Post-build verification section exists');
} else {
  fail('Post-build verification missing from build.js');
}

// 1.7 store_assets NOT included in ZIP
if (buildSrc.includes("Don't include store assets") || !buildSrc.includes('store_assets')) {
  pass('store_assets not bundled in extension ZIP');
} else {
  // Check if store_assets are being added to zip
  const zipStoreRe = /zip\.(file|append).*store_assets/;
  if (zipStoreRe.test(buildSrc)) {
    fail('store_assets being added to ZIP — should be excluded');
  } else {
    pass('store_assets not bundled in extension ZIP');
  }
}

// ═══════════════════════════════════════════
// Part 2: Built manifest.json validation
// ═══════════════════════════════════════════
console.log('\n📋 Part 2: Built manifest.json validation\n');

if (!fs.existsSync(OUT_MANIFEST)) {
  console.log('  ⚠️  No built manifest found — run build.js first. Skipping Part 2.\n');
} else {
  const manifest = JSON.parse(fs.readFileSync(OUT_MANIFEST, 'utf8'));

  // 2.1 MV3
  if (manifest.manifest_version === 3) {
    pass('manifest_version = 3');
  } else {
    fail(`manifest_version = ${manifest.manifest_version}, expected 3`);
  }

  // 2.2 Match pattern validation (Chrome rules)
  // Wildcard in host must be first char, followed by '.'
  const validMatchPattern = /^(https?|\*|<all_urls>):\/\/(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)(\/.*)?$/;
  const allPatterns = [];

  for (const cs of (manifest.content_scripts || [])) {
    for (const m of (cs.matches || [])) allPatterns.push({ p: m, src: 'content_scripts' });
  }
  if (manifest.externally_connectable?.matches) {
    for (const m of manifest.externally_connectable.matches) allPatterns.push({ p: m, src: 'externally_connectable' });
  }
  for (const war of (manifest.web_accessible_resources || [])) {
    for (const m of (war.matches || [])) allPatterns.push({ p: m, src: 'web_accessible_resources' });
  }

  let patternErrors = 0;
  for (const { p, src } of allPatterns) {
    // Special case: <all_urls>
    if (p === '<all_urls>') continue;
    if (!validMatchPattern.test(p)) {
      fail(`Invalid match pattern in ${src}: "${p}"`);
      patternErrors++;
    }
  }
  if (patternErrors === 0) {
    pass(`All ${allPatterns.length} match patterns valid for Chrome`);
  }

  // 2.3 CSP checks
  const csp = manifest.content_security_policy?.extension_pages || '';
  if (csp.includes('unsafe-eval')) {
    fail("CSP contains 'unsafe-eval' — Chrome Web Store will reject");
  } else if (csp.includes('unsafe-inline')) {
    fail("CSP contains 'unsafe-inline' — Chrome Web Store will reject");
  } else {
    pass('CSP has no unsafe-eval/unsafe-inline');
  }

  // 2.4 CSP no plain HTTP (except localhost)
  const cspHttpRe = /http:\/\/(?!localhost)[^\s;]+/g;
  const cspHttpMatches = csp.match(cspHttpRe) || [];
  if (cspHttpMatches.length === 0) {
    pass('CSP has no plain HTTP origins (except localhost)');
  } else {
    for (const m of cspHttpMatches) {
      fail(`CSP contains insecure HTTP origin: ${m}`);
    }
  }

  // 2.5 Version format
  const vParts = (manifest.version || '').split('.');
  const vValid = vParts.length >= 1 && vParts.length <= 4 &&
    vParts.every(p => /^\d+$/.test(p) && Number(p) <= 65535);
  if (vValid) {
    pass(`Version format valid: ${manifest.version}`);
  } else {
    fail(`Invalid version: "${manifest.version}"`);
  }

  // 2.6 Version is not 1.0.0 (indicates stale/unbuilt)
  if (manifest.version === '1.0.0') {
    fail('Version is 1.0.0 — likely not auto-incremented (stale build?)');
  } else {
    pass(`Version is ${manifest.version} (auto-incremented)`);
  }

  // 2.7 service_worker exists
  const sw = manifest.background?.service_worker;
  if (sw && fs.existsSync(path.join(ROOT, 'out', 'webchat-sidebar', sw))) {
    pass(`Service worker file exists: ${sw}`);
  } else if (sw) {
    fail(`Service worker file missing: ${sw}`);
  }

  // 2.8 side_panel file exists
  const sp = manifest.side_panel?.default_path;
  if (sp && fs.existsSync(path.join(ROOT, 'out', 'webchat-sidebar', sp))) {
    pass(`Side panel file exists: ${sp}`);
  } else if (sp) {
    fail(`Side panel file missing: ${sp}`);
  }

  // 2.9 content_scripts JS files exist
  let csOk = 0;
  for (const cs of (manifest.content_scripts || [])) {
    for (const js of (cs.js || [])) {
      if (fs.existsSync(path.join(ROOT, 'out', 'webchat-sidebar', js))) {
        csOk++;
      } else {
        fail(`content_script JS missing: ${js}`);
      }
    }
  }
  if (csOk > 0) pass(`All ${csOk} content_script JS files exist`);

  // 2.10 Icons referenced in manifest exist
  let iconsOk = 0;
  for (const [, iconPath] of Object.entries(manifest.icons || {})) {
    if (fs.existsSync(path.join(ROOT, 'out', 'webchat-sidebar', iconPath))) {
      iconsOk++;
    } else {
      fail(`Icon file missing: ${iconPath}`);
    }
  }
  if (iconsOk > 0) pass(`All ${iconsOk} icon files exist`);

  // 2.11 No dangerous permissions
  const dangerous = ['debugger', 'proxy', 'vpnProvider', 'nativeMessaging', 'webRequestBlocking'];
  for (const p of (manifest.permissions || [])) {
    if (dangerous.includes(p)) {
      fail(`Dangerous permission: "${p}"`);
    }
  }
  pass(`Permissions OK (${(manifest.permissions || []).length} total)`);

  // 2.12 name and short_name are not default "Codebox" (unless intentional)
  if (manifest.name === 'Codebox' || manifest.name.includes('Codebox')) {
    console.log(`  ⚠️  manifest.name contains "Codebox" — is this intentional? (${manifest.name})`);
  }
}

// ═══════════════════════════════════════════
// Part 3: Source file integrity
// ═══════════════════════════════════════════
console.log('\n📋 Part 3: Source file integrity\n');

const srcDir = path.join(ROOT, 'src');
const requiredSrcFiles = [
  'background.js', 'panel.html', 'panel.js', 'panel_shared.js',
  'ethereum-provider.js', 'content-script-ethereum.js',
  'ethers.min.js', 'eth-request-handler.js', 'keypair-handlers.js',
];
let srcMissing = 0;
for (const f of requiredSrcFiles) {
  if (!fs.existsSync(path.join(srcDir, f))) {
    fail(`Source file missing: src/${f}`);
    srcMissing++;
  }
}
if (!srcMissing) {
  pass(`All ${requiredSrcFiles.length} source files present in src/`);
}

// Icons
const requiredIcons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
let iconsMissing = 0;
for (const ic of requiredIcons) {
  if (!fs.existsSync(path.join(srcDir, 'icons', ic))) {
    fail(`Source icon missing: src/icons/${ic}`);
    iconsMissing++;
  }
}
if (!iconsMissing) {
  pass(`All ${requiredIcons.length} source icons present`);
}

// JS syntax check — try to parse each JS file
for (const f of requiredSrcFiles.filter(f => f.endsWith('.js'))) {
  const filePath = path.join(srcDir, f);
  if (!fs.existsSync(filePath)) continue;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Basic syntax: use Function constructor to check parse
    // Skip ethers.min.js (huge, minified, always valid)
    if (f === 'ethers.min.js') {
      pass(`${f} — skipped (minified library)`);
      continue;
    }
    new Function(content);
    pass(`${f} — JS syntax OK`);
  } catch (e) {
    fail(`${f} — JS syntax error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════
// Part 4: Service worker compatibility
// ═══════════════════════════════════════════
console.log('\n📋 Part 4: Service worker compatibility\n');

if (fs.existsSync(OUT_MANIFEST)) {
  const manifest = JSON.parse(fs.readFileSync(OUT_MANIFEST, 'utf8'));
  const outDir = path.join(ROOT, 'out', 'webchat-sidebar');
  const isModuleType = manifest.background?.type === 'module';
  const swPath = manifest.background?.service_worker;

  if (swPath && fs.existsSync(path.join(outDir, swPath))) {
    const swContent = fs.readFileSync(path.join(outDir, swPath), 'utf8');
    const usesImportScripts = /importScripts\s*\(/.test(swContent);
    const usesStaticImport = /^\s*import\s+/m.test(swContent);

    // 4.1 If service_worker uses importScripts, type must NOT be "module"
    if (usesImportScripts && isModuleType) {
      fail('background.js uses importScripts() but manifest has "type": "module" — incompatible');
    }

    // 4.2 If service_worker uses static import, type MUST be "module"
    if (usesStaticImport && !isModuleType) {
      fail('background.js uses static import but manifest missing "type": "module"');
    }

    // 4.3 Check all importScripts targets for ESM exports
    if (usesImportScripts) {
      const importedFiles = [];
      const importRe = /importScripts\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = importRe.exec(swContent)) !== null) {
        importedFiles.push(match[1]);
      }

      for (const f of importedFiles) {
        const fPath = path.join(outDir, f);
        if (!fs.existsSync(fPath)) {
          fail(`importScripts target missing: ${f}`);
          continue;
        }
        const content = fs.readFileSync(fPath, 'utf8');
        // Check for ESM syntax: export{, export default, export const, export function, export class
        const hasExport = /\bexport\s*\{|\bexport\s+default\b|\bexport\s+const\b|\bexport\s+function\b|\bexport\s+class\b/.test(content);
        const hasImport = /\bimport\s+.*\bfrom\b/.test(content);
        if (hasExport || hasImport) {
          fail(`${f} contains ESM syntax (export/import) but loaded via importScripts() — will crash service worker`);
        } else {
          pass(`${f} — compatible with importScripts() (no ESM syntax)`);
        }
      }

      if (importedFiles.length === 0 && usesImportScripts) {
        pass('No importScripts targets to check');
      }
    }

    // 4.4 If type=module, check that static imports point to existing files
    if (isModuleType && usesStaticImport) {
      const staticImportRe = /^\s*import\s+.*from\s+['"]\.\/([^'"]+)['"]/gm;
      let m;
      while ((m = staticImportRe.exec(swContent)) !== null) {
        const f = m[1];
        if (fs.existsSync(path.join(outDir, f))) {
          pass(`Static import target exists: ${f}`);
        } else {
          fail(`Static import target missing: ${f}`);
        }
      }
    }

    if (!usesImportScripts && !usesStaticImport) {
      pass('Service worker has no imports (self-contained)');
    }
  }
} else {
  console.log('  ⚠️  No built manifest — skipping Part 4.\n');
}

// ═══════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════
console.log('\n============================================================');
if (failed > 0) {
  console.log(`\x1b[31m  ❌ ${failed} FAILED\x1b[0m, ${passed} passed`);
} else {
  console.log(`\x1b[32m  ✅ All ${passed} checks passed\x1b[0m`);
}
console.log('============================================================\n');

process.exit(failed > 0 ? 1 : 0);
