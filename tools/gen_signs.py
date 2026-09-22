#!/usr/bin/env python3
# The QR signs of the village: one clay sign prop per scene (a different object
# each time — signpost, straw bundle, lantern board, 청사초롱, shop board), with
# a BLANK cream panel that world.html fills at runtime with the QR code (drawn
# crisply from public/fx/qr_matrix.json) and a label in the page's own font.
#   gen_signs.py          render what is missing (tools/signs_src) + cut all + signs.json
#   gen_signs.py market   redo this one
# public/fx/sign_<scene>.png + public/fx/signs.json { scene: { w, h, panel: [x0,y0,x1,y1] } }
import base64, json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "signs_src")
OUT = os.path.join(ROOT, "public", "fx")
def env(key):
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m: return m.group(1)
KEY = env("GEMINI_API_KEY")
G = "https://generativelanguage.googleapis.com/v1beta"
STYLE = ("Adorable kawaii 3D prop sculpted from soft matte modelling clay, like a piece from a collectible vinyl toy "
         "diorama: chubby rounded volumes, smooth soft shading, gentle subsurface glow, soft studio lighting, warm autumn "
         "colors. The sign's PANEL is a completely BLANK, flat, plain, uniform cream-white rectangle, taller than it is "
         "wide (portrait), with absolutely nothing drawn or written on it, taking up most of the board's face. "
         "ONE object only, seen straight from the front, centered and filling most of the frame, isolated on a plain, "
         "flat, solid, saturated pure {BG} background with NO gradient, no floor, no shadow, no text.")
BACKDROP = {"moon": "GREEN (#00C800)"}  # (red top band, blue bottom band: neither may be the backdrop)
SIGNS = {
    "harvest": "a wooden signpost: a portrait blank cream board with a thick rounded light-wood frame, mounted on a single sturdy wooden post standing in a small tuft of golden rice-straw and grass, a tiny red maple leaf resting on one top corner",
    "field": "a portrait blank cream board with a thin wooden frame, tied with twine to the front of a small round bundle of golden rice straw (a little hay stack), with a tiny orange pumpkin sitting at its foot",
    "night": "a portrait blank cream board with a rounded top and a wooden frame on a short wooden post, a small softly glowing round paper lantern hanging from a little hook at the top corner, a tiny white moon rabbit sitting at the foot of the post",
    "moon": "a Korean cheongsachorong lantern-style sign: a portrait blank cream panel framed by a red silk band across the top and a blue silk band across the bottom, hanging from a curved dark-wood hook stand by a short cord, with a small red tassel at the bottom",
    "market": "a shop sign board of a Korean market stall: a portrait blank cream board with a dark-wood frame, hanging by two short ropes from a small wooden crossbar, a tiny red paper lantern hanging from one end of the crossbar",
}
def gen(name):
    os.makedirs(SRC, exist_ok=True)
    path = os.path.join(SRC, f"{name}.src.png")
    req = urllib.request.Request(f"{G}/models/gemini-2.5-flash-image:generateContent",
        data=json.dumps({"contents":[{"parts":[{"text": f"{SIGNS[name]}. {STYLE.replace('{BG}', BACKDROP.get(name, 'BLUE (#0038FF)'))}"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}).encode(),
        headers={"Content-Type":"application/json","x-goog-api-key":KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r: j = json.load(r)
            parts = j.get("candidates",[{}])[0].get("content",{}).get("parts",[])
            inline = next((p.get("inlineData") or p.get("inline_data") for p in parts if p.get("inlineData") or p.get("inline_data")), None)
            if inline:
                open(path,"wb").write(base64.b64decode(inline["data"])); return f"saved {name}"
            time.sleep(3)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(40); continue
            return f"ERR {name} {e.code}"
    return f"FAILED {name}"

def dilate(mask, px):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127
def erode(mask, px):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(px * 2 + 1))) > 127

def cut(name):
    rgb = np.asarray(Image.open(os.path.join(SRC, f"{name}.src.png")).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    # backdrop-like = close to the border colour, or the same HUE at any brightness (the vignette): the
    # backdrop's strong channels stay strong and its weak channels stay well below them
    hi = bg > 120
    strong = rgb[..., hi].min(axis=2) if hi.any() else np.zeros((h, w))
    weak = rgb[..., ~hi].max(axis=2) if (~hi).any() else np.zeros((h, w))
    keyed = (dist < 95) | ((strong > 150) & (weak < strong - 70))
    solid = ~dilate(keyed, 1)
    alpha = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 255
    # the rim (3 px in from the edge) carries the backdrop's spill: recolour it from the prop's own
    # interior — a blurred, interior-only average (normalised convolution), so a blue band stays blue
    # and a cream panel stays cream, whatever the backdrop was
    interior = erode(solid, 3)
    wgt = np.asarray(Image.fromarray((interior * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255
    inner = np.stack([np.asarray(Image.fromarray((rgb[..., c] * interior).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32) for c in range(3)], axis=2)
    local = inner / np.maximum(wgt, 1e-3)[..., None]
    edge = (solid & ~interior)[..., None]
    col = np.where(edge & (wgt[..., None] > 0.05), local, rgb)
    im = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8))
    box = im.getbbox(); im = im.crop(box)
    k = min(1, 720 / im.height); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(os.path.join(OUT, f"sign_{name}.png"), optimize=True)
    # the blank panel = the largest flat, bright, unsaturated region (eroded so the frame's highlights don't join)
    a = np.asarray(im).astype(np.float32); V = a[..., :3].max(axis=2); mn = a[..., :3].min(axis=2)
    pale = (a[..., 3] > 200) & (V > 185) & (V - mn < 45)
    core = erode(pale, 6)
    ys, xs = np.where(core)
    best, seen = None, np.zeros_like(core)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]: continue
        st, pts = [(y0, x0)], []
        seen[y0, x0] = True
        while st:
            y, x = st.pop(); pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < core.shape[0] and 0 <= xx < core.shape[1] and core[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; st.append((yy, xx))
        if best is None or len(pts) > len(best): best = pts
    py = [p[0] for p in best]; px = [p[1] for p in best]
    # the largest axis-aligned rectangle that is fully inside the blob: shrink the bbox until every row/column is ≥ 96% covered
    y0, y1, x0, x1 = min(py), max(py) + 1, min(px), max(px) + 1
    blob = np.zeros_like(core); blob[py, px] = True
    for _ in range(200):
        rows = blob[y0:y1, x0:x1].mean(axis=1); cols = blob[y0:y1, x0:x1].mean(axis=0)
        worst = min(rows[0], rows[-1], cols[0], cols[-1])
        if worst >= 0.96: break
        if rows[0] == worst: y0 += 1
        elif rows[-1] == worst: y1 -= 1
        elif cols[0] == worst: x0 += 1
        else: x1 -= 1
    pad = 4
    panel = [int(x0 + pad), int(y0 + pad), int(x1 - pad), int(y1 - pad)]
    return {"w": im.width, "h": im.height, "panel": panel}

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in SIGNS]
    for n in SIGNS:
        if n in names or not os.path.exists(os.path.join(SRC, f"{n}.src.png")):
            print(gen(n), flush=True)
    meta = {}
    for n in SIGNS:
        if os.path.exists(os.path.join(SRC, f"{n}.src.png")):
            meta[n] = cut(n); print("cut", n, meta[n], flush=True)
    json.dump(meta, open(os.path.join(OUT, "signs.json"), "w"))
