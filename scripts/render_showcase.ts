#!/usr/bin/env tsx
/**
 * Render showcase screenshot for a Simple* product
 *
 * Usage:
 *   tsx scripts/render_showcase.ts --product simple_site --slug hairdresser-booking-calendar
 *
 * Reads showcase config from: products/{product}.yaml
 * Saves screenshot to: products/{product}/showcases/{slug}.png
 * Uses template: extensions/webchat-sidebar/previews/templates/chat-frame-base.html
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Resolve puppeteer from botplatform
function resolvePuppeteer(): typeof import('puppeteer') {
  const candidates = [
    path.join(__dirname, '..', 'botplatform', 'node_modules', 'puppeteer'),
    path.join(__dirname, '..', 'noxonbot', 'node_modules', 'puppeteer'),
    'puppeteer',
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_e) {}
  }

  throw new Error('Puppeteer not found. Run: cd botplatform && npm install');
}

interface ShowcaseCase {
  slug: string;
  prompt: string;
  caption: string;
  tags?: string[];
}

interface ProductConfig {
  product_id: string;
  name: string;
  showcases: ShowcaseCase[];
}

const ROOT_DIR = path.resolve(__dirname, '..');
const PRODUCTS_DIR = path.join(ROOT_DIR, 'products');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'extensions', 'webchat-sidebar', 'previews', 'templates', 'chat-frame-base.html');
const USER_FOLDER = '/root/aisellusers/user_999999999';
const WEBCHAT_URL = 'http://localhost:8091';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function loadProductConfig(productId: string): ProductConfig {
  const yamlPath = path.join(PRODUCTS_DIR, `${productId}.yaml`);
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Product config not found: ${yamlPath}`);
  }
  const content = fs.readFileSync(yamlPath, 'utf8');
  const config = yaml.load(content) as ProductConfig;

  if (!config.showcases || !Array.isArray(config.showcases)) {
    throw new Error(`No showcases defined in ${yamlPath}`);
  }

  return config;
}

function findShowcase(config: ProductConfig, slug: string): ShowcaseCase | undefined {
  return config.showcases.find(s => s.slug === slug);
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearUserFolder(): Promise<void> {
  if (fs.existsSync(USER_FOLDER)) {
    const files = fs.readdirSync(USER_FOLDER);
    for (const file of files) {
      if (file.endsWith('.html') || file === '.history.json' || file === 'chat_log.json') {
        fs.unlinkSync(path.join(USER_FOLDER, file));
      }
    }
  } else {
    fs.mkdirSync(USER_FOLDER, { recursive: true });
  }
  // Create CLAUDE.md with SimpleSite instructions
  const claudeMdContent = `# SimpleSite - AI Website Builder

## Your Role
You create beautiful landing pages and websites. Always save as index.html.

## CRITICAL: Use Tailwind CSS
Always use Tailwind CSS via CDN:
\`\`\`html
<script src="https://cdn.tailwindcss.com"></script>
\`\`\`

## Landing Page Structure (IMPORTANT!)
Create REAL website layout, NOT a card on background:
1. **Header**: Logo (left) + Navigation menu (right) - sticky/fixed
2. **Hero Section**: Full-screen background image with overlay, headline, CTA button
3. NO card/box floating over background - text directly on hero image

Example structure:
\`\`\`html
<header class="fixed w-full p-4 flex justify-between items-center z-50">
  <div class="text-2xl font-bold text-white">Logo</div>
  <nav class="flex gap-6 text-white">
    <a href="#" class="hover:underline">Home</a>
    <a href="#" class="hover:underline">Services</a>
    <a href="#" class="hover:underline">Contact</a>
  </nav>
</header>
<main class="h-screen bg-cover bg-center relative" style="background-image: url('bg.jpg')">
  <div class="absolute inset-0 bg-black/40"></div>
  <div class="relative z-10 h-full flex flex-col justify-center items-center text-white text-center px-4">
    <h1 class="text-6xl font-bold mb-4">Headline Here</h1>
    <p class="text-xl mb-8">Subheadline text</p>
    <a href="#" class="bg-white text-black px-8 py-4 rounded-full font-semibold hover:bg-opacity-90">CTA Button</a>
  </div>
</main>
\`\`\`

## For AI Background Images (optional)
Use Hydra AI to generate unique backgrounds:
\`\`\`python
import requests, base64, os
response = requests.post(
    'https://api.hydraai.ru/v1/images/generations',
    headers={'Authorization': f'Bearer {os.getenv("HYDRA_API_KEY")}'},
    json={'model': 'flux-schnell-uncensored', 'prompt': 'theme background', 'n': 1, 'size': '1024x1024'},
    timeout=60
)
b64 = response.json()['data'][0]['b64_json']
with open('bg.jpg', 'wb') as f:
    f.write(base64.b64decode(b64.split(',')[1] if ',' in b64 else b64))
\`\`\`

## Rules
- ALWAYS use Tailwind CSS
- ALWAYS save as index.html
- Hero image is MAIN element (no floating cards!)
- Include header with logo + nav menu
- Text directly on background with overlay for readability
`;
  fs.writeFileSync(
    path.join(USER_FOLDER, 'CLAUDE.md'),
    claudeMdContent,
    'utf8'
  );
}

async function renderShowcase(
  puppeteer: typeof import('puppeteer'),
  showcase: ShowcaseCase,
  outputPath: string
): Promise<void> {
  console.log(`\n📸 Rendering showcase: ${showcase.slug}`);
  console.log(`   Prompt: "${showcase.prompt.slice(0, 50)}..."`);

  // Clear user folder before each showcase
  await clearUserFolder();

  // Clear webchat history via API
  try {
    const response = await fetch(`${WEBCHAT_URL}/api/history/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      console.log('   ✅ Cleared webchat history');
    }
  } catch (e) {
    console.log('   ⚠️ Could not clear history (webchat may not be running)');
  }

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();

    // Load template HTML
    const templateUrl = `file://${TEMPLATE_PATH}`;
    await page.goto(templateUrl, { waitUntil: 'networkidle2' });

    // Wait for chat iframe to load
    const frameSelector = 'iframe.chat-frame';
    await page.waitForSelector(frameSelector, { timeout: 30000 });
    const iframeHandle = await page.$(frameSelector);
    if (!iframeHandle) throw new Error('Chat iframe not found');

    const frame = await iframeHandle.contentFrame();
    if (!frame) throw new Error('Could not access chat iframe content');

    // Wait for chat input
    await frame.waitForSelector('#input', { timeout: 30000 });
    console.log('   ✅ Chat loaded');

    // Type prompt
    await frame.$eval('#input', (el: HTMLInputElement, text: string) => {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, showcase.prompt);

    // Submit
    try {
      await frame.click('#sendBtn');
    } catch {
      await frame.$eval('#form', (form: HTMLFormElement) => form.requestSubmit());
    }
    console.log('   ✅ Prompt sent');

    // Handle login modal if appears
    const loginModalOpen = await frame.waitForFunction(
      () => {
        const modal = document.querySelector('#loginModal');
        return modal && modal.classList.contains('open');
      },
      { timeout: 5000 }
    ).then(() => true).catch(() => false);

    if (loginModalOpen) {
      console.log('   🔐 Logging in...');
      await frame.$eval('#loginName', (el: HTMLInputElement) => { el.value = 'admin'; });
      await frame.$eval('#loginEmail', (el: HTMLInputElement) => { el.value = 'admin@example.com'; });
      await frame.click('#loginSubmit');
      await wait(2000);

      // Re-submit prompt after login
      await frame.$eval('#input', (el: HTMLInputElement, text: string) => {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, showcase.prompt);

      try {
        await frame.click('#sendBtn');
      } catch {
        await frame.$eval('#form', (form: HTMLFormElement) => form.requestSubmit());
      }
    }

    // Wait for assistant response (not progress indicator)
    console.log('   ⏳ Waiting for AI response...');
    const TIMEOUT_MS = 180000; // 3 minutes

    await frame.waitForFunction(
      () => {
        const bubbles = document.querySelectorAll('.bubble.assistant');
        if (bubbles.length === 0) return false;
        const last = bubbles[bubbles.length - 1];
        const text = last?.textContent?.trim() || '';
        if (!text) return false;
        // Skip progress indicators
        if (text.startsWith('⏳') || text.startsWith('⌛')) return false;
        const lower = text.toLowerCase();
        if (lower.includes('launching') || lower.includes('working') || lower.includes('processing')) return false;
        return true;
      },
      { timeout: TIMEOUT_MS }
    );

    console.log('   ✅ AI responded');

    // Wait for file system to sync
    await wait(2000);

    // Reload the left iframe (preview) to show the new content
    await page.evaluate(() => {
      const leftIframe = document.querySelector('.left iframe') as HTMLIFrameElement;
      if (leftIframe) {
        leftIframe.src = leftIframe.src; // Force reload
      }
    });
    console.log('   ✅ Preview iframe reloaded');

    // Wait for preview iframe to load actual content (not "Preview Directory")
    await wait(2000);

    // Check if preview loaded successfully (retry reload if needed)
    const previewLoaded = await page.evaluate(() => {
      const leftIframe = document.querySelector('.left iframe') as HTMLIFrameElement;
      if (!leftIframe || !leftIframe.contentDocument) return false;
      const body = leftIframe.contentDocument.body;
      if (!body) return false;
      // Check if still showing "Preview Directory" or "No index.html"
      const text = body.textContent || '';
      return !text.includes('Preview Directory') && !text.includes('No index.html');
    });

    if (!previewLoaded) {
      console.log('   ⚠️  Preview not loaded, waiting more...');
      await wait(3000);
      // Reload again
      await page.evaluate(() => {
        const leftIframe = document.querySelector('.left iframe') as HTMLIFrameElement;
        if (leftIframe) leftIframe.src = leftIframe.src;
      });
      await wait(3000);
    }

    console.log('   ✅ Preview loaded');

    // Take screenshot
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: false });

    console.log(`   ✅ Screenshot saved: ${outputPath}`);

  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const productId = args.product as string;
  const slug = args.slug as string;

  if (!productId || !slug) {
    console.error('Usage: tsx scripts/render_showcase.ts --product <product_id> --slug <slug>');
    process.exit(1);
  }

  // Check template exists
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  }

  // Load product config
  const config = loadProductConfig(productId);
  console.log(`\n📦 Product: ${config.name} (${productId})`);
  console.log(`   Showcases: ${config.showcases.length}`);

  const puppeteer = resolvePuppeteer();

  // Render single showcase
  const showcase = findShowcase(config, slug);
  if (!showcase) {
    console.error(`Showcase not found: ${slug}`);
    console.error(`Available: ${config.showcases.map(s => s.slug).join(', ')}`);
    process.exit(1);
  }
  const outputPath = path.join(PRODUCTS_DIR, productId, 'showcases', `${showcase.slug}.png`);
  await renderShowcase(puppeteer, showcase, outputPath);
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
