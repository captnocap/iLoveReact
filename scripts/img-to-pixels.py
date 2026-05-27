#!/usr/bin/env python3
# img-to-pixels.py — turn any image into JSON pixel matrices for use as a
# custom in-game icon.
#
# Usage:
#   scripts/img-to-pixels.py <input-image> <out-stem> [--sizes 64,128,512]
#
# Produces, next to <out-stem>:
#   <out-stem>.64.json
#   <out-stem>.128.json
#   <out-stem>.512.json
#
# Each file is { "size": N, "palette": ["#RRGGBB", ...], "rows": [...] }.
# Each row is a list of left-to-right runs. A bare int/null is a single
# cell (with that palette index, or transparent); a [count, value] pair is
# a run of `count` cells. Sum of counts per row equals `size`. Long flat
# regions and null blocks collapse aggressively; singleton-heavy photos
# pay only a bare-int-per-cell cost.

import json
import os
import sys
from PIL import Image

ALPHA_CUTOFF = 16  # below this alpha, store null (transparent)

def to_hex(r, g, b):
    return f"#{r:02X}{g:02X}{b:02X}"

def quantize(img: Image.Image, size: int, colors: int = 64):
    # LANCZOS for crisp downscale; convert to RGBA so we keep transparency.
    # Then snap to a fixed-size adaptive palette via PIL's median-cut. Without
    # this step every Lanczos-blurred pixel is a unique near-duplicate color
    # (#68984C vs #68984B), which kills RLE coalescing — the palette would
    # have thousands of entries and adjacent cells would almost never share an
    # index. Quantizing to ~64 colors collapses near-duplicates and lets runs
    # form. Dither=NONE because dithering scatters noise back into flat
    # regions, which also kills RLE; we'd rather have visible banding.
    rgba = img.convert("RGBA").resize((size, size), Image.LANCZOS)
    # Keep alpha aside so quantize() only acts on RGB.
    alpha = rgba.split()[-1]
    rgb = rgba.convert("RGB")
    quantized = rgb.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    pal_flat = quantized.getpalette()[: colors * 3]
    palette: list[str] = [
        to_hex(pal_flat[i], pal_flat[i + 1], pal_flat[i + 2])
        for i in range(0, len(pal_flat), 3)
    ]
    idx_px = quantized.load()
    alpha_px = alpha.load()
    pixels: list = []
    for y in range(size):
        for x in range(size):
            if alpha_px[x, y] < ALPHA_CUTOFF:
                pixels.append(None)
            else:
                pixels.append(idx_px[x, y])
    return palette, pixels

def encode_rows(pixels, size):
    """Convert a flat row-major pixels array into row-of-runs encoding.
    Each row entry is either a bare value (single cell) or [count, value]
    (run of N adjacent cells with the same value)."""
    rows = []
    for y in range(size):
        row = []
        x = 0
        while x < size:
            v = pixels[y * size + x]
            run = 1
            while x + run < size and pixels[y * size + x + run] == v:
                run += 1
            row.append(v if run == 1 else [run, v])
            x += run
        rows.append(row)
    return rows

def main():
    if len(sys.argv) < 3:
        print("usage: img-to-pixels.py <input-image> <out-stem> [--sizes 64,128,512]", file=sys.stderr)
        sys.exit(2)

    src = sys.argv[1]
    stem = sys.argv[2]
    sizes = [64, 128, 512]
    for arg in sys.argv[3:]:
        if arg.startswith("--sizes="):
            sizes = [int(x) for x in arg.split("=", 1)[1].split(",")]
        elif arg == "--sizes" and len(sys.argv) > sys.argv.index(arg) + 1:
            sizes = [int(x) for x in sys.argv[sys.argv.index(arg) + 1].split(",")]

    img = Image.open(src)
    os.makedirs(os.path.dirname(stem) or ".", exist_ok=True)

    for size in sizes:
        palette, pixels = quantize(img, size)
        rows = encode_rows(pixels, size)
        path = f"{stem}.{size}.json"
        with open(path, "w") as f:
            json.dump({"size": size, "palette": palette, "rows": rows}, f, separators=(",", ":"))
        run_count = sum(len(r) for r in rows)
        print(f"wrote {path} ({size}x{size}, {len(pixels)} cells, {len(palette)} colors, {run_count} runs)")

if __name__ == "__main__":
    main()
