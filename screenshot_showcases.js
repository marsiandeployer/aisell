const { execSync } = require('child_process');

// Check if puppeteer is available
try {
  require.resolve('puppeteer');
} catch(e) {
  console.log('Installing puppeteer...');
  execSync('cd /root/aisell && npm install puppeteer', { stdio: 'inherit' });
}

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  console.log('Navigating to https://simpledashboard.wpmix.net/showcases ...');
  await page.goto('https://simpledashboard.wpmix.net/showcases', { waitUntil: 'networkidle2', timeout: 30000 });

  const title = await page.title();
  console.log('Page title:', title);

  const screenshotPath = '/root/aisell/showcases_screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
})();
