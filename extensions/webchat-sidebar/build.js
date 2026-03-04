#!/usr/bin/env node
/**
 * Chrome extension "compiler" for WebChat side panel embedding.
 *
 * Generates an unpacked MV3 extension directory + zip archive.
 *
 * Usage:
 *   node build.js --name "Codebox - Claude/Codex AI agent in your sidebar" --url "https://coderbox.wpmix.net"
 *
 * Optional:
 *   --short-name "Codebox"
 *   --description "AI coding agent in your Chrome side panel."
 *
 * Icons:
 *   Put PNG icons into `extensions/webchat-sidebar/src/icons/`:
 *   - icon16.png, icon32.png, icon48.png, icon128.png
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCliArgs } = require('./scripts/shared/cli_args');
const { escapeHtml, escapeHtmlAttr } = require('./scripts/shared/html_escape');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmrf(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  ensureDir(dstDir);
  // Node.js v16+ supports fs.cpSync, but keep a small manual copier for portability.
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
  }
}

function readTemplate(relPath) {
  return fs.readFileSync(path.join(__dirname, 'src', relPath), 'utf8');
}

function maybeReadIcon(relName) {
  const p = path.join(__dirname, 'src', 'icons', relName);
  if (!fs.existsSync(p)) return null;
  return { absPath: p, relPath: path.posix.join('icons', relName) };
}

function computeFrameSrc(origin) {
  // Allow the configured origin + wildcard for all subdomains + localhost for dev.
  const parts = [`'self'`, origin];

  // Add wildcard for wpmix.net subdomains (e.g., d123456.wpmix.net)
  if (origin.includes('wpmix.net')) {
    parts.push('https://*.wpmix.net');
  }

  // Allow Google OAuth popups (needed for Sign in with Google)
  parts.push('https://accounts.google.com', 'https://*.google.com');

  parts.push('http://localhost:*', 'https://localhost:*');
  return parts.join(' ');
}

function computeExternallyConnectableMatches(origin) {
  const matches = [];
  try {
    const parsed = new URL(origin);
    matches.push(`${parsed.protocol}//${parsed.hostname}/*`);
    if (parsed.hostname.includes('wpmix.net')) {
      matches.push('https://*.wpmix.net/*');
    }
  } catch (_e) {}
  matches.push('http://localhost/*', 'https://localhost/*', 'http://127.0.0.1/*', 'https://127.0.0.1/*');
  return Array.from(new Set(matches));
}

function main() {
  const args = parseCliArgs(process.argv);

  const name = String(args.name || 'Codebox - AI Workspace in Your Sidebar');
  const shortName = String(args['short-name'] || args.short_name || 'Codebox');
  let url = String(args.url || 'https://coderbox.wpmix.net');
  // Auto-increment: if no --version given, read last built manifest and bump patch
  let version = args.version ? String(args.version) : null;
  if (!version) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/webchat-sidebar/manifest.json'), 'utf8'));
      const parts = (prev.version || '0.1.0').split('.').map(Number);
      parts[2] = (parts[2] || 0) + 1;
      version = parts.join('.');
    } catch (_e) {
      version = '1.0.0';
    }
  }
  const description = String(args.description || 'Upload documents, connect Google Drive, get AI-powered workspace. Perfect for any business process.');

  // Force HTTPS protocol (except localhost)
  try {
    const parsedUrl = new URL(url);
    const host = String(parsedUrl.hostname || '').toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (parsedUrl.protocol === 'http:' && !isLocalhost) {
      console.log(`⚠️  Converting HTTP to HTTPS: ${url}`);
      parsedUrl.protocol = 'https:';
      url = parsedUrl.toString();
      console.log(`✓ Using HTTPS: ${url}`);
    }
  } catch (e) {
    console.error(`❌ Invalid --url: ${url}`);
    process.exit(1);
  }

  let origin;
  try {
    origin = new URL(url).origin;
  } catch (e) {
    console.error(`❌ Failed to extract origin from: ${url}`);
    process.exit(1);
  }
  const connectableMatches = computeExternallyConnectableMatches(origin);

  const outRoot = path.join(__dirname, 'out');
  const outDir = path.join(outRoot, 'webchat-sidebar');
  const zipPath = path.join(outRoot, 'webchat-sidebar.zip');

  rmrf(outDir);
  ensureDir(outDir);

  const manifest = {
    manifest_version: 3,
    name,
    short_name: shortName,
    version,
    description,
    permissions: ['sidePanel', 'activeTab', 'scripting', 'tabs', 'storage'],
    optional_host_permissions: ['*://*.wpmix.net/*'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: name,
    },
    background: {
      service_worker: 'background.js',
    },
    side_panel: {
      default_path: 'panel.html',
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; frame-src ${computeFrameSrc(origin)};`,
    },
    externally_connectable: {
      matches: connectableMatches,
    },
    web_accessible_resources: [
      {
        resources: ['onboarding-screenshots/*'],
        matches: connectableMatches,
      },
    ],
    content_scripts: [
      {
        matches: ['https://*.wpmix.net/*'],
        js: ['ethereum-provider.js'],
        world: 'MAIN',
        run_at: 'document_start',
      },
      {
        matches: ['https://*.wpmix.net/*'],
        js: ['content-script-ethereum.js'],
        run_at: 'document_start',
      },
    ],
  };

  const icons = [
    ['16', maybeReadIcon('icon16.png')],
    ['32', maybeReadIcon('icon32.png')],
    ['48', maybeReadIcon('icon48.png')],
    ['128', maybeReadIcon('icon128.png')],
  ];
  if (icons.some(([, v]) => v)) {
    manifest.icons = {};
    manifest.action.default_icon = {};
    for (const [size, info] of icons) {
      if (!info) continue;
      manifest.icons[size] = info.relPath;
      // Chrome typically uses 16/32 for toolbar icon.
      if (size === '16' || size === '32') {
        manifest.action.default_icon[size] = info.relPath;
      }
    }
  }

  writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const bg = readTemplate('background.js')
    .replaceAll('__WEBCHAT_URL__', url);
  writeFile(path.join(outDir, 'background.js'), bg);

  const panel = readTemplate('panel.html')
    .replaceAll('__TITLE__', escapeHtml(name))
    .replaceAll('__WEBCHAT_URL__', escapeHtmlAttr(url));
  writeFile(path.join(outDir, 'panel.html'), panel);

  const panelJs = readTemplate('panel.js');
  writeFile(path.join(outDir, 'panel.js'), panelJs);
  const panelSharedJs = readTemplate('panel_shared.js');
  writeFile(path.join(outDir, 'panel_shared.js'), panelSharedJs);
  copyDir(path.join(__dirname, 'src', 'onboarding-screenshots'), path.join(outDir, 'onboarding-screenshots'));

  // Copy Web3 wallet files (content scripts, ethers, handlers).
  const web3Files = [
    'ethereum-provider.js',
    'content-script-ethereum.js',
    'eth-request-handler.js',
    'keypair-handlers.js',
  ];
  for (const fileName of web3Files) {
    const src = path.join(__dirname, 'src', fileName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, fileName));
    }
  }

  // CHANGE: Convert ethers.min.js from ESM to IIFE for importScripts() compatibility
  // WHY: ethers v6 ships ESM only (export{...}) which crashes service worker importScripts()
  // REF: Chrome MV3 service workers don't support ESM via importScripts
  const ethersSrc = path.join(__dirname, 'src', 'ethers.min.js');
  if (fs.existsSync(ethersSrc)) {
    let ethersCode = fs.readFileSync(ethersSrc, 'utf8');
    // Extract export names: export{Name1,Name2 as alias,...}
    const exportMatch = ethersCode.match(/export\{([^}]+)\}\s*;?\s*$/);
    if (exportMatch) {
      const exportNames = exportMatch[1]
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      // Strip the export statement
      ethersCode = ethersCode.replace(/export\{[^}]+\}\s*;?\s*$/, '');
      // Wrap in IIFE and expose as globalThis.ethers
      const globalAssign = exportNames.map(n => `${n}`).join(',');
      ethersCode = `(function(){${ethersCode};globalThis.ethers={${globalAssign}};})();`;
      console.log(`✓ Converted ethers.min.js to IIFE (${exportNames.length} exports → globalThis.ethers)`);
    } else {
      console.log('⚠️  ethers.min.js has no ESM export — copying as-is');
    }
    writeFile(path.join(outDir, 'ethers.min.js'), ethersCode);
  }

  // Copy icons if present.
  for (const [, info] of icons) {
    if (!info) continue;
    const content = fs.readFileSync(info.absPath);
    const outIconPath = path.join(outDir, info.relPath);
    ensureDir(path.dirname(outIconPath));
    fs.writeFileSync(outIconPath, content);
  }

  // Don't include store assets in extension ZIP - Chrome Web Store doesn't need them
  // Store assets (icons, screenshots) are uploaded separately via web interface

  // Zip (optional but convenient).
  rmrf(zipPath);
  const zipBin = findBin('zip');
  if (zipBin) {
    const res = spawnSync(zipBin, ['-r', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
    if (res.status !== 0) {
      process.exit(res.status);
    }
  } else {
    // Fallback: python3 stdlib zipfile
    const python = findBin('python3');
    if (!python) {
      console.error('Neither `zip` nor `python3` is available to create archive.');
      process.exit(1);
    }
    const script = `
import os, zipfile
out_dir = r"""${outDir}"""
zip_path = r"""${zipPath}"""
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
  for root, dirs, files in os.walk(out_dir):
    for fn in files:
      full = os.path.join(root, fn)
      rel = os.path.relpath(full, out_dir)
      z.write(full, rel)
print(zip_path)
`;
    const res = spawnSync(python, ['-c', script], { stdio: 'inherit' });
    if (res.status !== 0) {
      process.exit(res.status);
    }
  }

  // ── Post-build verification ──
  console.log('\n🔍 Post-build verification...\n');
  let lintErrors = 0;

  // 1. manifest.json sanity
  const builtManifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  if (builtManifest.name !== name) {
    console.error(`  ❌ manifest.name mismatch: expected "${name}", got "${builtManifest.name}"`);
    lintErrors++;
  } else {
    console.log(`  ✅ manifest.name = "${builtManifest.name}"`);
  }
  if (builtManifest.short_name !== shortName) {
    console.error(`  ❌ manifest.short_name mismatch: expected "${shortName}", got "${builtManifest.short_name}"`);
    lintErrors++;
  } else {
    console.log(`  ✅ manifest.short_name = "${builtManifest.short_name}"`);
  }
  if (!builtManifest.content_security_policy?.extension_pages?.includes(origin)) {
    console.error(`  ❌ CSP does not contain origin: ${origin}`);
    lintErrors++;
  } else {
    console.log(`  ✅ CSP frame-src includes ${origin}`);
  }

  // 2. Required files in output
  const requiredFiles = [
    'manifest.json', 'background.js', 'panel.html', 'panel.js', 'panel_shared.js',
    'ethereum-provider.js', 'content-script-ethereum.js', 'ethers.min.js',
    'eth-request-handler.js', 'keypair-handlers.js',
  ];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(outDir, f))) {
      console.error(`  ❌ Missing required file: ${f}`);
      lintErrors++;
    }
  }
  console.log(`  ✅ All ${requiredFiles.length} required files present`);

  // 3. Icons check
  const requiredIcons = ['icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'];
  let iconsMissing = 0;
  for (const ic of requiredIcons) {
    if (!fs.existsSync(path.join(outDir, ic))) {
      console.error(`  ❌ Missing icon: ${ic}`);
      lintErrors++;
      iconsMissing++;
    }
  }
  if (!iconsMissing) {
    console.log(`  ✅ All ${requiredIcons.length} icons present`);
  }

  // 4. URL correctness in built files
  const bgContent = fs.readFileSync(path.join(outDir, 'background.js'), 'utf8');
  if (!bgContent.includes(url)) {
    console.error(`  ❌ background.js does not contain URL: ${url}`);
    lintErrors++;
  } else {
    console.log(`  ✅ background.js contains correct URL`);
  }
  const panelContent = fs.readFileSync(path.join(outDir, 'panel.html'), 'utf8');
  if (!panelContent.includes(url)) {
    console.error(`  ❌ panel.html does not contain URL: ${url}`);
    lintErrors++;
  } else {
    console.log(`  ✅ panel.html contains correct URL`);
  }

  // 5. No stale product URLs (detect wrong product build)
  const staleUrls = [
    'https://coderbox.wpmix.net',
    'https://clodeboxbot.habab.ru',
    'https://simpledashboard.wpmix.net',
  ].filter(u => u !== url);
  for (const stale of staleUrls) {
    if (bgContent.includes(stale) || panelContent.includes(stale)) {
      console.error(`  ❌ Stale URL from another product found: ${stale}`);
      lintErrors++;
    }
  }
  console.log(`  ✅ No stale URLs from other products`);

  // 6. ZIP exists and reasonable size
  if (fs.existsSync(zipPath)) {
    const zipSize = fs.statSync(zipPath).size;
    if (zipSize < 10000) {
      console.error(`  ❌ ZIP too small (${zipSize} bytes) — likely broken`);
      lintErrors++;
    } else if (zipSize > 10 * 1024 * 1024) {
      console.error(`  ❌ ZIP too large (${(zipSize / 1024 / 1024).toFixed(1)}MB) — check for accidental inclusions`);
      lintErrors++;
    } else {
      console.log(`  ✅ ZIP size OK: ${(zipSize / 1024).toFixed(0)}KB`);
    }
  } else {
    console.error('  ❌ ZIP file not created');
    lintErrors++;
  }

  // 7. No store_assets or node_modules leaked into output
  const forbiddenDirs = ['store_assets', 'node_modules', 'chrome-store-materials', 'previews', 'tests'];
  for (const d of forbiddenDirs) {
    if (fs.existsSync(path.join(outDir, d))) {
      console.error(`  ❌ Forbidden directory in output: ${d}/`);
      lintErrors++;
    }
  }
  console.log(`  ✅ No forbidden directories in output`);

  // 8. Chrome match pattern validation
  // REF: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
  // Rule: wildcard in host must be first char followed by '.' — no d*.example.com
  const matchPatternRe = /^(https?|\*):\/\/(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)\/.*$/;
  const allMatchPatterns = [];
  for (const cs of (builtManifest.content_scripts || [])) {
    for (const m of (cs.matches || [])) allMatchPatterns.push({ pattern: m, source: 'content_scripts' });
  }
  for (const ec of [builtManifest.externally_connectable || {}]) {
    for (const m of (ec.matches || [])) allMatchPatterns.push({ pattern: m, source: 'externally_connectable' });
  }
  for (const war of (builtManifest.web_accessible_resources || [])) {
    for (const m of (war.matches || [])) allMatchPatterns.push({ pattern: m, source: 'web_accessible_resources' });
  }
  let matchOk = 0;
  for (const { pattern, source } of allMatchPatterns) {
    if (!matchPatternRe.test(pattern)) {
      console.error(`  ❌ Invalid match pattern in ${source}: "${pattern}" (wildcard must be first char in host)`);
      lintErrors++;
    } else {
      matchOk++;
    }
  }
  if (matchOk === allMatchPatterns.length && allMatchPatterns.length > 0) {
    console.log(`  ✅ All ${allMatchPatterns.length} match patterns valid`);
  }

  // 9. Manifest V3 required fields
  const mv3Required = ['manifest_version', 'name', 'version'];
  for (const field of mv3Required) {
    if (!builtManifest[field]) {
      console.error(`  ❌ Missing required manifest field: ${field}`);
      lintErrors++;
    }
  }
  if (builtManifest.manifest_version !== 3) {
    console.error(`  ❌ manifest_version must be 3, got ${builtManifest.manifest_version}`);
    lintErrors++;
  } else {
    console.log(`  ✅ Manifest V3 structure valid`);
  }

  // 10. Permissions — no deprecated or dangerous
  const deprecatedPerms = ['background', 'clipboardRead', 'clipboardWrite', 'unlimitedStorage'];
  const dangerousPerms = ['debugger', 'proxy', 'vpnProvider', 'nativeMessaging'];
  for (const p of (builtManifest.permissions || [])) {
    if (deprecatedPerms.includes(p)) {
      console.error(`  ❌ Deprecated permission: "${p}" (may cause Chrome Web Store rejection)`);
      lintErrors++;
    }
    if (dangerousPerms.includes(p)) {
      console.error(`  ❌ Dangerous permission: "${p}" (review needed)`);
      lintErrors++;
    }
  }
  console.log(`  ✅ Permissions check passed (${(builtManifest.permissions || []).length} permissions)`);

  // 11. CSP does not contain 'unsafe-eval' or 'unsafe-inline'
  const cspStr = builtManifest.content_security_policy?.extension_pages || '';
  if (cspStr.includes('unsafe-eval')) {
    console.error(`  ❌ CSP contains 'unsafe-eval' — Chrome Web Store will reject`);
    lintErrors++;
  }
  if (cspStr.includes('unsafe-inline')) {
    console.error(`  ❌ CSP contains 'unsafe-inline' — Chrome Web Store will reject`);
    lintErrors++;
  }
  if (cspStr.includes('http://') && !cspStr.includes('http://localhost')) {
    console.error(`  ❌ CSP contains plain HTTP origin (non-localhost) — insecure`);
    lintErrors++;
  }
  console.log(`  ✅ CSP security check passed`);

  // 12. Version format (must be 1-4 dot-separated integers, each 0-65535)
  const versionParts = (builtManifest.version || '').split('.');
  const versionValid = versionParts.length >= 1 && versionParts.length <= 4 &&
    versionParts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 65535);
  if (!versionValid) {
    console.error(`  ❌ Invalid version format: "${builtManifest.version}" (must be 1-4 dot-separated integers 0-65535)`);
    lintErrors++;
  } else {
    console.log(`  ✅ Version format valid: ${builtManifest.version}`);
  }

  // 13. short_name length (Chrome limit: 12 chars)
  if (builtManifest.short_name && builtManifest.short_name.length > 12) {
    console.error(`  ⚠️  short_name "${builtManifest.short_name}" is ${builtManifest.short_name.length} chars (Chrome recommends ≤12)`);
    // Warning only, not a hard error
  }

  // 14. service_worker file exists
  const swFile = builtManifest.background?.service_worker;
  if (swFile && !fs.existsSync(path.join(outDir, swFile))) {
    console.error(`  ❌ Service worker file missing: ${swFile}`);
    lintErrors++;
  }
  const panelFile = builtManifest.side_panel?.default_path;
  if (panelFile && !fs.existsSync(path.join(outDir, panelFile))) {
    console.error(`  ❌ Side panel file missing: ${panelFile}`);
    lintErrors++;
  }
  console.log(`  ✅ Referenced files exist (service_worker, side_panel)`);

  // 15. content_scripts JS files exist
  let csFilesMissing = 0;
  for (const cs of (builtManifest.content_scripts || [])) {
    for (const jsFile of (cs.js || [])) {
      if (!fs.existsSync(path.join(outDir, jsFile))) {
        console.error(`  ❌ content_script JS file missing: ${jsFile}`);
        lintErrors++;
        csFilesMissing++;
      }
    }
  }
  if (!csFilesMissing) {
    console.log(`  ✅ All content_script JS files exist`);
  }

  console.log('');
  if (lintErrors > 0) {
    console.error(`❌ Build verification FAILED with ${lintErrors} error(s)`);
    process.exit(1);
  }

  console.log('✅ Built extension:');
  console.log(`- Unpacked: ${outDir}`);
  console.log(`- Zip:      ${zipPath}`);
  console.log(`- Product:  ${name} (${shortName})`);
  console.log(`- URL:      ${url}`);
  console.log(`- Version:  ${builtManifest.version}`);
  console.log('');
  console.log('Load unpacked via chrome://extensions → Developer mode → Load unpacked.');
}

function findBin(name) {
  const res = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const p = String(res.stdout || '').trim();
  return p || null;
}

main();
