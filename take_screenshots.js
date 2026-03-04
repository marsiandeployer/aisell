const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE = 'https://simpledashboard.wpmix.net/showcases';
const DIR = '/root/aisell/products/simple_dashboard/showcases';

const shots = [
  { url: BASE + '/invoice-generator/demo.html',   out: DIR + '/invoice-generator/screenshot-1280x800.png' },
  { url: BASE + '/lead-tracker/demo.html',         out: DIR + '/lead-tracker/screenshot-1280x800.png' },
  { url: BASE + '/project-kanban/demo.html',       out: DIR + '/project-kanban/screenshot-1280x800.png' },
  { url: BASE + '/construction-crm/demo.html',     out: DIR + '/construction-crm/screenshot-1280x800.png' },
  { url: BASE + '/sales-analytics-utm/demo.html',  out: DIR + '/sales-analytics-utm/screenshot-1280x800.png' },
  { url: BASE + '/funnel-analytics/demo.html',     out: DIR + '/funnel-analytics/screenshot-1280x800.png' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  for (const s of shots) {
    const page = await browser.newPage();
    console.log('→', s.url);
    try {
      await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2500));
      fs.mkdirSync(path.dirname(s.out), { recursive: true });
      await page.screenshot({ path: s.out });
      console.log('  ✓', path.basename(path.dirname(s.out)));
    } catch(e) {
      console.error('  ✗', e.message);
    }
    await page.close();
  }

  await browser.close();
  console.log('Done.');
})();
