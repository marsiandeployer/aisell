const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  try {
    await page.goto('https://noxonbot.wpmix.net/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/root/aisell/botplatform/noxonbot_screenshot.png', fullPage: true });
    console.log('Screenshot saved to /root/aisell/botplatform/noxonbot_screenshot.png');

    // Check for Google Sign-in button
    const googleButtonExists = await page.$('a[href*="google"], button[class*="google"], .google-signin, [data-provider="google"], a[class*="google"]') !== null;
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasGoogleText = pageText.toLowerCase().includes('sign in with google') || pageText.toLowerCase().includes('google');

    console.log('Google button by selector:', googleButtonExists);
    console.log('Google text found:', hasGoogleText);
    console.log('Page title:', await page.title());
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/root/aisell/botplatform/noxonbot_error.png', fullPage: true });
  }

  await browser.close();
})();
