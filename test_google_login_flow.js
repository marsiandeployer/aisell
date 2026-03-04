#!/usr/bin/env node
/**
 * Test the Google Sign In login flow by triggering the modal
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

    // Wait for page to load
    await new Promise(r => setTimeout(r, 2000));

    console.log('Typing test message...');
    await page.type('#input', 'Hello test message');

    console.log('Clicking Send button...');
    await page.click('#sendBtn');

    // Wait for login modal to appear
    await new Promise(r => setTimeout(r, 2000));

    // Check if login modal is visible
    const modalVisible = await page.evaluate(() => {
      const modal = document.getElementById('loginModal');
      const googleSignIn = document.querySelector('.g_id_signin');
      const googleIframe = document.querySelector('iframe[src*="accounts.google.com"]');

      return {
        modalExists: !!modal,
        modalHasOpenClass: modal ? modal.classList.contains('open') : false,
        googleSignInExists: !!googleSignIn,
        googleIframeExists: !!googleIframe,
        googleButtonVisible: googleSignIn ? window.getComputedStyle(googleSignIn).display !== 'none' : false
      };
    });

    console.log('\n📊 Login Modal Status (after clicking Send):');
    console.log('  Modal exists:', modalVisible.modalExists ? '✅' : '❌');
    console.log('  Modal is open:', modalVisible.modalHasOpenClass ? '✅' : '❌');
    console.log('  Google Sign In div:', modalVisible.googleSignInExists ? '✅' : '❌');
    console.log('  Google iframe:', modalVisible.googleIframeExists ? '✅' : '❌');
    console.log('  Google button visible:', modalVisible.googleButtonVisible ? '✅' : '❌');

    // Take screenshot
    await page.screenshot({
      path: '/root/aisell/noxonbot_login_modal.png',
      fullPage: false
    });
    console.log('\n✅ Screenshot saved: /root/aisell/noxonbot_login_modal.png');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
