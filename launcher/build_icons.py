"""Genera el icono de la app (PNG + ICO) del Centro de administración.

Uso:  python launcher/build_icons.py
Requiere Pillow (ya usada por el proyecto para generar recursos).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BG = (11, 23, 36, 255)
BG2 = (16, 42, 58, 255)
ACCENT = (14, 116, 144, 255)
RING = (103, 232, 249, 255)
WHITE = (255, 255, 255, 255)
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
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.20), fill=BG)
    draw.rounded_rectangle((int(size * 0.035), int(size * 0.035), size - int(size * 0.035), size - int(size * 0.035)), radius=int(size * 0.17), outline=BG2, width=int(size * 0.012))
    # Anillo cian de marca
    margin = size * 0.20
    draw.ellipse((margin, margin, size - margin, size - margin), outline=ACCENT, width=int(size * 0.045))
    # C blanca de Centro
    centered(draw, "C", font(FONT_BOLD, int(size * 0.42)), int(size * 0.285), WHITE)
    # Punto cian inferior derecho
    dot = size * 0.045
    draw.ellipse((size * 0.71 - dot, size * 0.71 - dot, size * 0.71 + dot, size * 0.71 + dot), fill=RING)
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
