#!/usr/bin/env python3
# Props for the third dance scene ("stir the magic pot"): a clay cauldron and
# a wooden ladle in the same soft clay look as the camera frame. Rendered on
# plain white, then cut out by tools/cut_props.py. Rerun to regenerate (pass
# names to redo only some: `gen_props.py ladle`).
import base64, json, os, re, sys, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "props_src")   # raw renders; cut_props.py ships the cutouts
def env(key):
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m: return m.group(1)
KEY = env("GEMINI_API_KEY")
G = "https://generativelanguage.googleapis.com/v1beta"
STYLE = ("Soft handmade modelling-clay (plasticine) style 3D render, matte surface with gentle fingerprints-free "
         "smoothness, rounded chunky child-friendly shapes, warm soft studio lighting, pastel autumn colors, "
         "ONE object only, centered, isolated on a plain solid pure WHITE background, no floor, no cast shadow, "
         "no text, no characters, no hands.")
PROPS = {
    "pot": ("A cute chubby round cooking cauldron pot seen from the FRONT at a slightly raised angle so the wide "
            "open top is visible as an ellipse. Warm terracotta-orange clay body with two small rounded handles at "
            "the sides and a thick rounded cream rim. The pot is filled to the brim with glowing golden-yellow magic "
            "soup with a few tiny floating stars and small round bubbles on the surface. The whole pot fits in the "
            "frame, wide landscape composition."),
    "ladle": ("A cute chunky wooden soup ladle standing perfectly VERTICAL: long straight rounded light-brown wooden "
              "handle going straight up, with the round deep bowl of the ladle at the BOTTOM. The handle top has a "
              "small rounded knob. Tall portrait composition, the ladle fills the frame height."),
}
def gen(name):
    path = os.path.join(OUT, f"{name}.src.png")
    req = urllib.request.Request(f"{G}/models/gemini-2.5-flash-image:generateContent",
        data=json.dumps({"contents":[{"parts":[{"text": f"{PROPS[name]} {STYLE}"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}).encode(),
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
            return f"ERR {name} {e.code} {e.read()[:200]}"
    return f"FAILED {name}"
if __name__ == "__main__":
    for name in (sys.argv[1:] or list(PROPS)):
        print(gen(name), flush=True)
