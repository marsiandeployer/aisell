#!/usr/bin/env node
/**
 * Linter: CryptoForks routing and config validation
 * Validates master SKILL.md links resolve to files and config.yaml fields are non-empty
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

/**
 * Simple YAML parser for flat + one-level nested keys.
 * Returns object with top-level keys and nested blocks as sub-objects.
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');
  let currentBlock = null;

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Nested key (starts with whitespace)
    const nestedMatch = line.match(/^[ \t]+([a-z_]+):\s*(.*)$/);
    if (nestedMatch && currentBlock) {
      const value = nestedMatch[2].replace(/^["']|["']$/g, '').trim();
      if (!result[currentBlock]) result[currentBlock] = {};
      result[currentBlock][nestedMatch[1]] = value;
      continue;
    }

    // Top-level key
    const topMatch = line.match(/^([a-z_]+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1];
      const rawValue = topMatch[2].replace(/^["']|["']$/g, '').trim();

      if (rawValue === '' || rawValue === '|' || rawValue === '>') {
        // Block start (e.g., "deployment:")
        currentBlock = key;
        result[key] = {};
      } else if (rawValue.startsWith('[')) {
        // Inline array
        result[key] = rawValue;
        currentBlock = null;
      } else {
        result[key] = rawValue;
        currentBlock = null;
      }
      continue;
    }

    // Line with deeper indent or array items — reset block tracking for arrays
    if (line.match(/^[ \t]+- /)) {
      continue;
    }
  }

  return result;
}

function testSkillRouting() {
  let passed = 0;
  let failed = 0;

  const AISELL_ROOT = path.resolve(__dirname, '../..');
  const PRODUCTS_DIR = path.join(AISELL_ROOT, 'products/simple_crypto');
  const SHOWCASES_DIR = path.join(PRODUCTS_DIR, 'showcases');

  const LINK_REGEX = /^products\/simple_crypto\/showcases\/[a-z0-9-]+\/SKILL\.md$/;

  const REQUIRED_CONFIG_FIELDS = ['slug', 'repo_url', 'demo_url', 'description', 'deployment.config_approach'];

  log('\nLinter: CryptoForks routing and config validation\n', COLORS.YELLOW);

  // Check 1: Extract and validate links from master SKILL.md
  log('Check 1: Master SKILL.md link validation');
  const masterSkillPath = path.join(PRODUCTS_DIR, 'SKILL.md');
  if (!fs.existsSync(masterSkillPath)) {
    log('  X master SKILL.md: file not found', COLORS.RED);
    failed++;
    // Cannot continue without master file
    log('\n' + '='.repeat(60));
    log('Results:', COLORS.YELLOW);
    log(`  Passed: ${passed}`, COLORS.GREEN);
    log(`  Failed: ${failed}`, COLORS.RED);
    log(`  Total: ${passed + failed}`);
    log('='.repeat(60) + '\n');
    return false;
  }

  const masterContent = fs.readFileSync(masterSkillPath, 'utf8');

  // Extract all relative markdown links pointing to showcase SKILL.md files
  // Pattern: [text](showcases/slug/SKILL.md)
  const linkPattern = /\]\((showcases\/[^\s)]+\/SKILL\.md)\)/g;
  const rawLinks = [];
  let match;
  while ((match = linkPattern.exec(masterContent)) !== null) {
    rawLinks.push(match[1]);
  }

  if (rawLinks.length === 0) {
    log('  X master SKILL.md: no showcase links found', COLORS.RED);
    failed++;
  } else {
    log(`  Found ${rawLinks.length} showcase links in master SKILL.md`);
  }

  // Validate each link with regex BEFORE filesystem access
  const validatedLinks = [];
  rawLinks.forEach(rawLink => {
    // Prepend products/simple_crypto/ to form full relative path from aisell root
    const fullRelative = 'products/simple_crypto/' + rawLink;

    if (!LINK_REGEX.test(fullRelative)) {
      log(`  X invalid link path: ${fullRelative}`, COLORS.RED);
      failed++;
      return;
    }

    validatedLinks.push(fullRelative);
  });

  // Check 2: Validated links resolve to existing files
  log('\nCheck 2: Link resolution (file existence)');
  validatedLinks.forEach(linkPath => {
    const absPath = path.join(AISELL_ROOT, linkPath);
    if (fs.existsSync(absPath)) {
      log(`  OK ${linkPath}`, COLORS.GREEN);
      passed++;
    } else {
      log(`  X broken link: ${linkPath} (file not found)`, COLORS.RED);
      failed++;
    }
  });

  // Check 3: config.yaml required fields for each showcase
  log('\nCheck 3: config.yaml required fields');

  // Derive slugs from validated links
  const slugs = validatedLinks.map(lp => {
    const parts = lp.split('/');
    return parts[parts.length - 2]; // slug is the directory name before SKILL.md
  });

  // Also check all 8 expected slugs even if not linked
  const EXPECTED_SLUGS = [
    'mcw-wallet', 'dex', 'farming', 'dao',
    'ido-launchpad', 'predictionmarket', 'lending', 'lottery'
  ];
  const allSlugs = [...new Set([...slugs, ...EXPECTED_SLUGS])];

  allSlugs.forEach(slug => {
    const configPath = path.join(SHOWCASES_DIR, slug, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      log(`  X ${slug}/config.yaml: file not found`, COLORS.RED);
      failed++;
      return;
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = parseSimpleYaml(content);

    let allValid = true;
    REQUIRED_CONFIG_FIELDS.forEach(field => {
      let value;
      if (field === 'deployment.config_approach') {
        // Nested field: deployment → config_approach
        value = parsed.deployment && typeof parsed.deployment === 'object'
          ? parsed.deployment.config_approach
          : undefined;
      } else {
        value = parsed[field];
      }

      if (!value || (typeof value === 'string' && value.trim() === '')) {
        log(`  X ${slug}/config.yaml: missing field "${field}"`, COLORS.RED);
        failed++;
        allValid = false;
      }
    });

    if (allValid) {
      log(`  OK ${slug}/config.yaml: all 5 required fields present`, COLORS.GREEN);
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

const success = testSkillRouting();
process.exit(success ? 0 : 1);
