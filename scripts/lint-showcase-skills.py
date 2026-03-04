#!/usr/bin/env python3
"""Lint: validate showcase SKILL.md files.

Checks every showcase directory (except extension-assets) has:
  1. SKILL.md exists
  2. Required sections present: "Что это", "Как воспроизвести", "Ключевые особенности", "Страницы", "Как адаптировать"
  3. "Как воспроизвести" section contains a prompt (blockquote > line)
  4. Pages listed in SKILL.md match pages found in demo.html (data-page or navigateTo)
  5. If config.yaml exists, prompt in SKILL.md matches config.yaml prompt

Usage: python3 scripts/lint-showcase-skills.py
Exit code 0 = clean, 1 = found issues.
"""

import os
import re
import sys

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

SHOWCASES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "products", "simple_dashboard", "showcases"
)

SKIP_DIRS = {"extension-assets"}

REQUIRED_SECTIONS = [
    "Что это",
    "Как воспроизвести",
    "Ключевые особенности",
    "Страницы",
    "Как адаптировать",
]

errors = []
warnings = []

if not os.path.isdir(SHOWCASES_DIR):
    print(f"⚠️  Showcases directory not found: {SHOWCASES_DIR}")
    sys.exit(0)


def extract_pages_from_demo(demo_path):
    """Extract page names from demo.html via data-page attributes and navigateTo calls."""
    if not os.path.isfile(demo_path):
        return set()
    with open(demo_path, "r", encoding="utf-8") as f:
        content = f.read()
    pages = set()
    # data-page="xxx"
    pages.update(re.findall(r'data-page="([^"]+)"', content))
    # navigateTo('xxx')
    pages.update(re.findall(r"navigateTo\('([^']+)'\)", content))
    return pages


def extract_pages_from_skill(skill_content):
    """Extract page names from SKILL.md table rows: | PageName | ... |"""
    # Look for table rows in the "Страницы" section
    in_pages = False
    pages = set()
    for line in skill_content.split("\n"):
        if re.match(r"^##\s+Страницы", line):
            in_pages = True
            continue
        if in_pages and line.startswith("## "):
            break
        if in_pages and line.startswith("|") and "---" not in line:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 2 and cells[0] not in ("Страница", "Page"):
                pages.add(cells[0].lower().replace(" ", "").strip())
    return pages


def extract_prompt_from_skill(skill_content):
    """Extract the blockquote prompt from 'Как воспроизвести' section."""
    in_section = False
    prompt_lines = []
    for line in skill_content.split("\n"):
        if re.match(r"^##\s+Как воспроизвести", line):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section and line.startswith("> "):
            prompt_lines.append(line[2:].strip())
    return " ".join(prompt_lines).strip()


def extract_prompt_from_config(config_path):
    """Extract prompt from config.yaml."""
    if not HAS_YAML:
        with open(config_path, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r'prompt:\s*[">]?\s*(.+?)(?:\n\s*\n|\n\s+\w+:)', content, re.DOTALL)
        if match:
            return re.sub(r'\s+', ' ', match.group(1)).strip().rstrip('"')
        return ""

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data and "showcase" in data and "prompt" in data["showcase"]:
            return data["showcase"]["prompt"].strip()
    except yaml.YAMLError:
        # Fallback to regex for invalid YAML
        with open(config_path, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r'prompt:\s*[">]?\s*(.+?)(?:\n\s*\n|\n\s+\w+:)', content, re.DOTALL)
        if match:
            return re.sub(r'\s+', ' ', match.group(1)).strip().rstrip('"')
    return ""


for name in sorted(os.listdir(SHOWCASES_DIR)):
    showcase_path = os.path.join(SHOWCASES_DIR, name)
    if not os.path.isdir(showcase_path) or name in SKIP_DIRS:
        continue

    skill_path = os.path.join(showcase_path, "SKILL.md")
    demo_path = os.path.join(showcase_path, "demo.html")
    config_path = os.path.join(showcase_path, "config.yaml")

    # Check 1: SKILL.md exists
    if not os.path.isfile(skill_path):
        errors.append(f"  {name}/SKILL.md — file missing")
        continue

    with open(skill_path, "r", encoding="utf-8") as f:
        skill_content = f.read()

    # Check 2: Required sections
    for section in REQUIRED_SECTIONS:
        pattern = rf"^##\s+{re.escape(section)}"
        if not re.search(pattern, skill_content, re.MULTILINE):
            errors.append(f"  {name}/SKILL.md — missing section: ## {section}")

    # Check 3: Prompt in "Как воспроизвести"
    prompt = extract_prompt_from_skill(skill_content)
    if not prompt:
        errors.append(f"  {name}/SKILL.md — no prompt found in 'Как воспроизвести' (need > blockquote)")

    # Check 4: Pages match demo.html
    demo_pages = extract_pages_from_demo(demo_path)
    skill_pages = extract_pages_from_skill(skill_content)
    if demo_pages and skill_pages:
        # Normalize for comparison
        demo_normalized = {p.lower() for p in demo_pages}
        skill_normalized = {p.lower() for p in skill_pages}
        missing_in_skill = demo_normalized - skill_normalized
        extra_in_skill = skill_normalized - demo_normalized
        if missing_in_skill:
            warnings.append(f"  {name}/SKILL.md — pages in demo.html but not in SKILL.md: {missing_in_skill}")
        if extra_in_skill:
            warnings.append(f"  {name}/SKILL.md — pages in SKILL.md but not in demo.html: {extra_in_skill}")
    elif demo_pages and not skill_pages:
        warnings.append(f"  {name}/SKILL.md — could not parse pages table (demo has: {demo_pages})")

    # Check 5: config.yaml prompt consistency
    if os.path.isfile(config_path) and prompt:
        config_prompt = extract_prompt_from_config(config_path)
        if config_prompt:
            # Normalize whitespace for comparison
            norm_skill = re.sub(r'\s+', ' ', prompt).strip()
            norm_config = re.sub(r'\s+', ' ', config_prompt).strip()
            # Check if skill prompt starts with config prompt (or vice versa)
            if norm_skill[:50] != norm_config[:50]:
                warnings.append(f"  {name}/SKILL.md — prompt differs from config.yaml prompt")
                warnings.append(f"    SKILL:  {norm_skill[:80]}...")
                warnings.append(f"    config: {norm_config[:80]}...")

if errors:
    print("❌ Showcase SKILL.md lint errors:")
    for e in errors:
        print(e)

if warnings:
    print("\n⚠️  Warnings (non-blocking):")
    for w in warnings:
        print(w)

if not errors and not warnings:
    count = len([n for n in os.listdir(SHOWCASES_DIR)
                 if os.path.isdir(os.path.join(SHOWCASES_DIR, n)) and n not in SKIP_DIRS])
    print(f"✅ All {count} showcase SKILL.md files OK")

sys.exit(1 if errors else 0)
