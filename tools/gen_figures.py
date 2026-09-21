#!/usr/bin/env python3
# Full-figure kawaii renders: one COMPLETE character per body x arms x legs
# combination (hats stay separate overlays, rendered here too). Rendered whole,
# the arms and legs attach naturally — no collage look. Checkpointed by the
# raw renders in tools/figs_src; rerun to resume, or name figures to redo them
# (`gen_figures.py tomato_carrot_twig`). Then cut_figures.py. Hats are text-only.
import base64, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "parts")
def env(key):
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m: return m.group(1)
KEY = env("GEMINI_API_KEY")
G = "https://generativelanguage.googleapis.com/v1beta"
STYLE = ("Adorable kawaii chibi 3D toy-figurine render in the style of a collectible vinyl figure: soft matte "
         "surface with gentle subsurface glow, chubby rounded body, big glossy black button eyes, rosy "
         "blush cheeks, tiny sweet smile, soft studio lighting, gentle pastel colors, FULL BODY standing upright "
         "facing the camera, centered and filling the frame, ONE character only, isolated on a plain solid WHITE "
         "background, no floor shadow, no props, no text. NO hat, nothing on the head.")
BODIES = {  # the event's five main vegetables (fixed 2026-09-20: 늙은호박, 옥수수, 고구마, 토마토, 양배추)
  "pumpkin": "a big plump FLATTENED-round Korean old pumpkin (like a cheese pumpkin) with deep vertical ribs all around, muted warm tan-orange skin, and a short curly dried brown stem on top",
  "corn": "a plump rounded ear of yellow corn with soft kernel bumps and small husk leaves at the top",
  "sweetpotato": "a plump elongated sweet potato standing upright, gently tapered at the top and bottom, with reddish-purple magenta-brown skin and a few tiny root dimples",
  "tomato": "a plump round red tomato with a tiny green stem",
  "cabbage": "a plump round head of green cabbage: big overlapping pale-green outer leaves wrapped around it, with clearly visible white leaf veins and gently ruffled leaf edges, a little darker green on the outermost leaves; the eyes, blush and smile sit DIRECTLY on the green leaf surface (no separate skin-colored face, no hood)",
}
# The limbs and hats are the event's printed STICKERS (tools/sticker_refs/, cut
# from the sticker sheet). Each render gets the matching sticker crops as
# reference images, so the clay figure wears what the child actually stuck on.
REFS = os.path.join(ROOT, "tools", "sticker_refs")
SRC = os.path.join(ROOT, "tools", "figs_src")   # raw renders (git-ignored); cut_figures.py builds public/parts from them
FORCE = set()
ARMS = {
  "twig": "slender brown tree-branch arms, each with one small side twig, ending in an open hand of five thin twig fingers",
  "cucumber": "curved green cucumber arms made of three or four bumpy rounded segments with tiny leaf sprigs, each ending in a hand made of pointed green leaves",
  "carrot": "orange carrot arms with fine root lines: a tuft of green carrot leaves at the shoulder, tapering down to a small hand with stubby little fingers",
}
LEGS = {
  "twig": "SHORT STUBBY brown tree-branch stump legs (thick little logs, not thin sticks), each with one tiny side twig, ending in a rounded dome-shaped brown foot",
  "cucumber": "thick green bumpy cucumber legs with tiny leaf sprigs, each ending in a big rounded knob foot like a little boot",
  "carrot": "thick orange carrot legs with fine root lines, the rounded thick end forming a boot-like foot, and a small tuft of green carrot leaves where the leg meets the body",
}
def b64(path):
    with open(path, "rb") as f: return base64.b64encode(f.read()).decode()
