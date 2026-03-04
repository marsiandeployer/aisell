#!/usr/bin/env tsx
/**
 * Generate showcases gallery page for a Simple* product
 *
 * Usage:
 *   npx tsx scripts/generate_showcases_page.ts --product simple_site
 *
 * Reads: products/{product}.yaml
 * Generates:
 *   - products/{product}/showcases/{slug}_captioned.png (with caption overlay)
 *   - products/{product}/showcases/index.html (gallery page)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createCanvas, loadImage, registerFont } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ROOT_DIR = path.resolve(__dirname, '..');
const PRODUCTS_DIR = path.join(ROOT_DIR, 'products');

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
  chrome_store?: {
    name?: string;
  };
}

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
  return yaml.load(content) as ProductConfig;
}

async function addCaptionToImage(
  inputPath: string,
  outputPath: string,
  prompt: string
): Promise<void> {
  const image = await loadImage(inputPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(image, 0, 0);

  // Caption bar settings
  const barHeight = 52;
  const barY = image.height - barHeight;

  // Semi-transparent dark gradient bar at bottom
  const gradient = ctx.createLinearGradient(0, barY, 0, image.height);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, barY, image.width, barHeight);

  // Caption text - just the prompt in quotes
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Truncate if too long
  const maxWidth = image.width - 40;
  let displayText = `"${prompt}"`;
  while (ctx.measureText(displayText).width > maxWidth && displayText.length > 20) {
    displayText = displayText.slice(0, -4) + '..."';
  }

  ctx.fillText(displayText, image.width / 2, barY + barHeight / 2);

  // Save
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}

function generateGalleryHtml(product: ProductConfig, showcases: ShowcaseCase[]): string {
  const showcasesDir = path.join(PRODUCTS_DIR, product.product_id, 'showcases');

  // Only include showcases that have screenshots
  const existingShowcases = showcases.filter((s) => {
    const captionedPath = path.join(showcasesDir, `${s.slug}_captioned.png`);
    const originalPath = path.join(showcasesDir, `${s.slug}.png`);
    return fs.existsSync(captionedPath) || fs.existsSync(originalPath);
  });

  const showcaseCards = existingShowcases
    .map((s) => {
      const captionedPath = `${s.slug}_captioned.png`;
      const originalPath = `${s.slug}.png`;
      // Prefer captioned version
      const imagePath = fs.existsSync(path.join(showcasesDir, captionedPath))
        ? captionedPath
        : originalPath;

      return `
      <div class="showcase-card">
        <img src="/showcases/${imagePath}" alt="${s.caption}" loading="lazy">
        <div class="prompt">"${s.prompt}"</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${product.name} - Showcases</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      color: #fff;
      padding: 40px 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      text-align: center;
      color: #8892b0;
      margin-bottom: 40px;
      font-size: 1.1rem;
    }
    .showcases {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
      gap: 30px;
    }
    .showcase-card {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: transform 0.3s, box-shadow 0.3s;
    }
    .showcase-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    }
    .showcase-card img {
      width: 100%;
      height: auto;
      display: block;
    }
    .prompt {
      padding: 20px;
      font-size: 1rem;
      color: #ccd6f6;
      font-style: italic;
      background: rgba(0, 0, 0, 0.2);
    }
    .cws-info {
      text-align: center;
      margin-top: 40px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
    }
    .cws-info h3 {
      color: #64ffda;
      margin-bottom: 10px;
    }
    .cws-info p {
      color: #8892b0;
    }
    @media (max-width: 700px) {
      .showcases {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${product.name}</h1>
    <p class="subtitle">AI-powered showcase gallery</p>

    <div class="showcases">
      ${showcaseCards}
    </div>

    <div class="cws-info">
      <h3>Chrome Web Store Ready</h3>
      <p>All screenshots are 1280x800px with caption overlays - ready for Chrome Web Store submission.</p>
    </div>
  </div>
</body>
</html>`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const productId = args.product as string;

  if (!productId) {
    console.error('Usage: npx tsx scripts/generate_showcases_page.ts --product <product_id>');
    process.exit(1);
  }

  const config = loadProductConfig(productId);
  console.log(`\n📦 Product: ${config.name} (${productId})`);
  console.log(`   Showcases: ${config.showcases.length}`);

  const showcasesDir = path.join(PRODUCTS_DIR, productId, 'showcases');
  fs.mkdirSync(showcasesDir, { recursive: true });

  // Process each showcase - add caption overlay
  for (const showcase of config.showcases) {
    const inputPath = path.join(showcasesDir, `${showcase.slug}.png`);
    const outputPath = path.join(showcasesDir, `${showcase.slug}_captioned.png`);

    if (!fs.existsSync(inputPath)) {
      console.log(`   ⚠️  Skipping ${showcase.slug} - screenshot not found`);
      continue;
    }

    console.log(`   🖼️  Adding caption to: ${showcase.slug}`);
    await addCaptionToImage(inputPath, outputPath, showcase.prompt);
  }

  // Generate gallery HTML
  const htmlPath = path.join(showcasesDir, 'index.html');
  const html = generateGalleryHtml(config, config.showcases);
  fs.writeFileSync(htmlPath, html);
  console.log(`\n✅ Gallery page: ${htmlPath}`);

  // Verify image dimensions
  console.log('\n📐 Chrome Web Store requirements:');
  console.log('   Required: 1280x800px or 640x400px');
  for (const showcase of config.showcases) {
    const imgPath = path.join(showcasesDir, `${showcase.slug}_captioned.png`);
    if (fs.existsSync(imgPath)) {
      const { createCanvas, loadImage } = require('canvas');
      const img = await loadImage(imgPath);
      const status = img.width === 1280 && img.height === 800 ? '✅' : '❌';
      console.log(`   ${status} ${showcase.slug}: ${img.width}x${img.height}`);
    }
  }
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
