#!/usr/bin/env python3
"""Lint: validate showcase demo pages.

Checks every showcase directory has:
  1. demo.html file exists
  2. demo.html contains a promptBar with position:fixed;bottom:0

Usage: python3 scripts/lint-showcase-demos.py
Exit code 0 = clean, 1 = found issues.
"""

import os, re, sys

SHOWCASES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "products", "simple_dashboard", "showcases"
)

errors = []

if not os.path.isdir(SHOWCASES_DIR):
    print(f"⚠️  Showcases directory not found: {SHOWCASES_DIR}")
    sys.exit(0)

SKIP_DIRS = {"extension-assets"}

for name in sorted(os.listdir(SHOWCASES_DIR)):
    showcase_path = os.path.join(SHOWCASES_DIR, name)
    if not os.path.isdir(showcase_path) or name in SKIP_DIRS:
        continue

    demo_path = os.path.join(showcase_path, "demo.html")

    # Check 1: demo.html exists
    if not os.path.isfile(demo_path):
        errors.append(f"  {name}/demo.html — file missing")
        continue

    with open(demo_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Check 2: has promptBar element
    if 'id="promptBar"' not in content:
        errors.append(f"  {name}/demo.html — missing promptBar element")
        continue

    # Check 3: promptBar is fixed at bottom
    # Match the promptBar div and check its style contains bottom:0
    bar_match = re.search(r'id="promptBar"[^>]*style="([^"]*)"', content)
    if not bar_match:
        errors.append(f"  {name}/demo.html — promptBar has no inline style")
        continue

    style = bar_match.group(1)
    if "position:fixed" not in style and "position: fixed" not in style:
        errors.append(f"  {name}/demo.html — promptBar not position:fixed")
    if "bottom:0" not in style and "bottom: 0" not in style:
        errors.append(f"  {name}/demo.html — promptBar not at bottom (missing bottom:0)")

if errors:
    print("❌ Showcase demo lint errors:")
    for e in errors:
        print(e)
    sys.exit(1)
else:
    count = len([n for n in os.listdir(SHOWCASES_DIR) if os.path.isdir(os.path.join(SHOWCASES_DIR, n))])
    print(f"✅ All {count} showcase demos OK (demo.html + promptBar at bottom)")
    sys.exit(0)
