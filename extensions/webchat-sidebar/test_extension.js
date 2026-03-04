#!/usr/bin/env node
/**
 * Automated Chrome Extension Tester
 *
 * Tests:
 * - CSP violations
 * - iframe loading
 * - postMessage communication
 * - HTTPS enforcement
 * - Side panel opening
 *
 * Usage:
 *   node test_extension.js [extension_path]
 *
 * Example:
 *   node test_extension.js ./out/webchat-sidebar
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const extensionPath = process.argv[2] || path.join(__dirname, 'out', 'webchat-sidebar');

if (!fs.existsSync(extensionPath)) {
  console.error(`❌ Extension not found: ${extensionPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
console.log(`📦 Testing extension: ${manifest.name} v${manifest.version}`);

async function testExtension() {
  const errors = [];
  const warnings = [];

  // Launch Chrome with extension loaded
  const browser = await puppeteer.launch({
    headless: false, // Extensions require non-headless mode
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page = await browser.newPage();

    // Collect console errors and CSP violations
    const cspViolations = [];
    const consoleErrors = [];

    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push(text);
        if (text.includes('Content Security Policy')) {
          cspViolations.push(text);
        }
      }
    });

    // Listen for security policy violations
    page.on('pageerror', error => {
      consoleErrors.push(error.toString());
    });

    // Get extension ID (first loaded extension)
    const targets = await browser.targets();
    const extensionTarget = targets.find(target => target.type() === 'service_worker');
    if (!extensionTarget) {
      errors.push('Extension service worker not found');
      return { errors, warnings };
    }

    const extensionUrl = extensionTarget.url();
    const extensionId = extensionUrl.match(/chrome-extension:\/\/([^\/]+)/)?.[1];

    if (!extensionId) {
      errors.push('Could not extract extension ID');
      return { errors, warnings };
    }

    console.log(`✓ Extension loaded: chrome-extension://${extensionId}`);

    // Test 1: Open side panel page directly
    console.log('\n🧪 Test 1: Loading side panel...');
    const panelUrl = `chrome-extension://${extensionId}/panel.html`;

    await page.goto(panelUrl, { waitUntil: 'networkidle0', timeout: 10000 }).catch(err => {
      errors.push(`Failed to load panel: ${err.message}`);
    });

    await page.waitForTimeout(3000);

    // Check for iframe
    const iframeExists = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe !== null;
    });

    if (!iframeExists) {
      errors.push('Iframe not found in panel.html');
    } else {
      console.log('✓ Iframe exists');
    }

    // Test 2: Check iframe src protocol
    const iframeSrc = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe ? iframe.src : null;
    });

    if (iframeSrc) {
      console.log(`✓ Iframe src: ${iframeSrc}`);

      if (iframeSrc.startsWith('http://') && !iframeSrc.includes('localhost')) {
        errors.push(`Iframe uses insecure HTTP: ${iframeSrc}`);
      } else if (iframeSrc.startsWith('https://') || iframeSrc.includes('localhost')) {
        console.log('✓ Iframe uses HTTPS (or localhost)');
      }
    } else {
      errors.push('Could not get iframe src');
    }

    // Test 3: Check CSP violations
    if (cspViolations.length > 0) {
      errors.push(`CSP violations detected (${cspViolations.length}):`);
      cspViolations.forEach(v => errors.push(`  - ${v}`));
    } else {
      console.log('✓ No CSP violations');
    }

    // Test 4: Check console errors (excluding expected ones)
    const relevantErrors = consoleErrors.filter(err =>
      !err.includes('Failed to load resource') && // Network errors are expected for external sites
      !err.includes('Manifest version') // Chrome warnings about manifest
    );

    if (relevantErrors.length > 0) {
      warnings.push(`Console errors detected (${relevantErrors.length}):`);
      relevantErrors.forEach(e => warnings.push(`  - ${e}`));
    } else {
      console.log('✓ No critical console errors');
    }

    // Test 5: Check iframe communication (postMessage)
    console.log('\n🧪 Test 5: Testing postMessage...');
    const postMessageWorks = await page.evaluate(() => {
      return new Promise((resolve) => {
        const iframe = document.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) {
          resolve(false);
          return;
        }

        let messageReceived = false;
        window.addEventListener('message', (event) => {
          messageReceived = true;
          resolve(true);
        });

        try {
          const iframeOrigin = new URL(iframe.src).origin;
          iframe.contentWindow.postMessage({ type: 'test' }, iframeOrigin);
        } catch (e) {
          resolve(false);
        }

        // Timeout after 2 seconds
        setTimeout(() => {
          if (!messageReceived) resolve(null);
        }, 2000);
      });
    });

    if (postMessageWorks === true) {
      console.log('✓ postMessage working');
    } else if (postMessageWorks === false) {
      errors.push('postMessage failed (iframe not accessible)');
    } else {
      warnings.push('postMessage test timeout (no response from iframe)');
    }

    // Test 6: Screenshot for visual verification
    console.log('\n📸 Taking screenshot...');
    const screenshotPath = path.join(__dirname, 'test-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✓ Screenshot saved: ${screenshotPath}`);

  } catch (error) {
    errors.push(`Test execution error: ${error.message}`);
  } finally {
    await browser.close();
  }

  return { errors, warnings };
}

// Run tests
(async () => {
  console.log('\n🚀 Starting extension tests...\n');

  const { errors, warnings } = await testExtension();

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(60));

  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    warnings.forEach(w => console.log(w));
  }

  if (errors.length > 0) {
    console.log('\n❌ ERRORS:');
    errors.forEach(e => console.log(e));
    console.log('\n❌ Tests FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ All tests PASSED!');
    if (warnings.length > 0) {
      console.log('   (with warnings)');
    }
    process.exit(0);
  }
})();
