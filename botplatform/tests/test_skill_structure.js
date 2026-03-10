#!/usr/bin/env node
/**
 * Linter: CryptoForks showcase structure validation
 * Checks that all 8 showcase directories exist with required files and sections
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  RESET: '\x1b[0m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

function testSkillStructure() {
  let passed = 0;
  let failed = 0;

  const PRODUCTS_DIR = path.resolve(__dirname, '../../products/simple_crypto');
  const SHOWCASES_DIR = path.join(PRODUCTS_DIR, 'showcases');

  const EXPECTED_SLUGS = [
    'mcw-wallet', 'dex', 'farming', 'dao',
    'ido-launchpad', 'predictionmarket', 'lending', 'lottery'
  ];

  const REQUIRED_SECTIONS = [
    'What is this project',
    'Stack',
    'Repository structure',
    'Build & Deploy',
    'Config Files',
    'Interview Protocol',
    'Output',
    'Common tasks',
    'Troubleshooting'
  ];

  const FRONTMATTER_FIELDS = ['name:', 'description:', 'version:', 'tags:'];

  log('\nLinter: CryptoForks showcase structure\n', COLORS.YELLOW);

  // Check 1: All 8 showcase directories exist
  log('Check 1: Showcase directories exist');
  EXPECTED_SLUGS.forEach(slug => {
    const dir = path.join(SHOWCASES_DIR, slug);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      log(`  OK ${slug}/`, COLORS.GREEN);
      passed++;
    } else {
      log(`  X ${slug}/ directory missing`, COLORS.RED);
      failed++;
    }
  });

  // Check 2: Each directory contains SKILL.md and config.yaml
  log('\nCheck 2: Required files (SKILL.md + config.yaml)');
  EXPECTED_SLUGS.forEach(slug => {
    const skillPath = path.join(SHOWCASES_DIR, slug, 'SKILL.md');
    const configPath = path.join(SHOWCASES_DIR, slug, 'config.yaml');

    if (fs.existsSync(skillPath)) {
      log(`  OK ${slug}/SKILL.md`, COLORS.GREEN);
      passed++;
    } else {
      log(`  X ${slug}/SKILL.md: file missing`, COLORS.RED);
      failed++;
    }

    if (fs.existsSync(configPath)) {
      log(`  OK ${slug}/config.yaml`, COLORS.GREEN);
      passed++;
    } else {
      log(`  X ${slug}/config.yaml: file missing`, COLORS.RED);
      failed++;
    }
  });

  // Check 3: All 9 required H2 sections in each showcase SKILL.md
  log('\nCheck 3: Required H2 sections in showcase SKILL.md files');
  EXPECTED_SLUGS.forEach(slug => {
    const skillPath = path.join(SHOWCASES_DIR, slug, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return;

    const content = fs.readFileSync(skillPath, 'utf8');
    const lines = content.split('\n');
    const h2Sections = lines
      .filter(line => line.startsWith('## '))
      .map(line => line.replace(/^## /, '').trim());

    let allPresent = true;
    REQUIRED_SECTIONS.forEach(section => {
      if (!h2Sections.includes(section)) {
        log(`  X ${slug}/SKILL.md: missing section "## ${section}"`, COLORS.RED);
        failed++;
        allPresent = false;
      }
    });

    if (allPresent) {
      log(`  OK ${slug}/SKILL.md: all 9 sections present`, COLORS.GREEN);
      passed++;
    }
  });

  // Check 4: Master SKILL.md frontmatter fields
  log('\nCheck 4: Master SKILL.md YAML frontmatter');
  const masterSkillPath = path.join(PRODUCTS_DIR, 'SKILL.md');
  if (fs.existsSync(masterSkillPath)) {
    const content = fs.readFileSync(masterSkillPath, 'utf8');
    const lines = content.split('\n');

    // Extract frontmatter between first --- and second ---
    let frontmatter = '';
    if (lines[0].trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx > 0) {
        frontmatter = lines.slice(1, endIdx).join('\n');
      }
    }

    if (!frontmatter) {
      log('  X master SKILL.md: no YAML frontmatter found', COLORS.RED);
      failed++;
    } else {
      let allFields = true;
      FRONTMATTER_FIELDS.forEach(field => {
        if (!frontmatter.includes(field)) {
          log(`  X master SKILL.md: missing frontmatter field "${field}"`, COLORS.RED);
          failed++;
          allFields = false;
        }
      });

      if (allFields) {
        log(`  OK master SKILL.md: all 4 frontmatter fields present`, COLORS.GREEN);
        passed++;
      }
    }
  } else {
    log('  X master SKILL.md: file not found', COLORS.RED);
    failed++;
  }

  // Check 5: No /root/ paths in showcase SKILL.md files
  log('\nCheck 5: No /root/ paths in showcase SKILL.md files');
  EXPECTED_SLUGS.forEach(slug => {
    const skillPath = path.join(SHOWCASES_DIR, slug, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return;

    const content = fs.readFileSync(skillPath, 'utf8');
    const lines = content.split('\n');
    let hasRootPath = false;

    lines.forEach((line, idx) => {
      if (line.includes('/root/')) {
        log(`  X ${slug}/SKILL.md: contains /root/ path (line ${idx + 1})`, COLORS.RED);
        failed++;
        hasRootPath = true;
      }
    });

    if (!hasRootPath) {
      log(`  OK ${slug}/SKILL.md: no /root/ paths`, COLORS.GREEN);
      passed++;
    }
  });

  // Summary
  log('\n' + '='.repeat(60));
  log('Results:', COLORS.YELLOW);
  log(`  Passed: ${passed}`, COLORS.GREEN);
  if (failed > 0) {
    log(`  Failed: ${failed}`, COLORS.RED);
  }
  log(`  Total: ${passed + failed}`);
  log('='.repeat(60) + '\n');

  return failed === 0;
}

const success = testSkillStructure();
process.exit(success ? 0 : 1);
