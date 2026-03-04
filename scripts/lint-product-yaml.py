#!/usr/bin/env python3
"""Lint: validate product.yaml files have all required fields.

Usage: python3 scripts/lint-product-yaml.py [--verbose]
Exit code 0 = clean, 1 = found issues.
"""

import os, sys, re

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed. Run: pip3 install pyyaml")
    sys.exit(1)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_DIR = os.path.join(REPO, "products")

VALID_STATUSES = {"development", "active", "deprecated"}
VALID_CATEGORIES = {"ai-builder", "automation", "analytics"}


def check_field(data, path, issues, product_id, check_type="string"):
    """Check that a nested field exists and is non-empty.

    check_type: string | list | int | any
    """
    keys = path.split(".")
    current = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            issues.append(f"  [{product_id}] missing required field: {path}")
            return None
        current = current[key]

    if check_type == "string":
        if not isinstance(current, str) or not current.strip():
            issues.append(f"  [{product_id}] field '{path}' must be a non-empty string")
            return None
    elif check_type == "list":
        if not isinstance(current, list) or len(current) == 0:
            issues.append(f"  [{product_id}] field '{path}' must be a non-empty list")
            return None
    elif check_type == "int":
        if not isinstance(current, int):
            issues.append(f"  [{product_id}] field '{path}' must be an integer")
            return None

    return current


def validate_product(filepath, verbose):
    """Validate a single product.yaml file. Returns list of issues."""
    issues = []
    relpath = os.path.relpath(filepath, REPO)

    try:
        with open(filepath, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        issues.append(f"  [{relpath}] invalid YAML: {e}")
        return issues
    except OSError as e:
        issues.append(f"  [{relpath}] cannot read: {e}")
        return issues

    if not isinstance(data, dict):
        issues.append(f"  [{relpath}] product.yaml must be a YAML mapping")
        return issues

    product_id = data.get("product_id", relpath)

    # =========================================================================
    # TOP-LEVEL REQUIRED FIELDS
    # =========================================================================
    check_field(data, "product_id", issues, product_id)
    check_field(data, "name", issues, product_id)
    check_field(data, "tagline", issues, product_id)
    check_field(data, "description", issues, product_id)
    check_field(data, "version", issues, product_id)

    # Validate product_id format
    pid = data.get("product_id", "")
    if isinstance(pid, str) and pid and not pid.startswith("simple_"):
        issues.append(f"  [{product_id}] product_id must start with 'simple_' (got '{pid}')")

    # Validate name format
    name = data.get("name", "")
    if isinstance(name, str) and name and not name.startswith("Simple"):
        issues.append(f"  [{product_id}] name must start with 'Simple' (got '{name}')")

    # Validate status
    status = check_field(data, "status", issues, product_id)
    if status and status not in VALID_STATUSES:
        issues.append(f"  [{product_id}] status must be one of {VALID_STATUSES} (got '{status}')")

    # Validate category
    category = check_field(data, "category", issues, product_id)
    if category and category not in VALID_CATEGORIES:
        issues.append(f"  [{product_id}] category must be one of {VALID_CATEGORIES} (got '{category}')")

    # =========================================================================
    # HABAB SECTION
    # =========================================================================
    check_field(data, "habab.product_url", issues, product_id)
    check_field(data, "habab.b2b_pitch", issues, product_id)
    check_field(data, "habab.target_audience", issues, product_id, check_type="list")

    # =========================================================================
    # CHROME STORE SECTION
    # =========================================================================
    check_field(data, "chrome_store.name", issues, product_id)
    check_field(data, "chrome_store.short_name", issues, product_id)
    check_field(data, "chrome_store.short_description", issues, product_id)
    check_field(data, "chrome_store.detailed_description", issues, product_id)
    check_field(data, "chrome_store.keywords", issues, product_id, check_type="list")

    # Validate Chrome Store length limits
    cs = data.get("chrome_store", {})
    if isinstance(cs, dict):
        cs_name = cs.get("name", "")
        if isinstance(cs_name, str) and len(cs_name) > 45:
            issues.append(f"  [{product_id}] chrome_store.name exceeds 45 chars ({len(cs_name)})")
        cs_short = cs.get("short_description", "")
        if isinstance(cs_short, str) and len(cs_short) > 132:
            issues.append(f"  [{product_id}] chrome_store.short_description exceeds 132 chars ({len(cs_short)})")

    # =========================================================================
    # TELEGRAM / WEBCHAT SECTION
    # =========================================================================
    check_field(data, "telegram.bot_username", issues, product_id)
    check_field(data, "telegram.webchat_url", issues, product_id)
    check_field(data, "telegram.webchat_port", issues, product_id, check_type="int")
    check_field(data, "telegram.welcome_message", issues, product_id)
    check_field(data, "telegram.system_prompt", issues, product_id)

    # =========================================================================
    # SHOWCASES SECTION
    # =========================================================================
    showcases = check_field(data, "showcases", issues, product_id, check_type="list")
    if showcases:
        for i, sc in enumerate(showcases):
            prefix = f"showcases[{i}]"
            if not isinstance(sc, dict):
                issues.append(f"  [{product_id}] {prefix} must be a mapping")
                continue
            for req in ("slug", "prompt", "caption", "tags"):
                if req not in sc or not sc[req]:
                    issues.append(f"  [{product_id}] {prefix} missing required field: {req}")

    # =========================================================================
    # VISUAL SECTION
    # =========================================================================
    check_field(data, "visual.primary_color", issues, product_id)
    check_field(data, "visual.icon_symbol", issues, product_id)

    # Validate hex color
    color = (data.get("visual") or {}).get("primary_color", "")
    if isinstance(color, str) and color and not re.match(r"^#[0-9a-fA-F]{6}$", color):
        issues.append(f"  [{product_id}] visual.primary_color must be a valid hex color (got '{color}')")

    # =========================================================================
    # SEO SECTION
    # =========================================================================
    check_field(data, "seo.keywords.primary", issues, product_id, check_type="list")
    check_field(data, "seo.article_ideas", issues, product_id, check_type="list")

    if verbose and not issues:
        print(f"  [{product_id}] OK")

    return issues


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    all_issues = []

    if not os.path.isdir(PRODUCTS_DIR):
        print(f"Products directory not found: {PRODUCTS_DIR}")
        sys.exit(1)

    product_count = 0
    for entry in sorted(os.listdir(PRODUCTS_DIR)):
        product_dir = os.path.join(PRODUCTS_DIR, entry)
        if not os.path.isdir(product_dir):
            continue
        yaml_path = os.path.join(product_dir, "product.yaml")
        if not os.path.isfile(yaml_path):
            continue
        product_count += 1
        all_issues.extend(validate_product(yaml_path, verbose))

    if product_count == 0:
        print("No product.yaml files found in products/*/")
        sys.exit(1)

    if all_issues:
        print(f"Product YAML validation errors ({len(all_issues)}):\n")
        for issue in all_issues:
            print(issue)
        print(f"\n\u2717 Found {len(all_issues)} issue(s) in {product_count} product(s)")
        sys.exit(1)
    else:
        print(f"\u2713 All {product_count} product(s) passed validation")
        sys.exit(0)


if __name__ == "__main__":
    main()
