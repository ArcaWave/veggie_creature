#!/usr/bin/env python3
# Knock the white studio background out of the full-figure renders
# (tools/figs_src/fig_*.src.png — kept, git-ignored) and write public/parts/
# fig_*.png + figures.json, the catalog the wall and the scan station read
# ({ "tomato_twig_carrot": {"aspect": w/h, "hatY": socket} }). Rebuilds
# everything from the sources each run (a few minutes). PIL + numpy only.
#
# What "background" turned out to mean, all of it handled here:
#   1. the white around the figure            -> flood in from the border
#   2. white mixed into the soft edge pixels  -> un-mixed (no pale halo on the wall)
#   3. white trapped INSIDE the silhouette    -> pockets (between legs / arm and
#      body / inside a curly pumpkin stem); eye glints are told apart by the
#      black around them
#   4. the floor shadow under the feet        -> pale, low-saturation pixels below
#      the body that connect to the outside (it is tinted by the feet, so "grey"
#      is not enough — saturation is what separates it from brown/green/orange)
#   5. stray specks far from the figure       -> only the one connected piece stays
# tools/audit_cutouts.py re-checks the shipped PNGs for all of the above.
import glob
import json
import os

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, "public", "parts")
SRC = os.path.join(ROOT, "tools", "figs_src")
# pale vegetables wash out to cream under the wall's lights: (saturation, brightness)
GRADE = {"pumpkin": (1.45, 0.9), "onion": (1.35, 0.9)}
# how far a hat sinks onto each vegetable (fraction of the figure's height)
SINK = {"pumpkin": 0.035, "corn": 0.0, "sweetpotato": 0.05, "tomato": 0.05, "onion": 0.03}


def dilate(mask: np.ndarray, px: int) -> np.ndarray:
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127


def erode(mask: np.ndarray, px: int) -> np.ndarray:
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(px * 2 + 1))) > 127


def spread(seed: np.ndarray, through: np.ndarray, step: int = 1) -> np.ndarray:
    """everything in `through` connected to `seed` (grown `step` px at a time)"""
    reach = seed & through
    while True:
        g = dilate(reach, step) & through
        if (g == reach).all():
            return reach
        reach = g


def blobs(mask: np.ndarray):
    """connected blobs of a SPARSE mask, as lists of (y, x)"""
    seen = np.zeros_like(mask)
    h, w = mask.shape
    for y0, x0 in zip(*np.where(mask)):
        if seen[y0, x0]:
            continue
        stack, pts = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        yield pts


def cut(src: str) -> dict:
    name = os.path.basename(src).replace(".src.png", "")
    body = name[4:].split("_")[0]
    rgb = np.array(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    V, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = (V - mn) / np.maximum(V, 1)
    edge = np.zeros((h, w), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True

    # 1) the studio white, in from the border
    gone = spread(edge, (mn > 215) & (V - mn < 26))

    # 3) white pockets inside the silhouette (flat, pure white — a highlight on a
    #    tomato is neither), unless they sit in an eye
    for pts in blobs((mn > 236) & (V - mn < 12) & ~gone):
        if len(pts) < 40:
            continue
        ys, xs = [p[0] for p in pts], [p[1] for p in pts]
        around = V[max(0, min(ys) - 5) : max(ys) + 6, max(0, min(xs) - 5) : max(xs) + 6]
        if (around < 70).mean() < 0.25:
            for y, x in pts:
                gone[y, x] = True
    gone = dilate(gone, 1)

    # 4) the floor shadow: below the body, pale & unsaturated (or plain grey),
    #    and connected to what is already gone
    figure_rows = np.where((~gone).any(axis=1))[0]
    top, bottom = figure_rows.min(), figure_rows.max()
    below_body = np.zeros((h, w), bool)
    below_body[int(top + (bottom - top) * 0.70) :] = True
    floorish = below_body & (((sat < 0.40) & (V > 110)) | (sat < 0.22))
    gone |= spread(dilate(gone, 2), floorish | gone, 2) & (floorish | gone)
    gone = dilate(gone, 1)

    # 5) one connected piece, grown from the middle of the body
    solid = ~gone
    cy, cx = int(top + (bottom - top) * 0.45), w // 2
    seed = np.zeros((h, w), bool)
    seed[cy - 8 : cy + 8, cx - 8 : cx + 8] = True
    solid = spread(seed, solid, 4)

    # 2) soft edge, with the white un-mixed from it
    alpha = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.9))).astype(np.float32) / 255
    a3 = np.clip(alpha, 0.2, 1)[..., None]
    rim = (alpha < 0.98)[..., None]
    rgb = np.where(rim, np.clip((rgb - (1 - a3) * 255) / a3, 0, 255), rgb)

    look = Image.fromarray(rgb.astype(np.uint8))
    if body in GRADE:
        look = ImageEnhance.Brightness(ImageEnhance.Color(look).enhance(GRADE[body][0])).enhance(GRADE[body][1])
    im = Image.fromarray(np.dstack([np.asarray(look), (alpha * 255).astype(np.uint8)]))
    im = im.crop(im.getbbox())
    im.thumbnail((900, 900), Image.LANCZOS)
    im.save(os.path.join(PARTS, name + ".png"))

    # where a hat sits: the top of the head proper — the first row wider than 30%
    # of the head, which skips thin stems and tips — plus the vegetable's sink
    width = (np.asarray(im)[..., 3] > 128).sum(axis=1)
    head = width[: int(len(width) * 0.4)].max()
    socket = int(np.argmax(width > 0.30 * head)) / len(width) + SINK.get(body, 0.04)
    print(name, im.size)
    return {"aspect": round(im.width / im.height, 4), "hatY": round(socket, 4)}


if __name__ == "__main__":
    catalog = {}
    for src in sorted(glob.glob(os.path.join(SRC, "fig_*.src.png"))):
        catalog[os.path.basename(src)[4:-8]] = cut(src)
    with open(os.path.join(PARTS, "figures.json"), "w") as f:
        json.dump(catalog, f)
    print("figures:", len(catalog))
