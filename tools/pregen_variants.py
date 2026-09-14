#!/usr/bin/env python3
# One-time pre-generation of the creature VARIANT library (the "경우의 수").
# For each variant: Gemini text->image makes the clay character, then Veo makes
# a wave-hello clip and a happy clip. Everything is checkpointed — rerun to
# resume; existing files are skipped. Runtime at the event uses ONLY these files.
#
#   python3 tools/pregen_variants.py images   # step 1: the 8 character images
#   python3 tools/pregen_variants.py videos   # step 2: 16 Veo clips (paid, slow)
import base64
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "variants-src")
os.makedirs(OUT, exist_ok=True)

def env(key, default=""):
    if key in os.environ:
        return os.environ[key]
    try:
        with open(os.path.join(ROOT, ".env")) as f:
            for line in f:
                m = re.match(rf"^{key}=(.*)$", line.strip())
                if m:
                    return m.group(1)
    except FileNotFoundError:
        pass
    return default

KEY = env("GEMINI_API_KEY")
IMAGE_MODEL = env("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
VIDEO_MODEL = env("GEMINI_VIDEO_MODEL", "veo-3.1-lite-generate-preview")
G = "https://generativelanguage.googleapis.com/v1beta"

VARIANTS = [
    ("carrot", "a chubby orange carrot creature with a leafy green sprout on top"),
    ("broccoli", "a round bright-green broccoli creature with a fluffy floret head"),
    ("tomato", "a plump shiny red tomato creature with a tiny green stem hat"),
    ("potato", "a lumpy warm-beige potato creature with little brown freckles"),
    ("cucumber", "a tall cool-green cucumber creature with light stripes"),
    ("eggplant", "a glossy purple eggplant creature with a jaunty green cap"),
    ("corn", "a cheerful yellow corn creature with kernel bumps and husk leaves"),
    ("cauliflower", "a fluffy cream-white cauliflower creature with pale green leaf trim"),
]

IMG_PROMPT = (
    "An adorable kid-friendly claymation character for a children's stop-motion cartoon: {desc}. "
    "FULL BODY standing upright facing the camera, two chubby clay arms held slightly out to the "
    "sides, two short clay legs with feet, big friendly googly eyes and a warm tiny smile. "
    "Squishy chunky plasticine forms, smooth clay surface, bright cheerful candy-pastel colors. "
    "CRITICAL: plain solid WHITE background, no floor shadow, no props, no text, no watermark. "
    "Soft even lighting. Wholesome, charming and toy-like for children aged 5 to 9."
)

GREET_PROMPT = (
    "Animate this clay creature warmly waving hello, looping-friendly. It raises one little clay arm "
    "and gives a friendly hello wave two or three times, with a big happy welcoming smile and gentle "
    "bouncing, then returns to the exact same neutral starting pose so the clip can loop seamlessly. "
    "Gentle stop-motion motion, camera completely still. Keep the exact same character and the plain "
    "solid WHITE background — nothing else appears. No text, no watermark."
)
SMILE_PROMPT = (
    "Animate this clay creature celebrating happily, looping-friendly. It does a joyful little bounce "
    "and wiggle with both arms up, beaming a big warm smile, then returns to the exact same neutral "
    "starting pose so the clip can loop seamlessly. Gentle stop-motion motion, camera completely "
    "still. Keep the exact same character and the plain solid WHITE background — nothing else "
    "appears. No text, no watermark."
)


def post(url, body, retries=6):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                print(f"    (quota 429 — waiting 70s, attempt {attempt + 1})", flush=True)
                time.sleep(70)
                continue
            raise


def get(url):
    req = urllib.request.Request(url, headers={"x-goog-api-key": KEY})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def gen_image(vid, desc):
    path = os.path.join(OUT, f"{vid}.png")
    if os.path.exists(path):
        return print(f"[img] {vid}: exists, skip")
    j = post(f"{G}/models/{IMAGE_MODEL}:generateContent", {
        "contents": [{"parts": [{"text": IMG_PROMPT.format(desc=desc)}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    })
    parts = j.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    inline = next((p.get("inlineData") or p.get("inline_data") for p in parts
                   if p.get("inlineData") or p.get("inline_data")), None)
    if not inline:
        return print(f"[img] {vid}: FAILED {str(j)[:200]}")
    with open(path, "wb") as f:
        f.write(base64.b64decode(inline["data"]))
    print(f"[img] {vid}: saved")


def gen_video(vid, kind, prompt):
    path = os.path.join(OUT, f"{vid}.{kind}.mp4")
    if os.path.exists(path):
        return print(f"[veo] {vid}.{kind}: exists, skip")
    img_path = os.path.join(OUT, f"{vid}.png")
    with open(img_path, "rb") as f:
        img64 = base64.b64encode(f.read()).decode()
    j = post(f"{G}/models/{VIDEO_MODEL}:predictLongRunning", {
        "instances": [{"prompt": prompt, "image": {"bytesBase64Encoded": img64, "mimeType": "image/png"}}],
        "parameters": {"aspectRatio": "16:9"},
    })
    op = j.get("name")
    if not op:
        return print(f"[veo] {vid}.{kind}: START FAILED {str(j)[:200]}")
    print(f"[veo] {vid}.{kind}: generating…", flush=True)
    for _ in range(60):
        time.sleep(8)
        st = json.loads(get(f"{G}/{op}"))
        if st.get("done"):
            uri = (st.get("response", {}).get("generateVideoResponse", {})
                     .get("generatedSamples", [{}])[0].get("video", {}).get("uri"))
            if not uri:
                return print(f"[veo] {vid}.{kind}: NO VIDEO {str(st)[:300]}")
            with open(path, "wb") as f:
                f.write(get(uri))
            return print(f"[veo] {vid}.{kind}: saved ({os.path.getsize(path)//1024}KB)")
    print(f"[veo] {vid}.{kind}: TIMEOUT")


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "images"
    if not KEY:
        sys.exit("GEMINI_API_KEY not found")
    if step == "images":
        for vid, desc in VARIANTS:
            gen_image(vid, desc)
    elif step == "videos":
        for vid, _ in VARIANTS:
            gen_video(vid, "greet", GREET_PROMPT)
            time.sleep(3)
            gen_video(vid, "smile", SMILE_PROMPT)
            time.sleep(3)
    print("done")
