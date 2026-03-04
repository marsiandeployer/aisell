#!/usr/bin/env node
/**
 * Detailed check of Google Sign In with console error logging
 */

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Collect console messages
    const logs = [];
    page.on('console', msg => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Collect errors
    const errors = [];
    page.on('pageerror', error => {
      errors.push(`PageError: ${error.message}`);
    });

    // Collect failed requests
    const failedRequests = [];
    page.on('requestfailed', request => {
      failedRequests.push(`Failed: ${request.url()} - ${request.failure().errorText}`);
    });

    await page.setViewport({ width: 1920, height: 1080 });

    console.log('Navigating to https://noxonbot.wpmix.net/...');
    await page.goto('https://noxonbot.wpmix.net/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for potential Google script to load
    await new Promise(r => setTimeout(r, 5000));

    // Check if Google Sign In rendered
    const googleInfo = await page.evaluate(() => {
      const onloadDiv = document.getElementById('g_id_onload');
      const signinDiv = document.querySelector('.g_id_signin');
      const googleScript = document.querySelector('script[src*="accounts.google.com"]');
      const googleIframe = document.querySelector('iframe[src*="accounts.google.com"]');

      return {
        onloadDivExists: !!onloadDiv,
        onloadClientId: onloadDiv ? onloadDiv.getAttribute('data-client_id') : null,
        signinDivExists: !!signinDiv,
        signinDivHTML: signinDiv ? signinDiv.outerHTML.substring(0, 300) : null,
        googleScriptLoaded: !!googleScript,
        googleScriptSrc: googleScript ? googleScript.src : null,
        googleIframeExists: !!googleIframe,
        googleIframeSrc: googleIframe ? googleIframe.src.substring(0, 100) : null
      };
    });

    console.log('\n📊 Google Sign In Status:');
    console.log('  g_id_onload div:', googleInfo.onloadDivExists ? '✅' : '❌');
    console.log('  Client ID:', googleInfo.onloadClientId || '(not set)');
    console.log('  g_id_signin div:', googleInfo.signinDivExists ? '✅' : '❌');
    console.log('  Google script loaded:', googleInfo.googleScriptLoaded ? '✅' : '❌');
    console.log('  Google script src:', googleInfo.googleScriptSrc || '(not found)');
    console.log('  Google iframe rendered:', googleInfo.googleIframeExists ? '✅' : '❌');

    if (googleInfo.googleIframeExists) {
      console.log('  Google iframe src:', googleInfo.googleIframeSrc);
    }

    if (googleInfo.signinDivHTML) {
      console.log('\n  signin div HTML:', googleInfo.signinDivHTML);
    }

    if (errors.length > 0) {
      console.log('\n❌ Page Errors:');
      errors.forEach(e => console.log('  -', e));
    }

    if (failedRequests.length > 0) {
      console.log('\n❌ Failed Requests:');
      failedRequests.forEach(f => console.log('  -', f));
    }

    if (logs.length > 0) {
      console.log('\n📋 Console Logs:');
      logs.forEach(l => console.log('  ', l));
    }

    // Take screenshot
    await page.screenshot({
      path: '/root/aisell/noxonbot_google_detailed.png',
    });
    console.log('\n✅ Screenshot saved: /root/aisell/noxonbot_google_detailed.png');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
