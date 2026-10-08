#!/usr/bin/env python3
"""About-page collage tiles.

Drop source photos into public/collage-src/ (gitignored — never shipped), then:

    python3 scripts/make-collage-tiles.py

Writes to public/collage/:
  tile-NN.jpg  — 640x640 square crop for every source
  ptile-NN.jpg — 640x853 (3:4) crop for a subset, for editorial rhythm

Prints the COLLAGE_SQUARE / COLLAGE_PORTRAIT arrays for
app/about/about-client.tsx.
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

SRC = Path("public/collage-src")
OUT = Path("public/collage")
SQ = 640
PT = (640, 853)
PORTRAIT_EVERY = 5  # ~1 in 5 photos also gets a portrait tile
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> int:
    sources = sorted(p for p in SRC.iterdir() if p.suffix.lower() in EXTS)
    if not sources:
        print("no photos in public/collage-src", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for old in list(OUT.glob("tile-*.jpg")) + list(OUT.glob("ptile-*.jpg")):
        old.unlink()

    squares, portraits = [], []
    for i, src in enumerate(sources, 1):
        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        name = f"tile-{i:02d}.jpg"
        ImageOps.fit(im, (SQ, SQ)).save(OUT / name, quality=80, optimize=True)
        squares.append(f"/collage/{name}")
        if i % PORTRAIT_EVERY == 0:
            pname = f"ptile-{i:02d}.jpg"
            ImageOps.fit(im, PT).save(OUT / pname, quality=80, optimize=True)
            portraits.append(f"/collage/{pname}")

    print("const COLLAGE_SQUARE = [")
    for n in squares:
        print(f'  "{n}",')
    print("];")
    print("const COLLAGE_PORTRAIT = [")
    for n in portraits:
        print(f'  "{n}",')
    print("];")
    print(f"# {len(squares)} squares, {len(portraits)} portraits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
