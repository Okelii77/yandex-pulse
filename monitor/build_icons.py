#!/usr/bin/env python3
"""Build deterministic PNG app icons from the approved Pulse app-icon geometry.

Use a full-bleed yellow square; iOS and Android apply their own shape masks.
This avoids white corners, render artifacts and reliance on SVG touch-icon support.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
SUPERSAMPLE = 1536
SCALE = SUPERSAMPLE / 512
OUTPUTS = (
    (180, "apple-touch-icon-v2.png"),
    (192, "icon-192-v2.png"),
    (512, "icon-512-v2.png"),
    (32, "favicon-32-v2.png"),
)


def build() -> None:
    image = Image.new("RGB", (SUPERSAMPLE, SUPERSAMPLE))
    canvas = ImageDraw.Draw(image)

    for y in range(SUPERSAMPLE):
        fraction = y / (SUPERSAMPLE - 1)
        color = (
            255,
            round(233 - 25 * fraction - 1.5 * abs(2 * fraction - 1)),
            round(7 - 4 * fraction),
        )
        canvas.line((0, y, SUPERSAMPLE, y), fill=color)

    # Geometric reproduction of the approved bold ECG mark.
    path = [(37, 263), (172, 263), (250, 149), (322, 356),
            (395, 245), (421, 263), (476, 263)]
    points = [(round(x * SCALE), round(y * SCALE)) for x, y in path]
    width = round(38 * SCALE)
    dark = (15, 15, 15)
    canvas.line(points, fill=dark, width=width, joint="curve")

    # Round every joint, including the two ends.
    radius = width / 2
    for x, y in points:
        canvas.ellipse(
            (round(x-radius), round(y-radius), round(x+radius), round(y+radius)),
            fill=dark,
        )

    SITE.mkdir(parents=True, exist_ok=True)
    for size, name in OUTPUTS:
        icon = image.resize((size, size), Image.Resampling.LANCZOS)
        if name.startswith("apple-touch"):
            # iOS must receive an opaque PNG with exact 180 × 180 dimensions.
            assert icon.mode == "RGB" and icon.size == (180, 180)
        icon.save(SITE / name, format="PNG", optimize=True)
        print(f"Built {name}: {size}x{size}")


if __name__ == "__main__":
    build()
