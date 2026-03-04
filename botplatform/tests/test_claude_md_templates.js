#!/usr/bin/env node
/**
 * Тест системы product-aware CLAUDE.md шаблонов
 *
 * Проверяет:
 * 1. Все продукты имеют SKILL.md
 * 2. Шаблоны содержат обязательные секции (безопасность)
 * 3. Клиентские шаблоны НЕ содержат internal-контент (PromptBar, Showcases, Linters)
 * 4. Product-specific контент присутствует (Chart.js для dashboard, Tailwind для site)
 * 5. Fallback на generic CLAUDE.md.example работает
 * 6. SKILL.md is a valid skill definition (not a workspace template)
 * 7. Каждый продукт имеет и CLAUDE.md (developer) и SKILL.md (client)
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  RESET: '\x1b[0m'
};

let passed = 0;
let failed = 0;

function log(msg, color = COLORS.RESET) {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function assert(condition, description) {
  if (condition) {
    log(`  ✅ ${description}`, COLORS.GREEN);
    passed++;
  } else {
    log(`  ❌ ${description}`, COLORS.RED);
    failed++;
  }
}

const PRODUCTS_DIR = path.join(__dirname, '../../products');
const BOTPLATFORM_DIR = path.join(__dirname, '..');

// Known products with their expected content markers
const PRODUCTS = {
  simple_dashboard: {
    requiredInTemplate: ['Chart.js', 'Tailwind', 'SPA', 'tt(', 'i18n', 'CAC'],
    forbiddenInTemplate: ['PromptBar', 'Showcases Architecture', 'Pre-commit Linters', 'config.yaml per showcase'],
    requiredInClaudeMd: ['Chart.js', 'SPA Architecture'],
  },
  simple_site: {
    requiredInTemplate: ['Tailwind', 'Hydra AI', 'data-i18n', 'Hero'],
    forbiddenInTemplate: ['PromptBar', 'Showcases Architecture', 'Pre-commit Linters', 'Chart.js'],
    requiredInClaudeMd: ['Tailwind', 'Landing Page'],
  },
};

// Sections required in ALL client SKILL.md files
const REQUIRED_SECTIONS = [
  'Безопасность',
];

log('\n🧪 Test: CLAUDE.md Template System\n', COLORS.YELLOW);

// ── Test 1: All products have SKILL.md ──
log('Test 1: Product templates exist', COLORS.YELLOW);
for (const [product, spec] of Object.entries(PRODUCTS)) {
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  assert(fs.existsSync(templatePath), `${product}/SKILL.md exists`);
}

// ── Test 2: All products have CLAUDE.md (developer reference) ──
log('\nTest 2: Developer CLAUDE.md exists', COLORS.YELLOW);
for (const [product] of Object.entries(PRODUCTS)) {
  const claudeMdPath = path.join(PRODUCTS_DIR, product, 'CLAUDE.md');
  assert(fs.existsSync(claudeMdPath), `${product}/CLAUDE.md exists`);
}

// ── Test 3: Required sections in all templates ──
log('\nTest 3: Required sections in templates', COLORS.YELLOW);
for (const [product] of Object.entries(PRODUCTS)) {
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  if (!fs.existsSync(templatePath)) continue;
  const content = fs.readFileSync(templatePath, 'utf8');
  for (const section of REQUIRED_SECTIONS) {
    assert(content.includes(section), `${product}: has "${section}"`);
  }
  // Negative assertion: SKILL.md must NOT contain workspace placeholders
  assert(!content.includes('{{PROJECT_IDEA}}'), `${product}: no {{PROJECT_IDEA}} in SKILL.md`);
}

// ── Test 4: Product-specific content present ──
log('\nTest 4: Product-specific content in templates', COLORS.YELLOW);
for (const [product, spec] of Object.entries(PRODUCTS)) {
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  if (!fs.existsSync(templatePath)) continue;
  const content = fs.readFileSync(templatePath, 'utf8');
  for (const marker of spec.requiredInTemplate) {
    assert(content.includes(marker), `${product}: has "${marker}"`);
  }
}

// ── Test 5: No internal content leaks to client templates ──
log('\nTest 5: No internal content in client templates', COLORS.YELLOW);
for (const [product, spec] of Object.entries(PRODUCTS)) {
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  if (!fs.existsSync(templatePath)) continue;
  const content = fs.readFileSync(templatePath, 'utf8');
  for (const forbidden of spec.forbiddenInTemplate) {
    assert(!content.includes(forbidden), `${product}: NO "${forbidden}"`);
  }
}

// ── Test 6: Generic fallback exists ──
log('\nTest 6: Generic fallback template', COLORS.YELLOW);
const fallbackPath = path.join(BOTPLATFORM_DIR, 'CLAUDE.md.example');
assert(fs.existsSync(fallbackPath), 'CLAUDE.md.example exists in botplatform/');
if (fs.existsSync(fallbackPath)) {
  const fallback = fs.readFileSync(fallbackPath, 'utf8');
  assert(fallback.includes('{{PROJECT_IDEA}}'), 'Fallback has {{PROJECT_IDEA}}');
  assert(fallback.includes('Безопасность'), 'Fallback has Безопасность section');
}

// ── Test 7: SKILL.md is valid skill content ──
log('\nTest 7: SKILL.md content validation', COLORS.YELLOW);
for (const [product] of Object.entries(PRODUCTS)) {
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  if (!fs.existsSync(templatePath)) continue;
  const content = fs.readFileSync(templatePath, 'utf8');
  assert(content.length > 100, `${product}: SKILL.md has substantial content`);
  assert(content.includes('Безопасность'), `${product}: SKILL.md has security section`);
}

// ── Test 8: getClaudeMdTemplatePath resolution ──
log('\nTest 8: Template resolution logic', COLORS.YELLOW);
const distDir = path.join(BOTPLATFORM_DIR, 'dist');
function getClaudeMdTemplatePath(productType) {
  if (productType) {
    const productPath = path.join(distDir, `../../products/${productType}/SKILL.md`);
    if (fs.existsSync(productPath)) return productPath;
  }
  return path.join(distDir, '../CLAUDE.md.example');
}

assert(
  getClaudeMdTemplatePath('simple_dashboard').includes('simple_dashboard/SKILL.md'),
  'simple_dashboard resolves to product template'
);
assert(
  getClaudeMdTemplatePath('simple_site').includes('simple_site/SKILL.md'),
  'simple_site resolves to product template'
);
assert(
  getClaudeMdTemplatePath('').endsWith('CLAUDE.md.example'),
  'Empty PRODUCT_TYPE falls back to CLAUDE.md.example'
);
assert(
  getClaudeMdTemplatePath('nonexistent_product').endsWith('CLAUDE.md.example'),
  'Unknown product falls back to CLAUDE.md.example'
);

// ── Test 9: Developer CLAUDE.md vs client template separation ──
log('\nTest 9: Developer vs client content separation', COLORS.YELLOW);
for (const [product, spec] of Object.entries(PRODUCTS)) {
  const claudeMdPath = path.join(PRODUCTS_DIR, product, 'CLAUDE.md');
  const templatePath = path.join(PRODUCTS_DIR, product, 'SKILL.md');
  if (!fs.existsSync(claudeMdPath) || !fs.existsSync(templatePath)) continue;
  const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');

  // Developer CLAUDE.md should NOT have workspace placeholders
  assert(!claudeMd.includes('{{PROJECT_IDEA}}'), `${product}/CLAUDE.md: no {{PROJECT_IDEA}} placeholder`);

  // SKILL.md should NOT have workspace placeholders (it's a skill definition, not a template)
  assert(!template.includes('{{PROJECT_IDEA}}'), `${product}/SKILL.md: no {{PROJECT_IDEA}} placeholder`);

  // Both should have product-specific content
  for (const marker of spec.requiredInClaudeMd) {
    assert(claudeMd.includes(marker), `${product}/CLAUDE.md: has "${marker}"`);
  }
}

// ── Test 10: YAML frontmatter checks for SKILL.md ──
log('\nTest 10: SKILL.md YAML frontmatter', COLORS.YELLOW);
{
  const skillPath = path.join(PRODUCTS_DIR, 'simple_dashboard', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const content = fs.readFileSync(skillPath, 'utf8');
    // Parse YAML frontmatter between first --- and second ---
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert(!!fmMatch, 'simple_dashboard/SKILL.md has YAML frontmatter block');
    if (fmMatch) {
      const fmBlock = fmMatch[1];
      const lines = fmBlock.split('\n');
      // Parse name
      const nameLine = lines.find(l => l.startsWith('name:'));
      const nameValue = nameLine ? nameLine.replace(/^name:\s*/, '').trim() : '';
      assert(nameValue.length > 0, 'frontmatter: name is non-empty');

      // Parse description
      const descLine = lines.find(l => l.startsWith('description:'));
      const descValue = descLine ? descLine.replace(/^description:\s*/, '').trim() : '';
      assert(descValue.length > 20, `frontmatter: description.length > 20 (got ${descValue.length})`);

      // Parse tags — handle inline array [a, b, c]
      const tagsLine = lines.find(l => l.startsWith('tags:'));
      let tags = [];
      if (tagsLine) {
        const inlineMatch = tagsLine.match(/\[([^\]]+)\]/);
        if (inlineMatch) {
          tags = inlineMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        } else {
          // Block list format: following lines with "- item"
          const tagsIdx = lines.indexOf(tagsLine);
          for (let i = tagsIdx + 1; i < lines.length; i++) {
            const m = lines[i].match(/^\s*-\s+(.+)/);
            if (m) tags.push(m[1].trim());
            else break;
          }
        }
      }
      assert(tags.length >= 7, `frontmatter: tags.length >= 7 (got ${tags.length})`);
    }
  }
}

