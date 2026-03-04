#!/usr/bin/env python3
"""Lint: detect Cyrillic text leaked into English-facing UI files,
currency symbols in wrong i18n context, and stray .txt files in showcases.

Usage: python3 scripts/lint-cyrillic.py [--verbose]
Exit code 0 = clean, 1 = found issues.
Suppress a line with: // cyrillic-ok  or  <!-- cyrillic-ok -->
"""

import os, re, sys, fnmatch

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCAN_DIRS = ["botplatform/src", "extensions", "products"]
SCAN_EXT = {".ts", ".js", ".html", ".htm"}

# Files to skip entirely (glob basename match)
IGNORE_FILES = [
    "i18n.ts", "i18n.js",       # translation dictionaries
    "page.html",                 # screenshot-only pages (have separate demo.html with i18n)
    "bot.ts",                    # TODO: refactor bot.ts to use i18n, then remove from ignore
    "webchat.ts",               # TODO: refactor webchat.ts to use i18n, then remove from ignore
    "take_banner_screenshot.js", # banner text is intentionally in Russian
]
# Directories to skip
IGNORE_DIRS = {"node_modules", "out", "dist", ".git", "tests", "test", "__tests__"}
# Files matching these patterns are skipped
IGNORE_PATTERNS = ["*.test.js", "*.test.ts", "*.spec.js", "*.spec.ts", "test-*.js"]

CYRILLIC = re.compile(r"[а-яА-ЯёЁ]{2,}")
RU_BLOCK = re.compile(r"\bru\s*:\s*\{")
EN_BLOCK = re.compile(r"\ben\s*:\s*\{")
TERNARY_RU = re.compile(r"""===?\s*['"]ru['"]""")
STRING_DETECT = re.compile(r"\.(includes|indexOf|match|test|startsWith|endsWith)\s*\(")
COMMENT_JS = re.compile(r"^\s*(//|/?\*)")
# Locale data: field names ending with Ru, or inside locale config objects
LOCALE_DATA_FIELD = re.compile(r"""(?:nameRu|Ru\b|taxName|invoiceTitle|numberFormat|paymentMethod|paymentTerms|companyName|address|city|country|bankName|accountName|description|notes)\s*[:=]""")
LANG_TERNARY_FULL = re.compile(r"""isRu\s*\?""")

# Currency detection
RUBLE_SIGN = re.compile(r"\u20bd")                  # ₽ sign
DOLLAR_AMOUNT = re.compile(r"\$\d")                  # $123 (not ${var})

# Showcase .txt files
SHOWCASE_DIR_PATTERN = re.compile(r"products/[^/]+/showcases/")


def should_skip_file(relpath):
    name = os.path.basename(relpath)
    if name in IGNORE_FILES:
        return True
    for pat in IGNORE_PATTERNS:
        if fnmatch.fnmatch(name, pat):
            return True
    return False


