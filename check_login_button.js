#!/usr/bin/env node
/**
 * Check if login button appears next to hamburger menu
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
    await new Promise(r => setTimeout(r, 3000));

    // Check if login button exists and is visible
    const loginButtonInfo = await page.evaluate(() => {
      const loginBtn = document.getElementById('loginBtn');
      const themeToggle = document.getElementById('themeToggle');
      const menuBtn = document.getElementById('menuBtn');

      return {
        loginBtnExists: !!loginBtn,
        loginBtnVisible: loginBtn ? window.getComputedStyle(loginBtn).display !== 'none' : false,
        loginBtnText: loginBtn ? loginBtn.textContent : null,
        themeToggleExists: !!themeToggle,
        menuBtnExists: !!menuBtn
      };
    });

    console.log('\n📊 Login Button Status:');
    console.log('  Login button exists:', loginButtonInfo.loginBtnExists ? '✅' : '❌');
    console.log('  Login button visible:', loginButtonInfo.loginBtnVisible ? '✅' : '❌');
    console.log('  Login button text:', loginButtonInfo.loginBtnText || '(not found)');
    console.log('  Theme toggle exists:', loginButtonInfo.themeToggleExists ? '✅' : '❌');
    console.log('  Menu button exists:', loginButtonInfo.menuBtnExists ? '✅' : '❌');

    // Take screenshot
    await page.screenshot({
      path: '/root/aisell/noxonbot_with_login_button.png',
      fullPage: false
    });
    console.log('\n✅ Screenshot saved: /root/aisell/noxonbot_with_login_button.png');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
