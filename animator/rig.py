# Geometric auto-rig for Gemini-generated full-body clay characters.
#
# The clay prompt guarantees a standing, front-facing A-pose on a white
# background, so no ML is needed: the mask's geometry tells us where the limbs
# are. If the expected extremities are missing (e.g. Gemini ignored the pose
# instructions) build_character raises RigError and the caller falls back.
import os

import cv2
import numpy as np
import yaml

# Working resolution for texture/mask/joints. This also drives how dense the
# AnimatedDrawings deformation mesh gets — 800px made big characters take 3-5x
# longer to solve per frame; 500px renders fast and the final gif is 480px anyway.
SIZE = 500


class RigError(Exception):
    pass


def _mask_from_white_bg(img: np.ndarray) -> np.ndarray:
    """Character mask: flood-fill the near-white background in from the borders.
    FIXED_RANGE keeps the fill from creeping across anti-aliased edges."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    flood = gray.copy()
    ffmask = np.zeros((SIZE + 2, SIZE + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_FIXED_RANGE
    seeds = [(0, 0), (SIZE - 1, 0), (0, SIZE - 1), (SIZE - 1, SIZE - 1),
             (SIZE // 2, 0), (0, SIZE // 2), (SIZE - 1, SIZE // 2)]
    for seed in seeds:
        if flood[seed[1], seed[0]] > 200:
            cv2.floodFill(flood, ffmask, seed, 0, loDiff=35, upDiff=35, flags=flags)
    mask = (flood > 0).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if n <= 1:
        raise RigError("no character found in image")
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = ((labels == biggest) * 255).astype(np.uint8)
    if not 0.05 < mask.mean() / 255 < 0.75:
        raise RigError(f"implausible mask coverage {mask.mean() / 255:.2f}")
    return mask


def _skeleton_from_mask(mask: np.ndarray) -> list:
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0, y1 - y0
    if bw < SIZE * 0.2 or bh < SIZE * 0.3:
        raise RigError("character too small in frame")
    cx = (x0 + x1) / 2

    # --- arms: left/rightmost mask points in the vertical mid-band
    band = mask[int(y0 + 0.30 * bh):int(y0 + 0.80 * bh), :]
    bys, bxs = np.nonzero(band)
    if len(bxs) == 0:
        raise RigError("empty arm band")
    ry0 = int(y0 + 0.30 * bh)
    li = int(np.argmin(bxs))  # viewer-left tip  -> character's RIGHT hand
    ri = int(np.argmax(bxs))
    r_hand = (float(bxs[li]) + 6, float(bys[li] + ry0))
    l_hand = (float(bxs[ri]) - 6, float(bys[ri] + ry0))
    # arms must stick out beyond the torso for the rig to make sense
    if (cx - r_hand[0]) < 0.30 * bw / 2 or (l_hand[0] - cx) < 0.30 * bw / 2:
        raise RigError("arms not clearly extended")

    torso_pt = (cx, y0 + 0.52 * bh)
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    r_elbow = lerp(r_hand, torso_pt, 0.33)
    r_shoulder = lerp(r_hand, torso_pt, 0.62)
    l_elbow = lerp(l_hand, torso_pt, 0.33)
    l_shoulder = lerp(l_hand, torso_pt, 0.62)

    # --- legs: per-side centroids of the bottom rows
    foot_band = mask[int(y1 - 0.06 * bh):y1 + 1, :]
    fys, fxs = np.nonzero(foot_band)
    left_side = fxs[fxs < cx]
    right_side = fxs[fxs >= cx]
    r_foot_x = float(np.median(left_side)) if len(left_side) else cx - 0.12 * bw
    l_foot_x = float(np.median(right_side)) if len(right_side) else cx + 0.12 * bw
    foot_y = float(y1 - 4)

    root = (cx, y0 + 0.80 * bh)
    J = lambda p: [int(round(p[0])), int(round(p[1]))]
    return [
        {"name": "root", "parent": None, "loc": J(root)},
        {"name": "hip", "parent": "root", "loc": J(root)},
        {"name": "torso", "parent": "hip", "loc": J(torso_pt)},
        {"name": "neck", "parent": "torso", "loc": J((cx, y0 + 0.30 * bh))},
        {"name": "right_shoulder", "parent": "torso", "loc": J(r_shoulder)},
        {"name": "right_elbow", "parent": "right_shoulder", "loc": J(r_elbow)},
        {"name": "right_hand", "parent": "right_elbow", "loc": J(r_hand)},
        {"name": "left_shoulder", "parent": "torso", "loc": J(l_shoulder)},
        {"name": "left_elbow", "parent": "left_shoulder", "loc": J(l_elbow)},
        {"name": "left_hand", "parent": "left_elbow", "loc": J(l_hand)},
        {"name": "right_hip", "parent": "root", "loc": J((r_foot_x, root[1] + 0.02 * bh))},
        {"name": "right_knee", "parent": "right_hip", "loc": J((r_foot_x, root[1] + 0.5 * (foot_y - root[1])))},
        {"name": "right_foot", "parent": "right_knee", "loc": J((r_foot_x, foot_y))},
        {"name": "left_hip", "parent": "root", "loc": J((l_foot_x, root[1] + 0.02 * bh))},
        {"name": "left_knee", "parent": "left_hip", "loc": J((l_foot_x, root[1] + 0.5 * (foot_y - root[1])))},
        {"name": "left_foot", "parent": "left_knee", "loc": J((l_foot_x, foot_y))},
    ]


# The deformation mesh AnimatedDrawings builds scales with the character's pixel
# AREA, and its (pure-python) rig binding blows up on big blobs — a character
# that fills the frame took 10x longer than a small one. Normalising every
# character to the same on-canvas size makes render time flat and predictable.
CHAR_BOX = 340  # longest character side after normalisation, inside the canvas


def build_character(img_bgr: np.ndarray, out_dir: str) -> None:
    """Write texture.png / mask.png / char_cfg.yaml for AnimatedDrawings."""
    os.makedirs(out_dir, exist_ok=True)
    img = cv2.resize(img_bgr, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    mask = _mask_from_white_bg(img)

    # crop to the character, scale to a fixed box, re-centre on a clean canvas
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 6
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(SIZE - 1, x1 + pad), min(SIZE - 1, y1 + pad)
    crop_img = img[y0:y1 + 1, x0:x1 + 1]
    crop_mask = mask[y0:y1 + 1, x0:x1 + 1]
    ch, cw = crop_mask.shape
    scale = CHAR_BOX / max(ch, cw)
    nw, nh = max(2, int(cw * scale)), max(2, int(ch * scale))
    crop_img = cv2.resize(crop_img, (nw, nh), interpolation=cv2.INTER_AREA)
    crop_mask = cv2.resize(crop_mask, (nw, nh), interpolation=cv2.INTER_NEAREST)

    canvas = np.full((SIZE, SIZE, 3), 255, np.uint8)
    canvas_mask = np.zeros((SIZE, SIZE), np.uint8)
    ox, oy = (SIZE - nw) // 2, (SIZE - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = crop_img
    canvas_mask[oy:oy + nh, ox:ox + nw] = crop_mask

    skeleton = _skeleton_from_mask(canvas_mask)
    cv2.imwrite(os.path.join(out_dir, "texture.png"), canvas)
    cv2.imwrite(os.path.join(out_dir, "mask.png"), canvas_mask)
    with open(os.path.join(out_dir, "char_cfg.yaml"), "w") as f:
        yaml.dump({"width": SIZE, "height": SIZE, "skeleton": skeleton}, f)
