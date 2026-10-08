#!/usr/bin/env python3
"""About-page collage tiles.

Drop source photos (any aspect) into public/collage-src/, then:

    python3 scripts/make-collage-tiles.py

Writes 640x640 center-cropped tiles to public/collage/tile-01..NN.jpg and
prints the COLLAGE_PHOTOS array to paste into app/about/about-client.tsx.
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

SRC = Path("public/collage-src")
OUT = Path("public/collage")
SIZE = 640
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def main() -> int:
    sources = sorted(p for p in SRC.iterdir() if p.suffix.lower() in EXTS)
    if not sources:
        print("no photos in public/collage-src", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("tile-*.jpg"):
        old.unlink()
    names = []
    for i, src in enumerate(sources, 1):
        im = Image.open(src)
        im = ImageOps.exif_transpose(im)  # respect phone orientation
        tile = ImageOps.fit(im.convert("RGB"), (SIZE, SIZE))
        name = f"tile-{i:02d}.jpg"
        tile.save(OUT / name, quality=80, optimize=True)
        names.append(f"/collage/{name}")
    print("const COLLAGE_PHOTOS = [")
    for n in names:
        print(f'  "{n}",')
    print("];")
    return 0

if __name__ == "__main__":
    sys.exit(main())
