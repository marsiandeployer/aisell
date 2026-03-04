#!/usr/bin/env node
/**
 * Tests for build.js output: manifest permissions, content_scripts entries,
 * and presence of new files in build output directory.
 *
 * Run: node tests/test_build_output.js
 * Prerequisites: run `node build.js --name "SimpleDashboard" --url "https://simpledashboard.wpmix.net"` first
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out', 'webchat-sidebar');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.log(`  FAIL: ${description}`);
    failed++;
  }
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}. Run build.js first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

console.log('=== Build Output Tests ===\n');

const manifest = readManifest();

// test_manifest_has_storage_permission
assert(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('storage'),
  'manifest has "storage" in permissions'
);

// test_manifest_has_content_scripts
assert(
  Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 2,
  'manifest has content_scripts array with two entries'
);

// test_content_scripts_main_world
const mainWorldEntry = (manifest.content_scripts || []).find(
  (cs) => cs.world === 'MAIN'
);
assert(
  mainWorldEntry && Array.isArray(mainWorldEntry.js) && mainWorldEntry.js.includes('ethereum-provider.js'),
  'one content_scripts entry has world:"MAIN" and js includes "ethereum-provider.js"'
);

// test_content_scripts_isolated_world
const isolatedWorldEntry = (manifest.content_scripts || []).find(
  (cs) => !cs.world && Array.isArray(cs.js) && cs.js.includes('content-script-ethereum.js')
);
assert(
  !!isolatedWorldEntry,
  'one content_scripts entry has no world field (ISOLATED default) and js includes "content-script-ethereum.js"'
);

// test_content_scripts_match_pattern
const allMatchDPattern = (manifest.content_scripts || []).every(
  (cs) => Array.isArray(cs.matches) && cs.matches.includes('https://d*.wpmix.net/*')
);
assert(
  allMatchDPattern,
  'both content_scripts entries have matches: ["https://d*.wpmix.net/*"]'
);

// test_content_scripts_run_at_document_start
const allRunAtDocStart = (manifest.content_scripts || []).every(
  (cs) => cs.run_at === 'document_start'
);
assert(
  allRunAtDocStart,
  'both content_scripts entries have run_at: "document_start"'
);

// test_new_files_copied
const newFiles = ['ethereum-provider.js', 'content-script-ethereum.js', 'ethers.min.js'];
for (const file of newFiles) {
  assert(
    fs.existsSync(path.join(OUT_DIR, file)),
    `${file} exists in build output`
  );
}

// test_existing_files_still_present
const existingFiles = ['background.js', 'panel.js', 'panel_shared.js'];
for (const file of existingFiles) {
  assert(
    fs.existsSync(path.join(OUT_DIR, file)),
    `${file} still exists in build output (no regression)`
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
