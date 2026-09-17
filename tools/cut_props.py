#!/usr/bin/env python3
# Cut the white studio background off tools/props_src/*.src.png (PIL + numpy
# only): flood the near-white region in from the borders, feather the edge,
# remove the white that bled into edge pixels, trim, and save <name>.png.
import os, sys
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "props_src")
OUT = os.path.join(ROOT, "public", "dance")
MAX = {"pot": 640, "ladle": 720}   # longest side of the shipped sprite

def border_flood(white):
    bg = np.zeros_like(white)
    bg[0, :] = white[0, :]; bg[-1, :] = white[-1, :]; bg[:, 0] = white[:, 0]; bg[:, -1] = white[:, -1]
    while True:
        grow = bg.copy()
        grow[1:, :] |= bg[:-1, :]; grow[:-1, :] |= bg[1:, :]
        grow[:, 1:] |= bg[:, :-1]; grow[:, :-1] |= bg[:, 1:]
        grow &= white
        if (grow == bg).all(): return bg
        bg = grow

def cut(name):
    im = Image.open(os.path.join(SRC, f"{name}.src.png")).convert("RGB")
    rgb = np.asarray(im).astype(np.float32)
    white = rgb.min(axis=2) > 236
    bg = border_flood(white)
    # erode the object by 1px (the fringe is the whitest part), then feather
    a = Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.asarray(a).astype(np.float32) / 255
    # un-mix the white background out of the semi-transparent edge pixels
    safe = np.clip(alpha, 0.05, 1)[..., None]
    col = np.clip((rgb - (1 - safe) * 255) / safe, 0, 255)
    out = np.dstack([col, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(alpha > 0.02)
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    img = Image.fromarray(out)
    k = MAX.get(name, 900) / max(img.size)
    if k < 1: img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    img.save(os.path.join(OUT, f"{name}.png"), optimize=True)
    return f"{name}: {img.size}"

if __name__ == "__main__":
    for name in (sys.argv[1:] or ["pot", "ladle"]):
        print(cut(name))
