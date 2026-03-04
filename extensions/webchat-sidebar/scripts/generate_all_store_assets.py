#!/usr/bin/env python3
"""
Generate all Chrome Web Store assets via Hydra AI (NanaBanana)

Creates:
- Extension icon 128x128 (with 96x96 actual + 16px transparent padding)
- Small promo 440x280
- Large promo 1400x560
"""
import os
import base64
import requests
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw, ImageFont
from io import BytesIO

# Load API key
env_path = Path('/root/aisell/bananzabot/.env')
HYDRA_API_KEY = None
for line in env_path.read_text().split('\n'):
    if line.startswith('HYDRA_API_KEY='):
        HYDRA_API_KEY = line.split('=', 1)[1].strip()
        break

if not HYDRA_API_KEY:
    raise ValueError("HYDRA_API_KEY not found in /root/aisell/bananzabot/.env")

OUTPUT_DIR = Path('/root/aisell/extensions/webchat-sidebar/store_assets')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def generate_image(prompt: str, size: str = "1024x1024") -> bytes:
    """Generate image via Hydra AI"""
    print(f"🎨 Generating: {prompt[:60]}...")

    response = requests.post(
        'https://api.hydraai.ru/v1/images/generations',
        headers={
            'Authorization': f'Bearer {HYDRA_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'model': 'flux-schnell-uncensored',
            'prompt': prompt,
            'n': 1,
            'size': size
        },
        timeout=120
    )
    response.raise_for_status()

    # Decode base64
    b64_data = response.json()['data'][0]['b64_json']
    if ',' in b64_data:
        b64_data = b64_data.split(',', 1)[1]

    return base64.b64decode(b64_data)

def is_dark_icon(img: Image) -> bool:
    """Check if icon is dark (needs white glow)"""
    pixels = list(img.getdata())
    # Average brightness of RGB channels
    avg_brightness = sum([sum(p[:3]) / 3 for p in pixels if len(p) >= 3]) / len(pixels)
    return avg_brightness < 128

def add_white_glow(img: Image, radius: int = 2, opacity: float = 0.3) -> Image:
    """Add subtle white glow for dark icons"""
    # Extract alpha channel
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    alpha = img.split()[3]

    # Blur alpha to create glow
    glow_mask = alpha.filter(ImageFilter.GaussianBlur(radius=radius))

    # Create white layer with blurred mask
    glow_layer = Image.new('RGBA', img.size, (255, 255, 255, 0))
    glow_layer.putalpha(glow_mask.point(lambda x: int(x * opacity)))

    # Composite glow + original
    result = Image.alpha_composite(glow_layer, img)
    return result

def create_extension_icon():
    """Create 128x128 extension icon with 16px transparent padding"""
    print("\n" + "=" * 70)
    print("1. Extension Icon (128x128)")
    print("=" * 70)

    prompt = """professional software extension icon, modern flat design,
    browser window symbol with AI chat bubble integrated,
    purple-blue gradient background (#667eea to #764ba2),
    white clean geometric shapes, minimalist style,
    centered composition, suitable for small sizes,
    96x96 actual icon size, no shadows, frontal perspective"""

    # Generate base icon
    icon_data = generate_image(prompt)
    img = Image.open(BytesIO(icon_data)).convert('RGBA')

    # Resize to 96x96 (actual icon size)
    img = img.resize((96, 96), Image.Resampling.LANCZOS)

    # Create 128x128 canvas with transparent background
    canvas = Image.new('RGBA', (128, 128), (0, 0, 0, 0))

    # Paste icon in center (16px padding on each side)
    canvas.paste(img, (16, 16), img)

    # Add white glow if icon is dark
    if is_dark_icon(img):
        print("  ℹ️ Dark icon detected, adding white glow...")
        canvas = add_white_glow(canvas, radius=2, opacity=0.25)

    # Save
    output_path = OUTPUT_DIR / 'icon128.png'
    canvas.save(output_path, 'PNG')
    file_size = output_path.stat().st_size / 1024

    print(f"  ✅ Saved: {output_path}")
    print(f"  📊 Size: {file_size:.1f} KB")
    print(f"  📐 Dimensions: 128x128 (96x96 actual + 16px padding)")

    return output_path

def create_promo_images():
    """Create promo images (large and small)"""
    print("\n" + "=" * 70)
    print("2. Promo Images")
    print("=" * 70)

    # Large promo 1400x560
    print("\n📸 Large Promo (1400x560)...")

    large_prompt = """professional Chrome Web Store promotional banner,
    split design showing AI website builder in action,
    left 50%: browser sidebar with chat interface, purple-blue gradient UI,
    right 50%: generated landing page preview with forms and content,
    modern clean design, white text overlay "Build Websites with AI",
    professional software marketing, 1400x560 format, horizontal banner"""

    # Generate 1024x1024, then resize/crop to 1400x560
    large_data = generate_image(large_prompt)
    large_img = Image.open(BytesIO(large_data)).convert('RGB')

    # Resize maintaining aspect ratio, then crop to 1400x560
    # First resize to fit width (1400px)
    width_ratio = 1400 / large_img.width
    new_height = int(large_img.height * width_ratio)
    large_img = large_img.resize((1400, new_height), Image.Resampling.LANCZOS)

    # Crop to 560 height (center crop)
    if new_height > 560:
        top = (new_height - 560) // 2
        large_img = large_img.crop((0, top, 1400, top + 560))
    elif new_height < 560:
        # Pad if needed
        padded = Image.new('RGB', (1400, 560), (255, 255, 255))
        offset = (560 - new_height) // 2
        padded.paste(large_img, (0, offset))
        large_img = padded

    # Convert to 24-bit PNG (no alpha)
    large_path = OUTPUT_DIR / 'promo-large-1400x560.png'
    large_img.save(large_path, 'PNG')
    print(f"  ✅ Saved: {large_path}")
    print(f"  📊 Size: {large_path.stat().st_size / 1024:.1f} KB")

    # Small promo 440x280 (resize from large)
    print("\n📸 Small Promo (440x280)...")
    small_img = large_img.resize((440, 280), Image.Resampling.LANCZOS)

    small_path = OUTPUT_DIR / 'promo-small-440x280.png'
    small_img.save(small_path, 'PNG')
    print(f"  ✅ Saved: {small_path}")
    print(f"  📊 Size: {small_path.stat().st_size / 1024:.1f} KB")

    return large_path, small_path

def main():
    print("=" * 70)
    print("Chrome Web Store Assets Generator")
    print("Using: Hydra AI (NanaBanana)")
    print("=" * 70)

    try:
        # 1. Extension icon
        icon_path = create_extension_icon()

        # 2. Promo images
        large_promo, small_promo = create_promo_images()

        # Summary
        print("\n" + "=" * 70)
        print("✅ ALL ASSETS GENERATED")
        print("=" * 70)
        print(f"\n📁 Output directory: {OUTPUT_DIR}")
        print("\nGenerated files:")
        print(f"  • {icon_path.name}")
        print(f"  • {large_promo.name}")
        print(f"  • {small_promo.name}")
        print("\n📋 Next steps:")
        print("  1. Review generated assets")
        print("  2. Copy screenshots to store_assets/ if needed")
        print("  3. Upload to Chrome Web Store Developer Console")
        print("=" * 70)

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0

if __name__ == "__main__":
    exit(main())
