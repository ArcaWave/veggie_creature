#!/usr/bin/env python3
# Backdrop 5 ("가을 장터", the hanok market at sunset) for the 3D village:
#   - cleans the dark rounded corners the source image came with,
#   - lifts its two clouds out of the sky (sprites) and repaints the sky
#     behind them, so they can drift,
#   - copies three of its clay maple leaves off the sand (sprites) for the
#     leaves that fall from its trees. (The ground leaves stay where they are.)
# PIL + numpy only.  usage: fx_market.py <source.png>
import os, sys
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, "public", "fx")

def polyfit2d(img, keep):
    """quadratic surface per channel through the `keep` pixels → full-size model"""
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x = xx / w - 0.5; y = yy / h - 0.5
    A = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)
    out = np.empty_like(img)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A[keep], img[..., c][keep], rcond=None)
        out[..., c] = A @ coef
    return out

def blur(mask, r):
    return np.asarray(Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255

def grow(mask, px):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127

def largest_blob(mask, seed):
    """the connected region of `mask` containing (or nearest to) the seed"""
    ys, xs = np.where(mask)
    i = np.argmin((ys - seed[1]) ** 2 + (xs - seed[0]) ** 2)
    blob = np.zeros_like(mask); blob[ys[i], xs[i]] = True
    while True:
        g = blob.copy()
        g[1:] |= blob[:-1]; g[:-1] |= blob[1:]; g[:, 1:] |= blob[:, :-1]; g[:, :-1] |= blob[:, 1:]
        g &= mask
        if (g == blob).all(): return blob
        blob = g

def save_sprite(rgb, alpha, path):
    ys, xs = np.where(alpha > 0.03)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)[y0:y1, x0:x1]
    Image.fromarray(out).save(path, optimize=True)
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0

def diffuse(reg, hole, iters=1500):
    """harmonic fill: the hole relaxes to the average of its neighbours, so it
    meets its surroundings seamlessly on every side (smooth sky, sand, wall)"""
    out = reg.copy()
    ring = grow(hole, 3) & ~hole
    out[hole] = reg[ring].mean(axis=0) if ring.any() else reg.mean(axis=(0, 1))
    for _ in range(iters):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode="edge")    # (edge-replicated: nothing wraps round)
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        out[hole] = avg[hole]
    return out

def despeckle(mask, px):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.MinFilter(px * 2 + 1)).filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127

def main(src):
    img = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = img.shape

    # 1) the rounded corners the source came with: the neutral-dark area
    #    connected to each corner pixel (+ its antialiased rim) is painted over
    n = 64
    for ys, xs, seed in [(slice(0, n), slice(0, n), (0, 0)), (slice(0, n), slice(W - n, W), (n - 1, 0)), (slice(H - n, H), slice(0, n), (0, n - 1)), (slice(H - n, H), slice(W - n, W), (n - 1, n - 1))]:
        reg = img[ys, xs]
        dark = (reg.max(axis=2) - reg.min(axis=2) < 24) & (reg.max(axis=2) < 105)
        if not dark[seed[1], seed[0]]: continue
        hole = grow(largest_blob(dark, seed), 3)
        img[ys, xs] = diffuse(reg, hole, 400)

    # 2) clouds: matte against the sky that diffusion paints behind them
    report = {}
    rng = np.random.default_rng(5)
    for name, (x0, y0, x1, y1) in {"market_cloud1": (475, 80, 725, 245), "market_cloud2": (1185, 0, 1440, 150)}.items():
        reg = img[y0:y1, x0:x1]
        sat = (reg.max(axis=2) - reg.min(axis=2)) / np.maximum(reg.max(axis=2), 1)
        edge = np.ones(reg.shape[:2], bool); edge[14:-14, 14:-14] = False
        skyish = polyfit2d(reg.astype(np.float64), edge & (sat < 0.55))   # first guess, from the region's rim (minus any treetop)
        # the cloud = whatever differs from that sky: its white top AND its dusky underside
        core = despeckle((np.abs(reg - skyish).max(axis=2) > 13) & ~edge & (sat < 0.72), 2)
        hole = grow(core, 28)                                        # …plus the soft glow around it
        hole[:2] = hole[-2:] = False; hole[:, :2] = hole[:, -2:] = False
        hole &= ~grow(sat > 0.72, 2)                                 # never paint over a treetop (the cloud's dusky underside is ~0.6)
        sky = diffuse(reg, hole)
        d = (reg - sky)[..., 2]
        alpha = np.clip((d - 4) / (np.percentile(d[core & (d > 10)], 60) * 0.8), 0, 1) * blur(grow(core, 8), 4)
        alpha = blur(alpha, 0.8)
        a3 = np.clip(alpha, 0.04, 1)[..., None]
        cx, cy, w, h = save_sprite((reg - (1 - a3) * sky) / a3, alpha, os.path.join(FX, f"{name}.png"))
        report[name] = (round(x0 + cx), round(y0 + cy), int(w), int(h))
        img[y0:y1, x0:x1] = np.where(hole[..., None], sky + rng.normal(0, 0.7, reg.shape), reg)

    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(ROOT, "public", "world3d-market.png"), optimize=True)

    # 3) leaves, copied off the sand. The sand in a leaf's shadow is as
    #    saturated as the leaf, so: the red one by hue, the bright ones by value.
    V = lambda r: r.max(axis=2)
    S = lambda r: (r.max(axis=2) - r.min(axis=2)) / np.maximum(r.max(axis=2), 1)
    rules = {
        "market_leaf1": ((205, 755, 320, 840), lambda r: (r[..., 1] / np.maximum(r[..., 0], 1) < 0.47) & (S(r) > 0.6)),
        "market_leaf2": ((290, 738, 392, 800), lambda r: (S(r) > 0.72) & (r[..., 1] / np.maximum(r[..., 0], 1) < 0.62)),
        "market_leaf3": ((380, 800, 500, 885), lambda r: (S(r) > 0.72) & (V(r) > 222)),
    }
    for name, ((x0, y0, x1, y1), rule) in rules.items():
        reg = img[y0:y1, x0:x1]
        blob = largest_blob(rule(reg), ((x1 - x0) // 2, (y1 - y0) // 2))
        blob = ~largest_blob(~np.pad(blob, 1), (0, 0))[1:-1, 1:-1]   # close pin-holes
        alpha = np.clip((blur(blob.astype(np.float32), 0.9) - 0.45) / 0.45, 0, 1)
        cx, cy, w, h = save_sprite(reg, alpha, os.path.join(FX, f"{name}.png"))
        report[name] = (round(x0 + cx), round(y0 + cy), int(w), int(h))
    for k, v in report.items(): print(k, v)

if __name__ == "__main__":
    main(sys.argv[1])