// ── Test 11: Showcase links in SKILL.md ──
log('\nTest 11: Showcase links in simple_dashboard SKILL.md', COLORS.YELLOW);
{
  const skillPath = path.join(PRODUCTS_DIR, 'simple_dashboard', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const content = fs.readFileSync(skillPath, 'utf8');
    const matches = content.match(/simpledashboard\.wpmix\.net\/showcases/g) || [];
    assert(matches.length >= 7, `showcase links >= 7 (got ${matches.length})`);
  }
}

// ── Test 12: No-placeholder substitution (buildClaudeMdContent behavior) ──
log('\nTest 12: SKILL.md no-placeholder substitution', COLORS.YELLOW);
{
  const skillPath = path.join(PRODUCTS_DIR, 'simple_dashboard', 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    const content = fs.readFileSync(skillPath, 'utf8');
    // Confirm no {{PROJECT_IDEA}} placeholder exists
    assert(!content.includes('{{PROJECT_IDEA}}'), 'SKILL.md has no {{PROJECT_IDEA}} placeholder');
    // Simulate buildClaudeMdContent: replace returns original when no placeholder
    const result = content.replace(/\{\{PROJECT_IDEA\}\}/g, 'test-idea');
    assert(result === content, 'substitution on SKILL.md returns original content unchanged');
    assert(result.length > 0, 'substitution result is non-empty');
  }
}

// ── Test 13: No stale templates in botplatform/ ──
log('\nTest 13: No stale product templates in botplatform/', COLORS.YELLOW);
const staleFiles = fs.readdirSync(BOTPLATFORM_DIR)
  .filter(f => f.match(/^CLAUDE\.md\.\w+/) && f !== 'CLAUDE.md.example');
assert(staleFiles.length === 0,
  staleFiles.length === 0
    ? 'No stale CLAUDE.md.{product} files in botplatform/'
    : `Found stale files: ${staleFiles.join(', ')}`
);

// ── Summary ──
log('\n' + '='.repeat(60));
log('Results:', COLORS.YELLOW);
log(`✅ Passed: ${passed}`, COLORS.GREEN);
if (failed > 0) {
  log(`❌ Failed: ${failed}`, COLORS.RED);
}
log(`📊 Success rate: ${Math.round(passed / (passed + failed) * 100)}%`);
log('='.repeat(60) + '\n');

process.exit(failed === 0 ? 0 : 1);
