#!/usr/bin/env python3
# The village's EMOTES: what pops out over a creature's head instead of words.
# System emoji looked generic next to the clay world, so these are the world's
# own — kawaii clay 3D icons with a Chuseok flavour, rendered on a saturated
# BLUE backdrop (several of them are white: rice cakes, the moon rabbit — a
# white studio could not be keyed out) and cut here.
#   gen_emotes.py            render what is missing (tools/emotes_src) + cut all
#   gen_emotes.py star note  redo these
# Output: public/fx/emote_<name>.png
import base64, json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "emotes_src")
OUT = os.path.join(ROOT, "public", "fx")
def env(key):
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m: return m.group(1)
KEY = env("GEMINI_API_KEY")
G = "https://generativelanguage.googleapis.com/v1beta"
STYLE = ("Adorable kawaii 3D icon sculpted from soft matte modelling clay, like a collectible vinyl toy charm: very chubby, "
         "puffy rounded volumes, smooth soft shading, gentle subsurface glow, soft studio lighting, saturated cheerful colors. "
         "Where it has a face: tiny glossy black button eyes set wide apart, rosy blush cheeks, a tiny smile. "
         "ONE icon only, seen from the front, centered and filling most of the frame, isolated on a plain, flat, solid, "
         "saturated pure BLUE background (#0038FF) with NO gradient, no floor, no shadow, no text, no border.")
EMOTES = {
    "heart": "a big puffy glossy red heart with a small soft highlight, no face, slightly tilted, with two tiny pink hearts floating beside it",
    "songpyeon": "three plump Korean songpyeon rice cakes (half-moon shaped dumpling-like rice cakes with a pinched seam along the curved edge) snuggled together: one white, one soft pink, one soft mugwort green; the front white one has a cute happy face; a tiny green pine needle sprig on top",
    "moon": "a big round golden-yellow full moon with soft craters and a sleepy happy face, and a tiny white moon rabbit with long ears hugging it from the side",
    "star": "a very chubby puffy yellow five-pointed star with rounded points and a joyful laughing face (closed happy eyes, open smiling mouth), with two tiny sparkles beside it",
    "note": "a chubby pair of beamed music notes (a double eighth note: two round note heads joined by stems and a thick beam) as a free-standing object in warm orange-pink, bouncing at a playful tilt, a small happy face on the bigger note head, two tiny yellow sparkles beside it; NOT on a disc, badge, coin or circle — just the notes themselves",
    "persimmon": "a plump round orange Korean persimmon with a green four-leaf calyx on top, laughing out loud with closed happy eyes and a wide open smiling mouth, tiny tears of joy",
}
def gen(name):
    os.makedirs(SRC, exist_ok=True)
    path = os.path.join(SRC, f"{name}.src.png")
    req = urllib.request.Request(f"{G}/models/gemini-2.5-flash-image:generateContent",
        data=json.dumps({"contents":[{"parts":[{"text": f"{EMOTES[name]}. {STYLE}"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}).encode(),
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

def cut(name):
    rgb = np.asarray(Image.open(os.path.join(SRC, f"{name}.src.png")).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    # the backdrop's colour = the border's median; background = close to it AND connected to the border
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    bluish = (dist < 95) | ((rgb[..., 2] > 150) & (rgb[..., 2] - np.maximum(rgb[..., 0], rgb[..., 1]) > 70))
    reach = np.zeros((h, w), bool)
    reach[0, :] = reach[-1, :] = reach[:, 0] = reach[:, -1] = True
    reach &= bluish
    while True:
        g = dilate(reach, 3) & bluish
        if (g == reach).all(): break
        reach = g
    gone = bluish & (reach | True)  # pockets of backdrop inside the icon (between the two notes, under an ear) go too: nothing in these icons is that blue
    solid = ~dilate(gone, 1)
    alpha = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 255
    # un-mix the blue that bled into the soft edge
    a3 = np.clip(alpha, 0.25, 1)[..., None]
    rim = (alpha < 0.98)[..., None]
    col = np.where(rim, np.clip((rgb - (1 - a3) * bg) / a3, 0, 255), rgb)
    # and whatever blue cast is left on the rim: pull blue down to the larger of red / green there
    edge = dilate(~solid, 3) & solid
    cap = np.maximum(col[..., 0], col[..., 1])
    col[..., 2] = np.where(edge & (col[..., 2] > cap), cap, col[..., 2])
    im = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8))
    im = im.crop(im.getbbox())
    im.thumbnail((360, 360), Image.LANCZOS)
    im.save(os.path.join(OUT, f"emote_{name}.png"), optimize=True)
    return f"cut {name} {im.size}"

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in EMOTES]
    for n in EMOTES:
        if n in names or not os.path.exists(os.path.join(SRC, f"{n}.src.png")):
            print(gen(n), flush=True)
    for n in EMOTES:
        if os.path.exists(os.path.join(SRC, f"{n}.src.png")): print(cut(n), flush=True)
