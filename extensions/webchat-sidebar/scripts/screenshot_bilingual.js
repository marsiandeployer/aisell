#!/usr/bin/env node
/**
 * Take bilingual (EN + RU) screenshots of a demo.html / page.html at multiple sizes.
 *
 * Usage:
 *   node screenshot_bilingual.js <page.html> <output-dir>
 *
 * Output:
 *   <output-dir>/screenshot-1280x800.png      — English 1280x800
 *   <output-dir>/screenshot-1280x800-ru.png   — Russian 1280x800
 *   <output-dir>/screenshot-640x400.png       — English 640x400 (resized via CSS transform)
 *   <output-dir>/screenshot-640x400-ru.png    — Russian 640x400
 *
 * The 640x400 version is created by applying CSS transform: scale(0.5) to page.html
 * and taking a screenshot at 640x400 viewport — NOT by cropping the 1280x800 image.
 *
 * Requires: page.html must include i18n with navigator.language detection
 */

const puppeteer = require('/root/aisell/botplatform/node_modules/puppeteer');
const path = require('path');

/**
 * @param {string} demoPath - path to HTML file
 * @param {string} outPath - output PNG path
 * @param {string} lang - 'en' or 'ru'
 * @param {{width: number, height: number}} size - viewport size
 */
async function takeScreenshot(demoPath, outPath, lang, size) {
  const isRu = lang === 'ru';
  const isSmall = size.width < 1280;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', isRu ? '--lang=ru' : '--lang=en-US']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: size.width, height: size.height });

  if (isRu) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'ru' });
      Object.defineProperty(navigator, 'languages', { get: () => ['ru', 'ru-RU'] });
    });
  }

  // For smaller sizes, use CSS zoom to scale page.html (resize, not crop)
  // zoom affects layout unlike transform, so content fills the viewport properly
  if (isSmall) {
    const scale = size.width / 1280;
    await page.evaluateOnNewDocument((s) => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.zoom = s;
      });
    }, scale);
  }

  await page.goto('file://' + path.resolve(demoPath), {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  // Wait for Chart.js to load (if used), then extra time for rendering
  try {
    await page.waitForFunction('typeof Chart !== "undefined"', { timeout: 15000 });
  } catch (_) {
    // Chart.js may not be used in this page
  }
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({
    path: outPath,
    fullPage: false,
    clip: { x: 0, y: 0, width: size.width, height: size.height }
  });
  console.log(`${lang.toUpperCase()} ${size.width}x${size.height}: ${outPath}`);
  await browser.close();
}

(async () => {
  const demoPath = process.argv[2];
  const outDir = process.argv[3];

  if (!demoPath || !outDir) {
    console.error('Usage: node screenshot_bilingual.js <page.html> <output-dir>');
    process.exit(1);
  }

  const sizes = [
    { width: 1280, height: 800 },
    { width: 640, height: 400 }
  ];

  for (const size of sizes) {
    const suffix = `${size.width}x${size.height}`;
    const enPath = path.join(outDir, `screenshot-${suffix}.png`);
    const ruPath = path.join(outDir, `screenshot-${suffix}-ru.png`);

    await takeScreenshot(demoPath, enPath, 'en', size);
    await takeScreenshot(demoPath, ruPath, 'ru', size);
  }

  console.log('Done.');
})();
