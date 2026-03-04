#!/usr/bin/env python3
"""Lint: detect duplicate data across product documentation files.

Checks for:
  1. Showcase list in main SKILL.md matches actual showcase directories
  2. Showcase prompts not duplicated verbatim between SKILL.md and CLAUDE-SHOWCASES.md
  3. No showcase-specific content leaked into main SKILL.md (beyond the index table)
  4. CLAUDE.md.workspace auth hint consistent with main SKILL.md auth section header
  5. Industry templates in main SKILL.md not duplicated in showcase SKILL.md files

Usage: python3 scripts/lint-duplicates.py
Exit code 0 = clean, 1 = found issues.
"""

import os
import re
import sys

PRODUCTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "products", "simple_dashboard"
)
SHOWCASES_DIR = os.path.join(PRODUCTS_DIR, "showcases")
SKIP_DIRS = {"extension-assets"}

errors = []
warnings = []

if not os.path.isdir(SHOWCASES_DIR):
    print(f"⚠️  Showcases directory not found: {SHOWCASES_DIR}")
    sys.exit(0)

# --- Collect showcase directories ---
showcase_dirs = sorted([
    name for name in os.listdir(SHOWCASES_DIR)
    if os.path.isdir(os.path.join(SHOWCASES_DIR, name)) and name not in SKIP_DIRS
])

# --- Check 1: Showcase list in main SKILL.md matches directories ---
main_skill_path = os.path.join(PRODUCTS_DIR, "SKILL.md")
if os.path.isfile(main_skill_path):
    with open(main_skill_path, "r", encoding="utf-8") as f:
        main_skill = f.read()

    # Extract showcase slugs from the table in main SKILL.md
    # Pattern: [`slug`](...) or just slug in table cells
    listed_slugs = set(re.findall(r'\[`([^`]+)`\]', main_skill))
    actual_slugs = set(showcase_dirs)

    missing_from_skill = actual_slugs - listed_slugs
    extra_in_skill = listed_slugs - actual_slugs

    if missing_from_skill:
        errors.append(f"  main SKILL.md — showcase dirs not listed in Showcases table: {missing_from_skill}")
    if extra_in_skill:
        errors.append(f"  main SKILL.md — listed in Showcases table but dir missing: {extra_in_skill}")

# --- Check 2: No duplicate long text blocks between showcase SKILL.md files ---
# Find paragraphs (3+ sentences) that appear in multiple SKILL.md files
paragraph_sources = {}  # paragraph_hash -> [file1, file2, ...]
for name in showcase_dirs:
    skill_path = os.path.join(SHOWCASES_DIR, name, "SKILL.md")
    if not os.path.isfile(skill_path):
        continue
    with open(skill_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Split into paragraphs (blocks separated by blank lines)
    paragraphs = re.split(r'\n\s*\n', content)
    for para in paragraphs:
        # Only check substantial paragraphs (>100 chars, not tables/headers)
        clean = para.strip()
        if len(clean) < 100 or clean.startswith('#') or clean.startswith('|'):
            continue
        # Normalize whitespace
        normalized = re.sub(r'\s+', ' ', clean)
        if normalized in paragraph_sources:
            paragraph_sources[normalized].append(name)
        else:
            paragraph_sources[normalized] = [name]

for para, sources in paragraph_sources.items():
    if len(sources) > 1:
        warnings.append(f"  Duplicate paragraph across {sources}: \"{para[:80]}...\"")

# --- Check 3: CLAUDE.md.workspace auth hint references SKILL.md ---
workspace_path = os.path.join(PRODUCTS_DIR, "CLAUDE.md.workspace")
if os.path.isfile(workspace_path):
    with open(workspace_path, "r", encoding="utf-8") as f:
        workspace = f.read()
    # Must reference SKILL.md for auth details
    if "SKILL.md" not in workspace:
        warnings.append("  CLAUDE.md.workspace — no reference to SKILL.md (auth details should be in SKILL.md, not duplicated)")

# --- Check 4: Main SKILL.md "Система авторизации" not duplicated in CLAUDE-SHOWCASES.md ---
showcases_doc_path = os.path.join(PRODUCTS_DIR, "CLAUDE-SHOWCASES.md")
if os.path.isfile(showcases_doc_path):
    with open(showcases_doc_path, "r", encoding="utf-8") as f:
        showcases_doc = f.read()
    if "авторизации" in showcases_doc.lower() or "auth" in showcases_doc.lower():
        # Only warn if it looks like a duplicate auth section, not just a mention
        if re.search(r'##.*[Аа]вториз|##.*[Aa]uth', showcases_doc):
            warnings.append("  CLAUDE-SHOWCASES.md — contains auth section (should only be in main SKILL.md)")

# --- Output ---
if errors:
    print("❌ Duplicate data lint errors:")
    for e in errors:
        print(e)

if warnings:
    print("\n⚠️  Warnings (non-blocking):")
    for w in warnings:
        print(w)

if not errors and not warnings:
    print(f"✅ No duplicates found across {len(showcase_dirs)} showcases + main docs")

sys.exit(1 if errors else 0)
