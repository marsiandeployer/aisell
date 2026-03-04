#!/usr/bin/env node
/**
 * Check if Google Sign In button appears on noxonbot.wpmix.net
 */

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('Navigating to https://noxonbot.wpmix.net/...');
    await page.goto('https://noxonbot.wpmix.net/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to fully load
    await new Promise(r => setTimeout(r, 3000));

    // Take screenshot
    const screenshotPath = '/root/aisell/noxonbot_google_signin.png';
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    console.log(`✅ Screenshot saved: ${screenshotPath}`);

    // Check for Google Sign In elements
    const hasGoogleButton = await page.evaluate(() => {
      // Check for Google Sign In div
      const gSignInDiv = document.querySelector('#g_id_signin');
      const gSignInIframe = document.querySelector('iframe[src*="accounts.google.com"]');
      const googleText = document.body.innerText.includes('Sign in with Google') ||
                         document.body.innerText.includes('Google');

      return {
        hasGSignInDiv: !!gSignInDiv,
        hasGSignInIframe: !!gSignInIframe,
        hasGoogleText: googleText,
        menuVisible: document.querySelector('#menu') !== null,
        logoutVisible: document.querySelector('a[href="/logout"]') !== null
      };
    });

    console.log('\n📊 Page Analysis:');
    console.log(`  - Google Sign In div (#g_id_signin): ${hasGoogleButton.hasGSignInDiv ? '✅' : '❌'}`);
    console.log(`  - Google iframe present: ${hasGoogleButton.hasGSignInIframe ? '✅' : '❌'}`);
    console.log(`  - Google-related text: ${hasGoogleButton.hasGoogleText ? '✅' : '❌'}`);
    console.log(`  - Menu visible: ${hasGoogleButton.menuVisible ? '✅' : '❌'}`);
    console.log(`  - Logout link visible: ${hasGoogleButton.logoutVisible ? '✅' : '❌'}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
