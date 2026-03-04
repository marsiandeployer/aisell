#!/usr/bin/env node
/**
 * Generate main_banner.png (EN) + main_banner_ru.png for Chrome Web Store.
 * Standalone — loads images from local showcase files.
 *
 * Usage: node take_banner_screenshot.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUT_EN = path.join(__dirname, 'main_banner.png');
const OUT_RU = path.join(__dirname, 'main_banner_ru.png');
const SHOWCASES_DIR = path.join(__dirname, 'showcases');

function img(subpath) {
  const full = path.join(SHOWCASES_DIR, subpath);
  if (!fs.existsSync(full)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(full).toString('base64');
}

// EN screenshots (always exist)
const shotsEN = [
  img('construction-crm/screenshot-1280x800.png'),
  img('sales-analytics-utm/screenshot-1280x800.png'),
  img('funnel-analytics/screenshot-1280x800.png'),
  img('invoice-generator/screenshot-1280x800.png'),
  img('lead-tracker/screenshot-1280x800.png'),
  img('project-kanban/screenshot-1280x800.png'),
];

// RU screenshots — fallback to EN if no -ru version
const shotsRU = [
  img('construction-crm/screenshot-1280x800-ru.png') || shotsEN[0],
  img('sales-analytics-utm/screenshot-1280x800-ru.png') || shotsEN[1],
  img('funnel-analytics/screenshot-1280x800-ru.png') || shotsEN[2],
  img('invoice-generator/screenshot-1280x800.png'),   // no RU
  img('lead-tracker/screenshot-1280x800.png'),         // no RU
  img('project-kanban/screenshot-1280x800.png'),       // no RU
];

function buildHTML(title, sub, imageSet) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px;
    height: 800px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(160deg, #0c1529 0%, #08101f 50%, #0d1a30 100%);
  }

  .banner {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .title-card {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 20;
    text-align: center;
    max-width: 740px;
    padding: 36px 56px;
    border-radius: 28px;
    background: rgba(8, 14, 30, 0.55);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3);
  }

  .title-card h1 {
    font-size: 68px;
    font-weight: 900;
    color: #fff;
    line-height: 1.08;
    letter-spacing: -0.03em;
    margin: 0;
  }

  .title-card p {
    margin-top: 14px;
    font-size: 19px;
    font-weight: 400;
    color: rgba(200, 215, 235, 0.82);
    line-height: 1.45;
    letter-spacing: 0;
  }

  .shot {
    position: absolute;
    object-fit: cover;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 18px 52px rgba(0, 0, 0, 0.6);
  }

  .s1 {
    width: 620px;
    left: -140px;
    top: -60px;
    transform: rotate(-8deg);
    z-index: 2;
    filter: brightness(0.80);
  }
  .s2 {
    width: 580px;
    left: -100px;
    bottom: -100px;
    transform: rotate(5deg);
    z-index: 1;
    filter: brightness(0.72);
  }
  .s3 {
    width: 660px;
    left: 42%;
    top: 54%;
    transform: translate(-50%, -50%) rotate(-1deg);
    z-index: 10;
    filter: brightness(0.85);
  }
  .s4 {
    width: 620px;
    right: -160px;
    top: -70px;
    transform: rotate(7deg);
    z-index: 3;
    filter: brightness(0.78);
  }
  .s5 {
    width: 560px;
    right: -120px;
    top: 50%;
    transform: translateY(-50%) rotate(-4deg);
    z-index: 2;
    filter: brightness(0.74);
  }
  .s6 {
    width: 600px;
    right: -130px;
    bottom: -90px;
    transform: rotate(9deg);
    z-index: 1;
    filter: brightness(0.68);
  }
</style>
</head>
<body>
  <div class="banner">
    <img class="shot s1" src="${imageSet[0]}" />
    <img class="shot s2" src="${imageSet[1]}" />
    <img class="shot s3" src="${imageSet[2]}" />
    <img class="shot s4" src="${imageSet[3]}" />
    <img class="shot s5" src="${imageSet[4]}" />
    <img class="shot s6" src="${imageSet[5]}" />
    <div class="title-card">
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
  </div>
</body>
</html>`;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
  });

  const variants = [
    {
      title: 'Dashboards in simple words',
      sub: 'Describe or pick a ready example',
      shots: shotsEN,
      out: OUT_EN,
    },
    {
      title: 'Дашборды простыми словами',
      sub: 'Опишите или вдохновляйтесь готовыми примерами',
      shots: shotsRU,
      out: OUT_RU,
    },
  ];

  for (const v of variants) {
    const page = await browser.newPage();
    await page.setContent(buildHTML(v.title, v.sub, v.shots), { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('.shot');
      return Array.from(imgs).every(i => i.complete && i.naturalWidth > 0);
    }, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: v.out, type: 'png' });
    console.log('Saved:', v.out);
    await page.close();
  }

  await browser.close();
})();
