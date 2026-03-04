const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TGSTAT_URL = process.env.TGSTAT_URL || 'https://tgstat.ru/channel/@vibe_coding';
const OUT_SCREENSHOT = process.env.OUT_SCREENSHOT || '/tmp/tgstat_vibe_coding.png';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  });

  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  const t0 = Date.now();

  try {
    await page.goto(TGSTAT_URL, { waitUntil: 'domcontentloaded' });

    // Cloudflare managed challenge sometimes resolves after a short delay.
    await page.waitForFunction(() => {
      const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
      const hasChannelLinks = hrefs.some(h => h.includes('/channel/@'));
      const title = (document.title || '').toLowerCase();
      const looksLikeCf = title.includes('just a moment') || hrefs.some(h => h.includes('cdn-cgi'));
      return hasChannelLinks && !looksLikeCf;
    }, { timeout: 90000 });

    // Give a bit more time for content to render.
    await sleep(2000);

    const title = await page.title();
    const url = page.url();

    await page.screenshot({ path: OUT_SCREENSHOT, fullPage: true });

    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));

    const channelLinks = Array.from(new Set(hrefs
      .filter(Boolean)
      .map(h => {
        try { return new URL(h, 'https://tgstat.ru').toString(); } catch { return null; }
      })
      .filter(Boolean)
      .filter(u => u.includes('tgstat.ru') && u.includes('/channel/@'))
      .map(u => u.replace('https://tgstat.ru/en/', 'https://tgstat.ru/'))
    ));

    process.stdout.write(JSON.stringify({
      title,
      url,
      elapsed_ms: Date.now() - t0,
      screenshot: OUT_SCREENSHOT,
      channelLinks
    }, null, 2));
  } catch (e) {
    // Always dump a screenshot for debugging.
    try { await page.screenshot({ path: OUT_SCREENSHOT, fullPage: true }); } catch {}
    throw e;
  } finally {
    await browser.close();
  }
})();
