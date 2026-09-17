#!/usr/bin/env python3
# Knock the white background out of the full-figure renders (tools/figs_src/
# fig_*.src.png — kept, git-ignored), clean them up, and write public/parts/
# fig_*.png + figures.json, the catalog the wall and the scan station read
# ({ "tomato_twig_carrot": {"aspect": w/h, "hatY": socket} }). Rebuilds
# everything from the sources each run (a couple of minutes).
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


def border_flood(mask: np.ndarray) -> np.ndarray:
    """the part of `mask` connected to the image border (numpy only — no cv2)"""
    bg = np.zeros_like(mask)
    bg[0, :] = mask[0, :]; bg[-1, :] = mask[-1, :]; bg[:, 0] = mask[:, 0]; bg[:, -1] = mask[:, -1]
    while True:
        g = bg.copy()
        g[1:] |= bg[:-1]; g[:-1] |= bg[1:]; g[:, 1:] |= bg[:, :-1]; g[:, :-1] |= bg[:, 1:]
        g &= mask
        if (g == bg).all():
            return bg
        bg = g


def cut(src: str) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    mn = rgb.min(axis=2).astype(int)
    mx = rgb.max(axis=2).astype(int)
    # background = bright, grey-ish region connected to the image border
    bg = border_flood((mn > 215) & (mx - mn < 26))
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    body = os.path.basename(src)[4:].split("_")[0]
    look = Image.fromarray(rgb)
    if body in GRADE:
        look = ImageEnhance.Brightness(ImageEnhance.Color(look).enhance(GRADE[body][0])).enhance(GRADE[body][1])
    im = Image.fromarray(np.dstack([np.asarray(look), np.asarray(alpha)]))
    im = im.crop(im.getbbox())
    im.thumbnail((900, 900), Image.LANCZOS)
    im.save(os.path.join(PARTS, os.path.basename(src).replace(".src.png", ".png")))
    print(os.path.basename(src), im.size)


def clear_pockets(png: str) -> None:
    """white studio background trapped BETWEEN THE LEGS isn't connected to the
    border, so the flood misses it: down there nothing else is pure white, so
    any white pocket at least 5px wide goes. Idempotent."""
    im = Image.open(png).convert("RGBA")
    a = np.array(im)
    rgb = a[..., :3].astype(int)
    white = (rgb.min(axis=2) > 228) & (rgb.max(axis=2) - rgb.min(axis=2) < 16) & (a[..., 3] > 0)
    white[: int(a.shape[0] * 0.68)] = False
    core = Image.fromarray((white * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(11))
    pocket = (np.asarray(core) > 127) & ((rgb.min(axis=2) > 200) & (a[..., 3] > 0))
    if pocket.sum() < 20:
        return
    alpha = np.where(pocket, 0, a[..., 3]).astype(np.uint8)
    a[..., 3] = np.minimum(a[..., 3], np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.7))))
    a[..., 3][pocket] = 0
    Image.fromarray(a).save(png)
    print("pocket cleared:", os.path.basename(png), int(pocket.sum()), "px")


def clear_floor(png: str) -> None:
    """the studio floor shadow under the feet: a pale NEUTRAL smudge, while the
    feet themselves are brown / green / orange — so down at foot level every
    bright grey pixel goes (the wall casts its own shadows). Idempotent."""
    a = np.array(Image.open(png).convert("RGBA"))
    rgb = a[..., :3].astype(int)
    grey = (rgb.max(axis=2) - rgb.min(axis=2) < 30) & (rgb.min(axis=2) > 120) & (a[..., 3] > 0)
    grey[: int(a.shape[0] * 0.8)] = False
    if grey.sum() < 40:
        return
    grey = np.asarray(Image.fromarray((grey * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 127
    grey[: int(a.shape[0] * 0.8)] = False
    a[..., 3] = np.where(grey, 0, a[..., 3])
    # what's left must still be attached to the figure: drop thin leftovers
    solid = np.asarray(Image.fromarray(((a[..., 3] > 128) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(13))) > 127
    a[..., 3][~solid] = 0
    im = Image.fromarray(a)
    im.crop(im.getbbox()).save(png)
    print("floor cleared:", os.path.basename(png), int(grey.sum()), "px")


def drop_specks(png: str) -> None:
    """stray bits of background that survived far from the figure stretch its
    bounding box (and so shrink the character on the wall). A figure is ONE
    connected piece: grow out from its centre through the opaque pixels and
    drop whatever was never reached. Idempotent."""
    im = Image.open(png).convert("RGBA")
    a = np.array(im)
    opaque = a[..., 3] > 40
    h, w = opaque.shape
    reach = np.zeros_like(opaque)
    reach[h // 2 - 5 : h // 2 + 5, w // 2 - 5 : w // 2 + 5] = True
    reach &= opaque
    while True:  # 9px steps: fast, and still can't jump a gap wider than 4px
        g = (np.asarray(Image.fromarray((reach * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 127) & opaque
        if (g == reach).all():
            break
        reach = g
    if (opaque & ~reach).sum() == 0:
        return
    a[..., 3][~reach] = 0
    out = Image.fromarray(a)
    out = out.crop(out.getbbox())
    out.save(png)
    print("specks dropped:", os.path.basename(png), im.size, "->", out.size)


for src in sorted(glob.glob(os.path.join(SRC, "fig_*.src.png"))):
    cut(src)
for png in sorted(glob.glob(os.path.join(PARTS, "fig_*.png"))):
    clear_pockets(png)
    clear_floor(png)
    drop_specks(png)

# where a hat sits, per figure (fraction of the figure's height from its top):
# the top of the head proper — the first row wider than 30% of the head, which
# skips thin stems and tips — plus how far a hat sinks onto that vegetable
SINK = {"pumpkin": 0.035, "corn": 0.0, "sweetpotato": 0.05, "tomato": 0.05, "onion": 0.03}


def hat_socket(png: str, body: str) -> float:
    a = np.asarray(Image.open(png).convert("RGBA"))[..., 3] > 128
    width = a.sum(axis=1)
    head = width[: int(len(width) * 0.4)].max()
    top = int(np.argmax(width > 0.30 * head))
    return round(top / len(width) + SINK.get(body, 0.04), 4)


catalog = {}
for png in sorted(glob.glob(os.path.join(PARTS, "fig_*.png"))):
    key = os.path.basename(png)[4:-4]
    w, h = Image.open(png).size
    catalog[key] = {"aspect": round(w / h, 4), "hatY": hat_socket(png, key.split("_")[0])}
with open(os.path.join(PARTS, "figures.json"), "w") as f:
    json.dump(catalog, f)
print("figures:", len(catalog))
