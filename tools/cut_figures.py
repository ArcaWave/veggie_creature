#!/usr/bin/env python3
# Knock the white background out of the full-figure renders (public/parts/
# fig_*.src.png), trim, downscale, and write public/parts/figures.json —
# the catalog world3d.html reads ({ "carrot_twig_carrot": {"aspect": w/h} }).
# Rerun any time; already-cut figures are kept and re-indexed.
import glob
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, "public", "parts")


def cut(src: str) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    strict = "cauliflower" in src
    if strict:
        bgish = ((mn > 238) & ((mx.astype(int) - mn.astype(int)) < 10)).astype(np.uint8)
    else:
        bgish = ((mn > 215) & ((mx.astype(int) - mn.astype(int)) < 26)).astype(np.uint8)
    # background = bright, grey-ish region connected to the image border
    _, lab = cv2.connectedComponents(bgish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    bg = np.isin(lab, list(border - {0}))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    if not strict:
        alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    im = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    im = im.crop(im.getbbox())
    im.thumbnail((900, 900), Image.LANCZOS)
    im.save(src.replace(".src.png", ".png"))
    os.remove(src)
    print(os.path.basename(src), im.size)


for src in sorted(glob.glob(os.path.join(PARTS, "fig_*.src.png"))):
    cut(src)

catalog = {}
for png in sorted(glob.glob(os.path.join(PARTS, "fig_*.png"))):
    key = os.path.basename(png)[4:-4]
    w, h = Image.open(png).size
    catalog[key] = {"aspect": round(w / h, 4)}
with open(os.path.join(PARTS, "figures.json"), "w") as f:
    json.dump(catalog, f)
print("figures:", len(catalog))
