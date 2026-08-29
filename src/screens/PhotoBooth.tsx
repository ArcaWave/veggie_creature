import { useEffect, useRef, useState } from "react";
import { removeBackground } from "../lib/cutout";
import { pop } from "../lib/sfx";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import type { Monster } from "../types";

// Photo booth: take a selfie WITH your monster. The character sits at the
// bottom-left as a background-free cutout (round white-ring sticker when a
// clean cutout isn't possible — a keepsake must never look broken).
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

  // character cutout (front overlay); falls back to the sticker style
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
  }, [camOn, shot]);

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

    // selfie frame (mirrored), cover-fit
    const vw = v.videoWidth, vh = v.videoHeight;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s, dh = vh * s;
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();

    // character at the bottom-left, in front
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

    setShot(canvas.toDataURL("image/jpeg", 0.9));
    track("booth_snap");
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
        <h1>📸 Say cheese with your creature!</h1>
      </header>

      {!shot ? (
        <div className="stack center">
          <div className="booth-stage">
            {camOn ? (
              <video ref={videoRef} autoPlay playsInline muted className="booth-cam" />
            ) : (
              <div className="booth-cam placeholder">
                <span>📷</span>
                <p>{camError ?? "Starting the camera…"}</p>
              </div>
            )}
            {cutout && (
              <img src={cutout.url} className={`booth-monster${cutout.isCutout ? "" : " sticker"}`} alt="" />
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

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "monster";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
