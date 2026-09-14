# Local animation server: clay image in -> two looping GIF clips out.
#
#   POST /animate {"image": "data:image/...;base64,..."}
#     -> {"greet": "data:image/gif;base64,...", "smile": "data:image/gif;base64,..."}
#     -> {"error": "rig_failed", ...} when the character can't be rigged
#   GET /health -> {"ok": true}
#
# Renders with Meta's AnimatedDrawings (MIT, self-hosted — zero per-use cost).
# One render at a time (GL context); a kiosk session takes ~25s for both clips.
# Run:  ./run.sh   (see setup.sh first)
import base64
import io
import os
import re
import tempfile
import threading
import time

import cv2
import numpy as np
import yaml
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

from rig import RigError, build_character

HERE = os.path.dirname(os.path.abspath(__file__))
AD_DIR = os.environ.get("AD_DIR", os.path.join(HERE, "AnimatedDrawings"))
PORT = int(os.environ.get("ANIMATOR_PORT", "8765"))
# every creature that comes alive is archived here for the DISPLAY PC:
# <id>.greet.gif / <id>.smile.gif / <id>.json — GET /creatures lists them,
# /creatures/<file> serves them over the LAN.
CREATURES_DIR = os.environ.get("CREATURES_DIR", os.path.join(HERE, "creatures"))
os.makedirs(CREATURES_DIR, exist_ok=True)

# motion clips: (bvh file, start frame, end frame) — trimmed for speed & size
MOTIONS = {
    "greet": ("examples/bvh/fair1/wave_hello.bvh", 100, 520),
    "smile": ("examples/bvh/fair1/jumping.bvh", 150, 450),
}
RETARGET = os.path.join(AD_DIR, "examples/config/retarget/fair1_ppf.yaml")

OUT_PX = 480  # final gif size
FRAME_SKIP = 3  # keep every Nth rendered frame
FRAME_MS = 85  # gif frame duration after skipping

app = FastAPI()
render_lock = threading.Lock()


class AnimateReq(BaseModel):
    image: str


def _motion_cfg(workdir: str, kind: str) -> str:
    bvh, start, end = MOTIONS[kind]
    cfg = {
        "filepath": os.path.join(AD_DIR, bvh),
        "start_frame_idx": start,
        "end_frame_idx": end,
        "groundplane_joint": "LeftFoot",
        "forward_perp_joint_vectors": [["LeftShoulder", "RightShoulder"], ["LeftUpLeg", "RightUpLeg"]],
        "scale": 0.025,
        "up": "+z",
    }
    fn = os.path.join(workdir, f"motion_{kind}.yaml")
    with open(fn, "w") as f:
        yaml.dump(cfg, f)
    return fn


def _render(char_dir: str, motion_cfg_fn: str, out_gif: str) -> None:
    # glfw needs a process MAIN thread on macOS, so each render runs in its own
    # subprocess (render_job.py) — a render crash also can't take the server down.
    import subprocess
    import sys

    job = os.path.join(HERE, "render_job.py")
    r = subprocess.run(
        [sys.executable, job, char_dir, motion_cfg_fn, RETARGET, out_gif],
        cwd=HERE, capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0 or not os.path.exists(out_gif):
        raise RuntimeError((r.stderr or r.stdout or "render subprocess failed")[-300:])


def _transparent_frame(rgb: np.ndarray) -> Image.Image:
    """RGBA frame with the near-white background knocked out (Pillow turns RGBA
    into palette+transparency on GIF save), so creatures float free on the
    display wall instead of living in a white box."""
    near_white = (rgb > 240).all(axis=2)
    rgba = np.dstack([rgb, np.where(near_white, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def _shrink_gif(src: str) -> bytes:
    """Frame-skip + downscale + background knockout into a web-friendly gif."""
    cap = cv2.VideoCapture(src)
    frames = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % FRAME_SKIP == 0:
            f = cv2.resize(f, (OUT_PX, OUT_PX), interpolation=cv2.INTER_AREA)
            frames.append(_transparent_frame(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
        i += 1
    cap.release()
    if not frames:
        raise RuntimeError("rendered gif had no frames")
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, disposal=2)
    return buf.getvalue()


def _decode_image(data_url: str) -> np.ndarray:
    m = re.match(r"^data:image/[\w.+-]+;base64,(.*)$", data_url, re.S)
    if not m:
        raise ValueError("expected an image data URL")
    arr = np.frombuffer(base64.b64decode(m.group(1)), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image")
    return img


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/creatures")
def creatures():
    """Newest-first list of everything that has come alive (for the display PC)."""
    import json as _json

    out = []
    for fn in sorted(os.listdir(CREATURES_DIR), reverse=True):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(CREATURES_DIR, fn)) as f:
                    out.append(_json.load(f))
            except Exception:  # noqa: BLE001 — a corrupt entry shouldn't break the wall
                pass
    return {"creatures": out[:200]}


@app.get("/creatures/{name}")
def creature_file(name: str):
    from fastapi.responses import FileResponse

    safe = re.sub(r"[^\w.\-]", "", name)
    path = os.path.join(CREATURES_DIR, safe)
    if not os.path.isfile(path):
        return {"error": "not_found"}
    return FileResponse(path, media_type="image/gif" if safe.endswith(".gif") else "application/json")


@app.post("/animate")
def animate(req: AnimateReq):
    try:
        img = _decode_image(req.image)
    except ValueError as e:
        return {"error": "bad_image", "detail": str(e)}

    with render_lock, tempfile.TemporaryDirectory(prefix="veggie_") as work:
        char_dir = os.path.join(work, "char")
        try:
            build_character(img, char_dir)
        except RigError as e:
            return {"error": "rig_failed", "detail": str(e)}

        clips = {}
        for kind in ("greet", "smile"):
            out_gif = os.path.join(work, f"{kind}.gif")
            t0 = time.time()
            try:
                _render(char_dir, _motion_cfg(work, kind), out_gif)
                data = _shrink_gif(out_gif)
                print(f"[animate] {kind} rendered in {time.time() - t0:.1f}s ({len(data) // 1024}KB)", flush=True)
            except Exception as e:  # noqa: BLE001 — any render failure -> client fallback
                print(f"[animate] {kind} FAILED after {time.time() - t0:.1f}s: {str(e)[:400]}", flush=True)
                return {"error": "render_failed", "kind": kind, "detail": str(e)[:300]}
            clips[kind] = "data:image/gif;base64," + base64.b64encode(data).decode()

        # archive for the display PC (the "Digital World" wall)
        try:
            import json as _json

            cid = time.strftime("%Y%m%d-%H%M%S")
            for kind in ("greet", "smile"):
                raw = base64.b64decode(clips[kind].split(",", 1)[1])
                with open(os.path.join(CREATURES_DIR, f"{cid}.{kind}.gif"), "wb") as f:
                    f.write(raw)
            with open(os.path.join(CREATURES_DIR, f"{cid}.json"), "w") as f:
                _json.dump({"id": cid, "greet": f"{cid}.greet.gif", "smile": f"{cid}.smile.gif", "at": time.time()}, f)
            print(f"[animate] archived creature {cid}", flush=True)
        except Exception as e:  # noqa: BLE001 — archiving must never break the scan flow
            print(f"[animate] archive failed: {e}", flush=True)
        return clips


if __name__ == "__main__":
    import uvicorn

    # two-PC setup: run with ANIMATOR_HOST=0.0.0.0 so the display PC can reach
    # /creatures over the LAN (keep the default local-only when single-machine)
    uvicorn.run(app, host=os.environ.get("ANIMATOR_HOST", "127.0.0.1"), port=PORT)
