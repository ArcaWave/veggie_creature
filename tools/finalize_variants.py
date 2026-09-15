#!/usr/bin/env python3
# Turn the pre-generated Veo mp4s (variants-src/) into the runtime library
# (public/variants/): square-cropped, downscaled, white background knocked out,
# saved as looping transparent GIFs + the character stills + variants.json.
# Rerun any time — it rebuilds whatever sources exist.
#   animator/venv/bin/python tools/finalize_variants.py
import glob
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "variants-src")
DST = os.path.join(ROOT, "public", "variants")
os.makedirs(DST, exist_ok=True)

OUT_PX = 480
FRAME_SKIP = 3
FRAME_MS = 110  # ≈ real time for 24fps sources with every 3rd frame kept


def transparent(rgb: np.ndarray) -> Image.Image:
    near_white = (rgb > 238).all(axis=2)
    # Veo leaves a soft grey floor shadow around the feet, and it is the exact
    # colour of pale clay (cauliflower's cream body) — no colour threshold can
    # separate them. Geometry can: the shadow always lies BELOW the character.
    # Per column, find the lowest clearly-body pixel (colourful or dark); grey
    # bright pixels below that line (bottom 35% of the frame only) are floor.
    mx = rgb.max(axis=2).astype(int)
    mn = rgb.min(axis=2).astype(int)
    sat = mx - mn
    h = rgb.shape[0]
    body = (sat >= 35) | (mx < 170)
    foot = np.where(body.any(axis=0), h - 1 - np.argmax(body[::-1], axis=0), -1)
    rows = np.arange(h)[:, None]
    # strictly below the anchor: floor by definition, cut regardless of colour;
    # beside the feet (a foot-height band above): cut only grey-bright pixels.
    below = rows > foot[None, :]
    beside = (rows > (foot[None, :] - h // 16)) & (sat < 26) & (mx > 175)
    shadowish = (below | beside) & (rows > int(h * 0.65))
    cut = near_white | shadowish
    rgba = np.dstack([rgb, np.where(cut, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def mp4_to_gif(src: str, dst: str) -> None:
    cap = cv2.VideoCapture(src)
    frames = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % FRAME_SKIP == 0:
            h, w = f.shape[:2]
            side = min(h, w)
            f = f[(h - side) // 2:(h + side) // 2, (w - side) // 2:(w + side) // 2]
            f = cv2.resize(f, (OUT_PX, OUT_PX), interpolation=cv2.INTER_AREA)
            frames.append(transparent(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
        i += 1
    cap.release()
    if not frames:
        return print(f"  !! no frames in {os.path.basename(src)}")
    frames[0].save(dst, save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, disposal=2)
    print(f"  {os.path.basename(dst)}: {len(frames)} frames, {os.path.getsize(dst)//1024}KB")


KINDS = ["greet", "smile", "bow", "spin", "dance"]  # greet+smile required, rest optional

variants = []
kinds_by_variant = {}
for png in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    vid = os.path.splitext(os.path.basename(png))[0]
    if vid == "grid":
        continue
    print(f"[{vid}]")
    # still image for the certificate / booth (transparent too, downscaled)
    im = cv2.imread(png)
    im = cv2.resize(im, (512, 512), interpolation=cv2.INTER_AREA)
    transparent(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)).save(os.path.join(DST, f"{vid}.png"))
    have = []
    for kind in KINDS:
        mp4 = os.path.join(SRC, f"{vid}.{kind}.mp4")
        gif = os.path.join(DST, f"{vid}.{kind}.gif")
        if os.path.exists(mp4):
            if not os.path.exists(gif) or os.path.getmtime(gif) < os.path.getmtime(mp4):
                mp4_to_gif(mp4, gif)
            else:
                print(f"  {os.path.basename(gif)}: up to date")
            have.append(kind)
        elif kind in ("greet", "smile"):
            print(f"  (missing {vid}.{kind}.mp4 — run pregen first)")
    if "greet" in have and "smile" in have:
        variants.append(vid)
        kinds_by_variant[vid] = have

with open(os.path.join(DST, "variants.json"), "w") as f:
    json.dump({"variants": variants, "kinds": kinds_by_variant}, f)
print("ready:", {v: kinds_by_variant[v] for v in variants})
