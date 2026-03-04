#!/usr/bin/env node
/**
 * Check login modal and menu visibility
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

    // Try to find and click menu button
    const menuButton = await page.$('button.menu-toggle, .menu-button, #menuButton');
    if (menuButton) {
      console.log('Clicking menu button...');
      await menuButton.click();
      await new Promise(r => setTimeout(r, 1000));

      // Take screenshot of menu
      await page.screenshot({
        path: '/root/aisell/noxonbot_menu_open.png',
      });
      console.log('✅ Menu screenshot saved');
    } else {
      console.log('⚠️  Menu button not found, menu might be always visible');
    }

    // Check page state
    const pageState = await page.evaluate(() => {
      // Check menu items
      const menuEl = document.getElementById('menu');
      const logoutLink = document.querySelector('a[href="/logout"]');
      const profileLink = document.querySelector('a[href="/profile"]');
      const loginModal = document.getElementById('loginModal');
      const googleSignInDiv = document.getElementById('g_id_signin');

      return {
        menuExists: !!menuEl,
        menuVisible: menuEl ? window.getComputedStyle(menuEl).display !== 'none' : false,
        menuHTML: menuEl ? menuEl.innerHTML.substring(0, 500) : null,
        logoutExists: !!logoutLink,
        logoutVisible: logoutLink ? window.getComputedStyle(logoutLink).display !== 'none' : false,
        logoutStyle: logoutLink ? logoutLink.style.display : null,
        profileExists: !!profileLink,
        profileVisible: profileLink ? window.getComputedStyle(profileLink).display !== 'none' : false,
        loginModalExists: !!loginModal,
        loginModalVisible: loginModal ? window.getComputedStyle(loginModal).display !== 'none' : false,
        googleSignInExists: !!googleSignInDiv,
        userInfo: document.getElementById('me')?.textContent || ''
      };
    });

    console.log('\n📊 Page State:');
    console.log('  Menu:', pageState.menuExists ? '✅ exists' : '❌ not found');
    console.log('  Menu visible:', pageState.menuVisible ? '✅' : '❌');
    console.log('  Logout link:', pageState.logoutExists ? '✅ exists' : '❌ not found');
    console.log('  Logout visible:', pageState.logoutVisible ? '✅' : '❌');
    console.log('  Logout style.display:', pageState.logoutStyle);
    console.log('  Profile link:', pageState.profileExists ? '✅ exists' : '❌ not found');
    console.log('  Profile visible:', pageState.profileVisible ? '✅' : '❌');
    console.log('  Login modal:', pageState.loginModalExists ? '✅ exists' : '❌ not found');
    console.log('  Login modal visible:', pageState.loginModalVisible ? '✅' : '❌');
    console.log('  Google Sign In div:', pageState.googleSignInExists ? '✅ exists' : '❌ not found');
    console.log('  User info:', pageState.userInfo || '(empty)');

    if (pageState.menuHTML) {
      console.log('\n📄 Menu HTML (first 500 chars):');
      console.log(pageState.menuHTML);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
