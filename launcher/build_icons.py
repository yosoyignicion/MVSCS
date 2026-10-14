"""Genera el icono de la app (PNG + ICO) para el iniciador MVSCS.

Uso:  python launcher/build_icons.py
No requiere dependencias nuevas salvo Pillow (ya usada por el proyecto).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BG = (11, 18, 32, 255)
BG2 = (17, 34, 58, 255)
ACCENT = (56, 189, 248, 255)
RING = (34, 211, 238, 255)
WHITE = (241, 245, 249, 255)
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def centered(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, y: int, fill, width: int = 1024, spacing: int = 0) -> None:
    if spacing:
        total = sum(draw.textlength(ch, font=fnt) + spacing for ch in text) - spacing
        x = (width - total) / 2
        for ch in text:
            draw.text((x, y), ch, font=fnt, fill=fill)
            x += draw.textlength(ch, font=fnt) + spacing
        return
    bbox = draw.textbbox((0, 0), text, font=fnt)
    draw.text(((width - (bbox[2] - bbox[0])) / 2, y), text, font=fnt, fill=fill)


def build_icon(size: int = 1024) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.19), fill=BG)
    draw.rounded_rectangle((int(size * 0.03), int(size * 0.03), size - int(size * 0.03), size - int(size * 0.03)), radius=int(size * 0.16), outline=BG2, width=int(size * 0.012))
    # Escudo (seguridad)
    cx, top, w, h = size / 2, size * 0.16, size * 0.30, size * 0.34
    shield = [
        (cx - w / 2, top),
        (cx + w / 2, top),
        (cx + w / 2, top + h * 0.55),
        (cx, top + h),
        (cx - w / 2, top + h * 0.55),
    ]
    draw.polygon(shield, fill=RING)
    draw.polygon([(cx - w / 2 + size * 0.02, top + size * 0.02), (cx + w / 2 - size * 0.02, top + size * 0.02), (cx + w / 2 - size * 0.02, top + h * 0.5), (cx, top + h - size * 0.03), (cx - w / 2 + size * 0.02, top + h * 0.5)], fill=BG)
    # Texto
    centered(draw, "MVSCS", font(FONT_BOLD, int(size * 0.17)), int(size * 0.55), WHITE)
    centered(draw, "PRIVATE DASHBOARD", font(FONT_REG, int(size * 0.052)), int(size * 0.77), ACCENT, spacing=int(size * 0.006))
    return image


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    icon = build_icon(1024)
    icon.save(ASSETS / "icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(ASSETS / "icon-512.png")
    icon.save(ASSETS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("Iconos generados en", ASSETS)


if __name__ == "__main__":
    main()
