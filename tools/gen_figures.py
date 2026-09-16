#!/usr/bin/env python3
# Full-figure kawaii renders: one COMPLETE character per body x arms x legs
# combination (hats stay separate overlays). Rendered whole, the arms and legs
# attach naturally — no collage look. Checkpointed; rerun to resume.
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
         "surface with gentle subsurface glow, chubby rounded proportions, big glossy black button eyes, rosy "
         "blush cheeks, tiny sweet smile, soft studio lighting, gentle pastel colors, FULL BODY standing upright "
         "facing the camera, centered and filling the frame, ONE character only, isolated on a plain solid WHITE "
         "background, no floor shadow, no props, no text. NO hat, nothing on the head.")
BODIES = {
  "carrot": "a plump rounded orange carrot standing upright with a small leafy green sprout on top",
  "eggplant": "a plump rounded glossy purple eggplant standing upright with its little green cap",
  "tomato": "a plump round red tomato with a tiny green stem",
  "potato": "a plump rounded warm-beige potato with tiny freckles",
  "cucumber": "a plump rounded soft-green cucumber standing upright",
  "corn": "a plump rounded ear of yellow corn with soft kernel bumps and small husk leaves at the top",
  "broccoli": "a round fluffy green broccoli head like a mop of hair over a small light-green face, on a short stalk body",
  "cauliflower": "a round fluffy CREAM-BEIGE (clearly darker than the white background) cauliflower with pale green leaf trim",
}
ARMS = {"twig": "soft brown tree twigs with stubby branch fingers", "cucumber": "small soft green cucumbers with rounded mitten hands", "carrot": "small soft orange carrots with rounded mitten hands"}
LEGS = {"twig": "short soft brown tree twigs with rounded feet", "cucumber": "short soft green cucumbers with rounded feet", "carrot": "short soft orange carrots with rounded feet"}
def gen(job):
    b, a, l = job
    path = os.path.join(OUT, f"fig_{b}_{a}_{l}.src.png")
    if os.path.exists(path) or os.path.exists(path.replace(".src.png", ".png")): return f"skip {b}-{a}-{l}"
    desc = (f"a complete chibi child character whose BODY is {BODIES[b]}, with a cute face on the front, "
            f"two chubby little ARMS made of {ARMS[a]} attached at the sides of the body hanging down, and "
            f"two short stubby LEGS made of {LEGS[l]} under the body")
    req = urllib.request.Request(f"{G}/models/gemini-2.5-flash-image:generateContent",
        data=json.dumps({"contents":[{"parts":[{"text": f"{desc}. {STYLE}"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}).encode(),
        headers={"Content-Type":"application/json","x-goog-api-key":KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r: j = json.load(r)
            parts = j.get("candidates",[{}])[0].get("content",{}).get("parts",[])
            inline = next((p.get("inlineData") or p.get("inline_data") for p in parts if p.get("inlineData") or p.get("inline_data")), None)
            if inline:
                open(path,"wb").write(base64.b64decode(inline["data"])); return f"saved {b}-{a}-{l}"
            time.sleep(3)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(40); continue
            return f"ERR {b}-{a}-{l} {e.code}"
    return f"FAILED {b}-{a}-{l}"
if __name__ == "__main__":
    jobs = [(b, a, l) for b in BODIES for a in ARMS for l in LEGS]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for msg in ex.map(gen, jobs): print(msg, flush=True)
    print("done")
