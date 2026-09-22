#!/usr/bin/env python3
# The QR CARRIERS of the village: in each scene, something that belongs there
# drifts across the sky carrying the QR code — a shield kite over the harvest
# field, a small hot-air balloon over the autumn field, a flying saucer with a
# moon rabbit over the moon village, a sky lantern in the full-moon yard, a bunch
# of balloons over the market. Each has a BLANK cream panel that world.html fills
# at runtime with the QR (drawn crisply from public/fx/qr_matrix.json, multiplied
# in so it reads as printed) and a small label. Rendered on a coloured backdrop
# that none of the prop's own colours share, and cut here.
#   gen_carriers.py            render what is missing (tools/carriers_src) + cut all + carriers.json
#   gen_carriers.py kite ufo   redo these
# public/fx/carrier_<name>.png + public/fx/carriers.json { name: { w, h, panel: [x0,y0,x1,y1] } }
import base64, json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "carriers_src")
OUT = os.path.join(ROOT, "public", "fx")
def env(key):
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m: return m.group(1)
KEY = env("GEMINI_API_KEY")
G = "https://generativelanguage.googleapis.com/v1beta"
STYLE = ("Adorable kawaii 3D prop sculpted from soft matte modelling clay, like a piece from a collectible vinyl toy "
         "diorama: chubby rounded volumes, smooth soft shading, gentle subsurface glow, soft studio lighting. Its PANEL "
         "is a completely BLANK, flat, plain, uniform cream-white paper rectangle with absolutely nothing drawn or "
         "written on it. ONE object only, seen straight from the front, centered and filling most of the frame, "
         "isolated on a plain, flat, solid, saturated pure {BG} background with NO gradient, no ground, no shadow, no text.")
SIGNS = {
    "kite": "a Korean bangpae-yeon shield kite: an upright rectangular kite (a little taller than wide) of blank cream paper "
            "stretched on a thin bamboo frame, the paper face completely blank, with small red and yellow paper tassels at "
            "its top corners and a long wavy ribbon tail of red, yellow and green streamers hanging below, a thin string "
            "trailing from its middle",
    "balloon": "a small chubby hot-air balloon: an envelope in warm vertical stripes of orange, cream and mustard yellow, "
               "thin ropes down to a little wicker basket, and hanging level right below the basket a WIDE wooden sign "
               "board, as wide as the balloon itself, with a rounded light-wood frame and a blank cream paper panel that is "
               "wider than tall",
    "ufo": "a cute chubby flying saucer: a pale cream clay saucer with a warm orange rim band and soft yellow underside "
           "lights, and a clear glass dome on top with a tiny white moon rabbit pilot peeking out; hanging level below "
           "the saucer from two short thin rods a WIDE sign board, as wide as the saucer itself, with a rounded "
           "light-wood frame and a blank cream paper panel that is wider than tall",
    "lantern": "a Korean sky lantern (a tall paper wish lantern): a tall rounded rectangular paper lantern glowing softly "
               "warm from inside, its front face a blank cream paper panel, a thin bamboo ring and a small warm flame at "
               "the bottom opening, a tiny red tassel hanging under it",
    "balloons": "a bunch of five chubby glossy clay party balloons (red, orange, yellow, pink and mint green) tied together, "
                "their strings tied to a WIDE wooden sign board, as wide as the bunch of balloons, with a rounded "
                "light-wood frame and a blank cream paper panel that is wider than tall, hanging level below them",
}
BACKDROP = {}  # all on the saturated pure blue: the props' own colours stay clear of it (no blue tassels or balloons)
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
    # backdrop = what is close to the border colour AND reachable from the border. Colour alone is not
    # enough: the backdrop's light bounces onto the birds (green-tinted feathers are within the colour
    # tolerance), and those pixels are inside the prop — not connected to the outside.
    near = dist < 80
    keyed = np.zeros((h, w), bool); keyed[0, :] = keyed[-1, :] = keyed[:, 0] = keyed[:, -1] = True; keyed &= near
    while True:
        g = dilate(keyed, 2) & near
        if (g == keyed).all(): break
        keyed = g
    # …plus enclosed pockets of backdrop (between the ropes, under the cloud): any blob of the backdrop colour
    # that is more than a speck (a speck could be bounce light on the prop; a pocket is hundreds of pixels)
    left = near & ~keyed
    seen = np.zeros_like(left)
    for y0, x0 in zip(*np.where(left)):
        if seen[y0, x0]: continue
        st, pts = [(y0, x0)], []
        seen[y0, x0] = True
        while st:
            y, x = st.pop(); pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and left[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; st.append((yy, xx))
        if len(pts) >= 150:
            for y, x in pts: keyed[y, x] = True
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
    # despill: the backdrop's own hue bounced onto the prop (a green cast on white bellies) is pulled back
    hi = bg > 120
    if hi.sum() == 1:
        ch = int(np.argmax(hi)); others = np.max(col[..., [i for i in range(3) if i != ch]], axis=2)
        col[..., ch] = np.where(col[..., ch] > others, others + (col[..., ch] - others) * 0.3, col[..., ch])
    im = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8))
    box = im.getbbox(); im = im.crop(box)
    k = min(1, 900 / max(im.size)); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(os.path.join(OUT, f"carrier_{name}.png"), optimize=True)
    # the blank panel = the largest flat, bright, unsaturated region (eroded so the frame's highlights don't join)
    a = np.asarray(im).astype(np.float32); V = a[..., :3].max(axis=2); mn = a[..., :3].min(axis=2)
    R, B = a[..., 0], a[..., 2]
    pale = (a[..., 3] > 200) & (V > 185) & (V - mn < 45) & (R >= B - 2)   # cream paper (warm), not sky-lit white
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
    json.dump(meta, open(os.path.join(OUT, "carriers.json"), "w"))