def scan_file(filepath, relpath, verbose):
    issues = []
    try:
        lines = open(filepath, encoding="utf-8", errors="replace").readlines()
    except (OSError, UnicodeDecodeError):
        return issues

    in_ru_block = False
    ru_depth = 0
    in_en_block = False
    en_depth = 0
    in_html_comment = False
    in_block_comment = False

    for i, line in enumerate(lines):
        lineno = i + 1

        # Track JS block comments /* ... */
        if "/*" in line and "*/" not in line:
            in_block_comment = True
        if "*/" in line:
            in_block_comment = False

        # Track HTML comments <!-- ... -->
        if "<!--" in line and "-->" not in line:
            in_html_comment = True
        if "-->" in line:
            in_html_comment = False

        # Track en: { ... } blocks via brace depth
        if not in_en_block and not in_ru_block and EN_BLOCK.search(line):
            in_en_block = True
            en_depth = 0
        if in_en_block:
            en_depth += line.count("{") - line.count("}")
            if en_depth <= 0:
                in_en_block = False
                en_depth = 0
            # Check for ₽ in EN block (should be $ or tt('currency'))
            if RUBLE_SIGN.search(line) and "currency-ok" not in line:
                issues.append((relpath, lineno, f"[currency] ₽ in en: block — use tt('currency'): {line.rstrip()}"))
            continue

        # Track ru: { ... } blocks via brace depth
        if not in_ru_block and RU_BLOCK.search(line):
            in_ru_block = True
            ru_depth = 0
        if in_ru_block:
            ru_depth += line.count("{") - line.count("}")
            if ru_depth <= 0:
                in_ru_block = False
                ru_depth = 0
            # Check for $N in RU block (should be ₽ or tt('currency'))
            if DOLLAR_AMOUNT.search(line) and "currency-ok" not in line:
                issues.append((relpath, lineno, f"[currency] $ in ru: block — use tt('currency'): {line.rstrip()}"))
            continue

        # No Cyrillic — clean line
        if not CYRILLIC.search(line):
            continue

        # Explicit suppress: // cyrillic-ok or <!-- cyrillic-ok -->
        if "cyrillic-ok" in line:
            continue

        # JS line comment or block comment
        if in_block_comment or COMMENT_JS.match(line):
            if verbose:
                print(f"  skip comment  {relpath}:{lineno}")
            continue

        # HTML comment block
        if in_html_comment:
            if verbose:
                print(f"  skip html-comment  {relpath}:{lineno}")
            continue

        # Inline trailing comment: Cyrillic only after //
        comment_pos = line.find("//")
        if comment_pos > 0:
            before = line[:comment_pos]
            if not CYRILLIC.search(before):
                if verbose:
                    print(f"  skip inline-comment  {relpath}:{lineno}")
                continue

        # Bilingual ternary: === 'ru' within ±1 line window
        window = line
        if i > 0:
            window = lines[i - 1] + window
        if i < len(lines) - 1:
            window = window + lines[i + 1]
        if TERNARY_RU.search(window):
            if verbose:
                print(f"  skip ternary  {relpath}:{lineno}")
            continue

        # Locale data fields (nameRu, taxName, companyName, etc. in showcase demos)
        if LOCALE_DATA_FIELD.search(line):
            if verbose:
                print(f"  skip locale-data  {relpath}:{lineno}")
            continue

        # isRu ? 'English' : 'Русский' pattern
        if LANG_TERNARY_FULL.search(window):
            if verbose:
                print(f"  skip isRu-ternary  {relpath}:{lineno}")
            continue

        # String detection heuristic (.includes('кириллица'))
        if STRING_DETECT.search(line):
            if verbose:
                print(f"  skip heuristic  {relpath}:{lineno}")
            continue

        # console.log/error/warn — dev logs, not UI
        if re.search(r"console\.(log|error|warn|info|debug)\s*\(", line):
            if verbose:
                print(f"  skip console  {relpath}:{lineno}")
            continue

        issues.append((relpath, lineno, line.rstrip()))

    return issues


def check_txt_files():
    """Check for stray .txt files in showcase directories."""
    issues = []
    for scan_dir in SCAN_DIRS:
        root_dir = os.path.join(REPO, scan_dir)
        if not os.path.isdir(root_dir):
            continue
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            reldir = os.path.relpath(dirpath, REPO)
            if not SHOWCASE_DIR_PATTERN.search(reldir + "/"):
                continue
            for fname in filenames:
                if fname.endswith(".txt"):
                    relpath = os.path.join(reldir, fname)
                    issues.append((relpath, 0, f"[txt] .txt file in showcase dir — migrate to config.yaml: {fname}"))
    return issues


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    all_issues = []

    # Check for .txt files in showcase directories
    all_issues.extend(check_txt_files())

    for scan_dir in SCAN_DIRS:
        root_dir = os.path.join(REPO, scan_dir)
        if not os.path.isdir(root_dir):
            continue
        for dirpath, dirnames, filenames in os.walk(root_dir):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            for fname in filenames:
                ext = os.path.splitext(fname)[1]
                if ext not in SCAN_EXT:
                    continue
                filepath = os.path.join(dirpath, fname)
                relpath = os.path.relpath(filepath, REPO)
                if should_skip_file(relpath):
                    continue
                all_issues.extend(scan_file(filepath, relpath, verbose))

    if all_issues:
        for relpath, lineno, line in all_issues:
            if lineno:
                print(f"{relpath}:{lineno}: {line}")
            else:
                print(f"{relpath}: {line}")
        print(f"\n✗ Found {len(all_issues)} issue(s)")
        sys.exit(1)
    else:
        print("✓ No Cyrillic leaks, currency issues, or stray .txt files found")
        sys.exit(0)


if __name__ == "__main__":
    main()
