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


def _shrink_gif(src: str) -> bytes:
    """Frame-skip + downscale the raw render into a web-friendly looping gif."""
    cap = cv2.VideoCapture(src)
    frames = []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % FRAME_SKIP == 0:
            f = cv2.resize(f, (OUT_PX, OUT_PX), interpolation=cv2.INTER_AREA)
            frames.append(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
        i += 1
    cap.release()
    if not frames:
        raise RuntimeError("rendered gif had no frames")
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0)
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
        # stray glfw/AD logs dir cleanup is handled by TemporaryDirectory
        return clips


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
