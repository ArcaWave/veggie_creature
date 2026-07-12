import { useEffect, useRef, useState } from "react";
import { removeBackground } from "../lib/cutout";
import { loadSegmenter } from "../lib/segment";
import { pop } from "../lib/sfx";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import type { Monster } from "../types";

// Photo booth with a Zoom-style VIRTUAL BACKGROUND: the person is segmented live
// and everything behind them becomes the clay world (the full clay image —
// creature included — no fragile cutout needed). If segmentation isn't
// available, we fall back to the classic view with the cutout/sticker overlay.
export function PhotoBooth({
  monster,
  onDone,
}: {
  monster: Monster;
  onDone: (photo: string | null) => void; // the booth snapshot becomes the certificate photo
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  const [cutout, setCutout] = useState<{ url: string; isCutout: boolean } | null>(null);

  // virtual background
  const [bgMode, setBgMode] = useState<"loading" | "on" | "off">("loading");
  const [segReady, setSegReady] = useState(false);
  const segRef = useRef<import("@mediapipe/tasks-vision").ImageSegmenter | null>(null);
  const bgColorRef = useRef<string>("#dceef7"); // sampled from the clay image corners
  const cutImgRef = useRef<HTMLImageElement | null>(null);
  const cutIsCutoutRef = useRef(false);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const personLayer = useRef<HTMLCanvasElement | null>(null);
  const maskLayer = useRef<HTMLCanvasElement | null>(null);
  const bgOn = bgMode === "on" && segReady;

  // clay backdrop color + segmenter (lazy; graceful fallback if it can't load)
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      // virtual background = the clay scene's own background color (corner average)
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data;
        const pick = (px: number) => [d[px * 4], d[px * 4 + 1], d[px * 4 + 2]];
        const cs = [pick(0), pick(23), pick(24 * 23), pick(24 * 23 + 23)];
        const avg = (i: number) => Math.round(cs.reduce((n, cc) => n + cc[i], 0) / 4);
        bgColorRef.current = `rgb(${avg(0)}, ${avg(1)}, ${avg(2)})`;
      } catch {
        /* keep the default pastel */
      }
    };
    img.src = monster.photo;
    loadSegmenter()
      .then((s) => {
        if (!alive) return;
        segRef.current = s;
        setSegReady(true);
        setBgMode("on");
        track("booth_bg_ready");
      })
      .catch(() => alive && setBgMode("off"));
    return () => {
      alive = false;
    };
  }, [monster.photo]);

  // character cutout — drawn FRONT-most in both modes (classic overlay + virtual bg)
  useEffect(() => {
    let alive = true;
    removeBackground(monster.photo)
      .then((c) => {
        if (!alive) return;
        setCutout(c);
        if (c.isCutout) keepAsset("cutout", c.url); // gallery raw material
      })
      .catch(() => alive && setCutout({ url: monster.photo, isCutout: false }));
    return () => {
      alive = false;
    };
  }, [monster.photo]);

  // keep a decoded copy for the per-frame compositor
  useEffect(() => {
    if (!cutout) return;
    const img = new Image();
    img.onload = () => {
      cutImgRef.current = img;
      cutIsCutoutRef.current = cutout.isCutout;
    };
    img.src = cutout.url;
  }, [cutout]);

  // camera
  useEffect(() => {
    let cancelled = false;
    setCamError(null);
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setCamError("The camera isn't available here.");
      return;
    }
    md.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCamOn(true);
      })
      .catch((err: DOMException) => {
        const byName: Record<string, string> = {
          NotAllowedError: "Camera access was blocked. Allow the camera, then try again.",
          NotFoundError: "No camera found.",
          NotReadableError: "Another app is using the camera.",
        };
        setCamError(byName[err?.name] || "Couldn't start the camera.");
        setCamOn(false);
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camTry, shot]);

  useEffect(() => {
    const v = videoRef.current;
    if (camOn && !shot && v && streamRef.current) {
      v.srcObject = streamRef.current;
      v.play?.().catch(() => {});
    }
  }, [camOn, shot, bgOn]);

  // live compositor: clay world behind, segmented person in front (mirrored)
  useEffect(() => {
    if (!bgOn || !camOn || shot) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const cvs = displayRef.current;
      const s = segRef.current;
      if (!v || !cvs || !s || v.readyState < 2 || !v.videoWidth) return;
      const W = v.videoWidth, H = v.videoHeight;
      if (cvs.width !== W) {
        cvs.width = W;
        cvs.height = H;
      }
      // never show a black frame: if segmentation can't run, fall back to the
      // plain mirrored camera + front character for this frame
      const drawPlain = () => {
        const ctx = cvs.getContext("2d")!;
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, 0, 0, W, H);
        ctx.restore();
        drawFrontCharacter(ctx, W, H, cutImgRef.current, cutIsCutoutRef.current);
      };
      let result;
      try {
        result = s.segmentForVideo(v, performance.now());
      } catch {
        drawPlain();
        return;
      }
      const cm = result.categoryMask;
      if (!cm) {
        drawPlain();
        return;
      }
      const mw = cm.width, mh = cm.height;
      const arr = cm.getAsUint8Array();

      // which mask value is the person? sample the frame center — the person
      // is standing there; this self-calibrates regardless of model convention
      let hits = 0, total = 0;
      for (let y = (mh * 0.35) | 0; y < mh * 0.65; y += 2) {
        for (let x = (mw * 0.4) | 0; x < mw * 0.6; x += 2) {
          total++;
          if (arr[y * mw + x] > 0) hits++;
        }
      }
      const personIsNonZero = hits > total / 2;

      maskLayer.current ??= document.createElement("canvas");
      const mc = maskLayer.current;
      if (mc.width !== mw) {
        mc.width = mw;
        mc.height = mh;
      }
      const mctx = mc.getContext("2d")!;
      const id = mctx.createImageData(mw, mh);
      for (let i = 0; i < arr.length; i++) {
        id.data[i * 4 + 3] = (arr[i] > 0) === personIsNonZero ? 255 : 0;
      }
      mctx.putImageData(id, 0, 0);
      cm.close();

      // person = video frame masked (feathered edge)
      personLayer.current ??= document.createElement("canvas");
      const pc = personLayer.current;
      if (pc.width !== W) {
        pc.width = W;
        pc.height = H;
      }
      const pctx = pc.getContext("2d")!;
      pctx.globalCompositeOperation = "source-over";
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(v, 0, 0, W, H);
      pctx.globalCompositeOperation = "destination-in";
      pctx.filter = "blur(3px)";
      pctx.drawImage(mc, 0, 0, W, H);
      pctx.filter = "none";

      // layers: clay-background color → person (mirrored) → character in FRONT
      const ctx = cvs.getContext("2d")!;
      ctx.fillStyle = bgColorRef.current;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1); // selfie mirror for the person only
      ctx.drawImage(pc, 0, 0);
      ctx.restore();
      drawFrontCharacter(ctx, W, H, cutImgRef.current, cutIsCutoutRef.current);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bgOn, camOn, shot]);

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    pop();
    const W = 1200, H = 900;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    if (bgOn && displayRef.current && displayRef.current.width) {
      // virtual-background shot: the compositor canvas is already mirrored+composed
      const src = displayRef.current;
      const s = Math.max(W / src.width, H / src.height);
      ctx.drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s);
    } else {
      // classic shot: mirrored selfie + character overlay
      const vw = v.videoWidth, vh = v.videoHeight;
      const s = Math.max(W / vw, H / vh);
      const dw = vw * s, dh = vh * s;
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
      try {
        const img = await loadImage(cutout?.url ?? monster.photo);
        if (cutout?.isCutout) {
          const ch = Math.round(H * 0.54);
          const cw = Math.round(img.width * (ch / img.height));
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 26;
          ctx.shadowOffsetY = 14;
          ctx.drawImage(img, Math.round(W * 0.03), H - ch - Math.round(H * 0.02), cw, ch);
          ctx.restore();
        } else {
          const size = Math.round(H * 0.44);
          const r = size / 2;
          const cx = Math.round(W * 0.03) + r;
          const cy = H - Math.round(H * 0.03) - r;
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 22;
          ctx.shadowOffsetY = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.restore();
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.clip();
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, cx - r, cy - r, size, size);
          ctx.restore();
          ctx.lineWidth = 10;
          ctx.strokeStyle = "#fff";
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      } catch {
        /* keep just the camera photo if the character can't draw */
      }
    }

    setShot(canvas.toDataURL("image/jpeg", 0.9));
    track("booth_snap", { bg: bgOn });
  }

  async function share() {
    if (!shot) return;
    track("booth_share");
    const blob = await (await fetch(shot)).blob();
    const file = new File([blob], `${slug(monster.name)}-and-me.jpg`, { type: "image/jpeg" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      nav.share?.({ files: [file], title: `Me and ${monster.name}` }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="screen booth">
      <header className="topbar">
        <h1>📸 Say cheese with {monster.name}!</h1>
      </header>

      {!shot ? (
        <div className="stack center">
          <div className="booth-stage">
            {camOn ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="booth-cam"
                  style={bgOn ? { display: "none" } : undefined}
                />
                {bgOn && <canvas ref={displayRef} className="booth-cam" />}
              </>
            ) : (
              <div className="booth-cam placeholder">
                <span>📷</span>
                <p>{camError ?? "Starting the camera…"}</p>
              </div>
            )}
            {!bgOn && cutout && (
              <img src={cutout.url} className={`booth-monster${cutout.isCutout ? "" : " sticker"}`} alt="" />
            )}
            {camOn && segReady && (
              <button
                className="bg-toggle"
                onClick={() => {
                  pop();
                  setBgMode(bgOn ? "off" : "on");
                  track("booth_bg_toggle", { on: !bgOn });
                }}
              >
                {bgOn ? "👤 Plain" : "🌈 Clay world"}
              </button>
            )}
          </div>

          {camOn ? (
            <button className="btn-primary big" onClick={capture}>📸 Snap!</button>
          ) : (
            <button className="btn-secondary" onClick={() => setCamTry((t) => t + 1)}>📷 Try camera again</button>
          )}
          <button className="btn-ghost" onClick={() => onDone(null)}>Skip →</button>
        </div>
      ) : (
        <div className="stack center">
          <img src={shot} className="booth-result" alt="me and my monster" />
          <div className="row">
            <button className="btn-secondary" onClick={() => setShot(null)}>🔄 Retake</button>
            <button className="btn-secondary" onClick={share}>📤 Share</button>
            <button className="btn-primary" onClick={() => onDone(shot)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// the clay character, always FRONT-most at the bottom-left (cutout when clean,
// round white-ring sticker otherwise)
function drawFrontCharacter(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  img: HTMLImageElement | null,
  isCutout: boolean
) {
  if (!img) return;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  if (isCutout) {
    const ch = Math.round(H * 0.56);
    const cw = Math.round(img.width * (ch / img.height));
    ctx.drawImage(img, Math.round(W * 0.02), H - ch - Math.round(H * 0.02), cw, ch);
    ctx.restore();
  } else {
    const size = Math.round(H * 0.42);
    const r = size / 2;
    const cx = Math.round(W * 0.03) + r;
    const cy = H - Math.round(H * 0.03) - r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, cx - r, cy - r, size, size);
    ctx.restore();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "monster";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
