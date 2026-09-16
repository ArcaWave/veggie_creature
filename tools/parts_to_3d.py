#!/usr/bin/env python3
# Turn the part renders (public/parts/<style>_*.png) into real 3D models
# (public/models/<name>.glb) with Meshy's image-to-3D API — ONE time per part,
# so a hundred creature variants still cost only ~17 models. Checkpointed:
# existing .glb files are skipped; rerun to resume.
#
#   MESHY_API_KEY=... python3 tools/parts_to_3d.py cute          # all cute_* parts
#   MESHY_API_KEY=... python3 tools/parts_to_3d.py cute body      # only bodies
#
# The village (world3d.html) picks up any model listed in public/models/index.json
# automatically and keeps using the flat sticker for parts without one.
import base64
import glob
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, "public", "parts")
MODELS = os.path.join(ROOT, "public", "models")
os.makedirs(MODELS, exist_ok=True)
API = "https://api.meshy.ai/openapi/v1/image-to-3d"


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


KEY = env("MESHY_API_KEY")
HEADERS = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, headers=HEADERS,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def convert(png):
    name = os.path.splitext(os.path.basename(png))[0]
    out = os.path.join(MODELS, f"{name}.glb")
    if os.path.exists(out):
        return print(f"[3d] {name}: exists, skip")
    with open(png, "rb") as f:
        data_uri = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    task = call("POST", API, {
        "image_url": data_uri,
        "ai_model": "meshy-5",
        "topology": "triangle",
        "target_polycount": 30000,
        "should_texture": True,
        "enable_pbr": False,
        "should_remesh": True,
    })
    tid = task.get("result")
    if not tid:
        return print(f"[3d] {name}: START FAILED {str(task)[:200]}")
    print(f"[3d] {name}: generating…", flush=True)
    for _ in range(120):
        time.sleep(10)
        st = call("GET", f"{API}/{tid}")
        if st.get("status") == "SUCCEEDED":
            url = (st.get("model_urls") or {}).get("glb")
            if not url:
                return print(f"[3d] {name}: NO GLB {str(st)[:200]}")
            with urllib.request.urlopen(url, timeout=300) as r, open(out, "wb") as f:
                f.write(r.read())
            return print(f"[3d] {name}: saved ({os.path.getsize(out)//1024}KB)")
        if st.get("status") in ("FAILED", "CANCELED"):
            return print(f"[3d] {name}: {st.get('status')} {str(st.get('task_error'))[:200]}")
    print(f"[3d] {name}: TIMEOUT")


def write_index():
    models = sorted(os.path.basename(p) for p in glob.glob(os.path.join(MODELS, "*.glb")))
    with open(os.path.join(MODELS, "index.json"), "w") as f:
        json.dump({"models": models}, f)
    print("index:", len(models), "models")


if __name__ == "__main__":
    if not KEY:
        sys.exit("MESHY_API_KEY not found (put it in .env)")
    style = sys.argv[1] if len(sys.argv) > 1 else "cute"
    kind = sys.argv[2] if len(sys.argv) > 2 else ""
    for png in sorted(glob.glob(os.path.join(PARTS, f"{style}_{kind}*.png"))):
        convert(png)
        write_index()
    write_index()
