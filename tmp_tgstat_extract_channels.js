const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TGSTAT_URL = process.env.TGSTAT_URL || 'https://tgstat.ru/channel/@vibe_coding';
const OUT_SCREENSHOT = process.env.OUT_SCREENSHOT || '/tmp/tgstat_vibe_coding_extract.png';

function normalizeUsername(u) {
  if (!u) return null;
  u = u.trim();
  if (u.startsWith('@')) u = u.slice(1);
  u = u.replace(/[^A-Za-z0-9_]/g, '');
  return u || null;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7' });
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  try {
    await page.goto(TGSTAT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const title = (document.title || '').toLowerCase();
      const hasCf = title.includes('just a moment') || !!document.querySelector('form[action*="cdn-cgi"]');
      return !hasCf;
    }, { timeout: 90000 });

    // Wait a bit for async parts.
    await sleep(2500);

    const data = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const raw = anchors.map(a => ({
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      }));

      // Extract potential channel usernames from /channel/@... links.
      const usernames = [];
      for (const r of raw) {
        if (!r.href) continue;
        const m = r.href.match(/\/channel\/@([A-Za-z0-9_]+)/);
        if (!m) continue;
        const uname = m[1];
        usernames.push({ uname, href: r.href, text: r.text });
      }

      // Also check any visible text blocks that look like @username lists.
      const bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
      const atMentions = Array.from(new Set((bodyText.match(/@[A-Za-z0-9_]{5,}/g) || []).map(s => s.slice(1))));

      return {
        title: document.title,
        url: location.href,
        userLinks: usernames,
        atMentions
      };
    });

    await page.screenshot({ path: OUT_SCREENSHOT, fullPage: true });

    // Normalize + filter obvious non-targets.
    const self = 'vibe_coding';
    const fromLinks = data.userLinks
      .map(x => ({
        username: x.uname,
        href: x.href,
        text: x.text
      }))
      .filter(x => x.username && x.username.toLowerCase() !== self);

    const fromMentions = data.atMentions
      .map(u => u)
      .filter(u => u && u.toLowerCase() !== self);

    // Rank candidates by occurrence count.
    const counts = new Map();
    for (const x of fromLinks) {
      const k = x.username.toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const u of fromMentions) {
      const k = u.toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 0.5);
    }

    const unique = Array.from(new Set(fromLinks.map(x => x.username.toLowerCase())));
    const candidates = unique
      .map(u => ({
        username: u,
        count: counts.get(u) || 0,
        examples: fromLinks.filter(x => x.username.toLowerCase() === u).slice(0, 5)
      }))
      .sort((a, b) => b.count - a.count);

    process.stdout.write(JSON.stringify({
      title: data.title,
      url: data.url,
      screenshot: OUT_SCREENSHOT,
      candidate_channels: candidates.slice(0, 50)
    }, null, 2));
  } catch (e) {
    try { await page.screenshot({ path: OUT_SCREENSHOT, fullPage: true }); } catch {}
    console.error(String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
