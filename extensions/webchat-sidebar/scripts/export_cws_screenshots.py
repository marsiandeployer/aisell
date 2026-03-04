#!/usr/bin/env python3
"""
Export Chrome Web Store screenshot sizes from a source image.

Usage:
  python3 scripts/export_cws_screenshots.py previews/cases/yoga-hero-button/screenshot.png

Outputs:
  - screenshot-1280x800.png
  - screenshot-640x400.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


TARGETS = [(1280, 800), (640, 400)]
TARGET_RATIO = 16 / 10


def crop_to_ratio(img: Image.Image, ratio: float) -> Image.Image:
    w, h = img.size
    current = w / h
    if abs(current - ratio) < 1e-6:
        return img
    if current > ratio:
        new_w = int(h * ratio)
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    new_h = int(w / ratio)
    top = (h - new_h) // 2
    return img.crop((0, top, w, top + new_h))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to source screenshot")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    if not source.exists():
        raise SystemExit(f"Source file not found: {source}")

    with Image.open(source) as img:
        base = crop_to_ratio(img.convert("RGB"), TARGET_RATIO)
        out_dir = source.parent
        stem = source.stem
        for w, h in TARGETS:
            resized = base.resize((w, h), Image.Resampling.LANCZOS)
            out_path = out_dir / f"{stem}-{w}x{h}.png"
            resized.save(out_path, format="PNG", optimize=True)
            print(out_path)


if __name__ == "__main__":
    main()
