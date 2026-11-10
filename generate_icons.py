import os
import math
from PIL import Image, ImageDraw, ImageFont

def create_app_icon(output_dir, root_dir):
    size = 1024  # Render at 1024x1024 for supersampling anti-aliasing
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Background squircle / rounded rect with gradient
    # Deep midnight indigo to rich imperial violet
    # Gradient: Top-left #1a102f to bottom-right #3b1466
    for y in range(size):
        ratio = y / size
        # Color interpolation
        r = int(24 + (52 - 24) * ratio)
        g = int(14 + (20 - 14) * ratio)
        b = int(46 + (98 - 46) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Add a glowing radial center
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    o_draw = ImageDraw.Draw(overlay)
    cx, cy = size // 2, size // 2
    for rad in range(350, 0, -5):
        alpha = int(35 * (1 - rad / 350))
        o_draw.ellipse(
            [cx - rad, cy - rad, cx + rad, cy + rad],
            fill=(142, 36, 170, alpha)
        )
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # 2. Golden decorative outer ring / border (circular inset)
    ring_margin = 48
    draw.ellipse(
        [ring_margin, ring_margin, size - ring_margin, size - ring_margin],
        outline=(255, 215, 0, 160),
        width=10
    )
    # Inner thin ring
    inner_margin = 64
    draw.ellipse(
        [inner_margin, inner_margin, size - inner_margin, size - inner_margin],
        outline=(255, 235, 59, 80),
        width=4
    )

    # 3. Main Calligraphic Character: "汉" (Han / Chinese)
    # Try msyhbd.ttc or simhei.ttf or simkai.ttf
    font_paths = [
        "C:\\Windows\\Fonts\\msyhbd.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simkai.ttf",
        "C:\\Windows\\Fonts\\msyh.ttc"
    ]
    font = None
    font_size = 560
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception as e:
                pass
    
    if font:
        char = "汉"
        # Get bounding box to center perfectly
        bbox = draw.textbbox((0, 0), char, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = (size - text_w) // 2 - bbox[0]
        y = (size - text_h) // 2 - bbox[1] - 30

        # Draw soft shadow
        shadow_overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(shadow_overlay)
        s_draw.text((x + 8, y + 16), char, font=font, fill=(0, 0, 0, 140))
        img = Image.alpha_composite(img, shadow_overlay)
        draw = ImageDraw.Draw(img)

        # Draw main golden text
        # Golden gradient effect or solid premium gold #FFD54F with high contrast
        draw.text((x, y), char, font=font, fill=(255, 224, 130, 255))
        # Inner highlight
        draw.text((x - 1, y - 1), char, font=font, fill=(255, 248, 225, 120))

    # 4. Small sub-badge at bottom: "BKRS • HSK"
    sub_font = None
    sub_font_paths = [
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\seguiemj.ttf"
    ]
    for fp in sub_font_paths:
        if os.path.exists(fp):
            try:
                sub_font = ImageFont.truetype(fp, 56)
                break
            except Exception:
                pass
    if sub_font:
        sub_text = "БКРС • HSK"
        bbox = draw.textbbox((0, 0), sub_text, font=sub_font)
        sw = bbox[2] - bbox[0]
        sx = (size - sw) // 2 - bbox[0]
        sy = size - 170
        # Pill background
        pill_pad_x = 28
        pill_pad_y = 12
        draw.rounded_rectangle(
            [sx - pill_pad_x, sy - pill_pad_y, sx + sw + pill_pad_x, sy + (bbox[3] - bbox[1]) + pill_pad_y],
            radius=20,
            fill=(20, 10, 36, 200),
            outline=(255, 215, 0, 120),
            width=3
        )
        draw.text((sx, sy), sub_text, font=sub_font, fill=(255, 235, 150, 240))

    # 5. Export different sizes
    sizes = {
        "icon_512.png": (512, 512),
        "icon_192.png": (192, 192),
        "icon_144.png": (144, 144),
        "icon_96.png": (96, 96),
        "icon_48.png": (48, 48)
    }

    os.makedirs(output_dir, exist_ok=True)
    for fname, (w, h) in sizes.items():
        resized = img.resize((w, h), Image.Resampling.LANCZOS)
        out_path = os.path.join(output_dir, fname)
        resized.save(out_path, "PNG", optimize=True)
        print(f"Generated {out_path} ({w}x{h})")

    # Also save 512x512 icon at root of project as icon.png for AppMint
    root_icon = os.path.join(root_dir, "icon.png")
    img.resize((512, 512), Image.Resampling.LANCZOS).save(root_icon, "PNG", optimize=True)
    print(f"Generated root icon: {root_icon}")

if __name__ == "__main__":
    out_dir = r"C:\флешка\03_Сайт\ChinesePlatform_Project\icons"
    root_dir = r"C:\флешка\03_Сайт\ChinesePlatform_Project"
    create_app_icon(out_dir, root_dir)