def call(parts, path):
    req = urllib.request.Request(f"{G}/models/gemini-2.5-flash-image:generateContent",
        data=json.dumps({"contents":[{"parts": parts}],"generationConfig":{"responseModalities":["IMAGE"]}}).encode(),
        headers={"Content-Type":"application/json","x-goog-api-key":KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r: j = json.load(r)
            out = j.get("candidates",[{}])[0].get("content",{}).get("parts",[])
            inline = next((p.get("inlineData") or p.get("inline_data") for p in out if p.get("inlineData") or p.get("inline_data")), None)
            if inline:
                open(path,"wb").write(base64.b64decode(inline["data"])); return True
            time.sleep(3)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(40); continue
            print("HTTP", e.code, e.read()[:200]); return False
        except Exception as e:
            print("ERR", e); time.sleep(5)
    return False
def gen(job):
    b, a, l = job
    path = os.path.join(SRC, f"fig_{b}_{a}_{l}.src.png")
    if os.path.exists(path) and (b, a, l) not in FORCE: return f"skip {b}-{a}-{l}"
    # the twig LEG sticker is a long straight branch; shown to the model it always
    # comes back as stilts — so twig legs are described in words only
    leg_ref = l != "twig"
    text = (f"Create a complete chibi child character whose BODY is {BODIES[b]}, with a cute face on the front. "
            f"Its two ARMS and two LEGS are printed craft stickers"
            + (", shown in the two attached reference images: IMAGE 1 = the ARM stickers, IMAGE 2 = the LEG stickers. "
               if leg_ref else "; the attached reference image shows the ARM stickers. ") +
            f"Rebuild those exact designs — same shapes, same "
            f"details, same colors — as soft 3D clay pieces in the character's own style, so anyone would recognise them "
            f"as the same stickers, but in CHIBI TOY PROPORTIONS: short, thick and chubby, never long or spindly. "
            f"ARMS: {ARMS[a]}; short (about half the body's height), one attached at each side of the body, mirrored, "
            f"hanging slightly outward. LEGS: {LEGS[l]}; very short and sturdy (about a quarter of the body's height), two of "
            f"them side by side directly under the body, feet flat on the ground. The big round body dominates the figure "
            f"and sits LOW, close to the ground. {STYLE}")
    parts = [{"text": text}, {"inline_data": {"mime_type": "image/png", "data": b64(os.path.join(REFS, f"arm_{a}.png"))}}]
    if leg_ref: parts.append({"inline_data": {"mime_type": "image/png", "data": b64(os.path.join(REFS, f"leg_{l}.png"))}})
    return f"{'saved' if call(parts, path) else 'FAILED'} {b}-{a}-{l}"
HATS = {
  "leaves": "a big, LUSH crown of autumn leaves (a head wreath seen from the front): a thick band densely packed with LARGE overlapping maple leaves in red, orange, golden yellow and olive green, the leaves standing up tall like the points of a crown, with four plump brown acorns with textured caps nestled in a row along the front, and a few tiny red and orange berries on thin stems peeking out at both ends",
  "acorn": "a big brown beanie-like dome cap covered all over in overlapping rounded scales like a pinecone or an acorn cup, wide and rounded on top, with a cluster of red, orange and olive-green maple leaves and two small acorns tucked along its lower rim at both sides",
  "straw": "a woven golden straw sun hat with a rounded crown and a wide, gently wavy brim, an orange-and-green checked (plaid) ribbon band around the crown tied at one side in a bow with two hanging tails, decorated there with one red and one golden maple leaf and three red berries",
}
HAT_STYLE = ("Adorable kawaii 3D toy accessory sculpted from soft matte modelling clay, in the style of a collectible vinyl "
             "figure's hat: thick chubby rounded volumes, puffy clay leaves with softly pressed-in veins, smooth soft shading, "
             "gentle subsurface glow, soft studio lighting, warm autumn colors. NO outlines, not an illustration. Shown UPRIGHT "
             "from the front and slightly from above, exactly as it would sit on top of a round head, centered and filling the "
             "frame. ONE object only, isolated on a plain solid WHITE background, no head, no character, no floor shadow, no text.")
def gen_hat(name):
    # text only: given the sticker itself as an image, the model hands the 2D drawing back
    path = os.path.join(ROOT, "tools", "hats_src", f"cute_hat_{name}.src.png")
    if os.path.exists(path): return f"skip hat {name}"
    return f"{'saved' if call([{'text': f'A hat: {HATS[name]}. {HAT_STYLE}'}], path) else 'FAILED'} hat {name}"
if __name__ == "__main__":
    # gen_figures.py            → everything that has no .src.png yet
    # gen_figures.py sample     → the three hats + three figures (a quick look before the full run)
    # gen_figures.py tomato_carrot_twig …  → redo just these figures (then cut_figures.py)
    jobs = [(b, a, l) for b in BODIES for a in ARMS for l in LEGS]
    hats = list(HATS)
    if "sample" in sys.argv: jobs = [("pumpkin", "twig", "carrot"), ("cabbage", "cucumber", "cucumber"), ("tomato", "carrot", "twig")]
    named = [tuple(x.split("_")) for x in sys.argv[1:] if x.count("_") == 2]
    if named: jobs, hats = named, []; FORCE.update(named)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for msg in ex.map(gen_hat, hats): print(msg, flush=True)
        for msg in ex.map(gen, jobs): print(msg, flush=True)
    print("done")
