import { useEffect, useRef, useState } from "react";
import { MonsterFace } from "../components/MonsterFace";
import { saveToGallery } from "../lib/gallery";
import { getProfile } from "../lib/profile";
import { track } from "../lib/analytics";
import { sparkle } from "../lib/sfx";
import { shareOrDownload } from "../lib/share";
import type { Monster } from "../types";

// TODO: point the QR placeholder at the real Monggle Kids landing URL
// (generate a QR for it and drop the image into the .qr-box below)
const IDLE_RESET_MS = 150_000; // attract-loop: back to Welcome after 2.5 min idle

export function Certificate({
  monster,
  video,
  profilePhoto,
  stars,
  onRestart,
}: {
  monster: Monster;
  video: string | null;
  profilePhoto?: string | null; // the booth selfie — used as the certificate photo
  stars: number;
  onRestart: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [mail, setMail] = useState<"idle" | "sending" | "sent" | "unavailable" | "failed">("idle");
  const savedRef = useRef(false); // guards the saves against double-run effects

  useEffect(() => {
    let alive = true;
    drawCertificate(canvasRef.current!, monster, stars, profilePhoto ?? monster.photo).then(() => {
      if (alive) setReady(true);
    });
    if (savedRef.current) {
      return () => {
        alive = false;
      };
    }
    savedRef.current = true;
    track("cert_view");
    sparkle();
    // archive this creation on the device
    saveToGallery({
      id: `g_${Date.now()}`,
      name: monster.name,
      photo: monster.photo,
      traits: monster.traits,
      stars,
      profileId: getProfile()?.id ?? null,
      createdAt: Date.now(),
    });
    // durable server-side copy of the creation (consented; no-op without a store)
    fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mk-profile": getProfile()?.id ?? "" },
      body: JSON.stringify({
        kind: "monster",
        monster: {
          profileId: getProfile()?.id ?? null,
          name: monster.name,
          traits: monster.traits,
          eyes: monster.eyes,
          stars,
          image: monster.photo,
        },
      }),
    }).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // idle auto-reset so the booth returns to the start for the next family
  useEffect(() => {
    let timer = setTimeout(fire, IDLE_RESET_MS);
    function fire() {
      track("idle_reset");
      onRestart();
    }
    function bump() {
      clearTimeout(timer);
      timer = setTimeout(fire, IDLE_RESET_MS);
    }
    window.addEventListener("pointerdown", bump);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveOrShare() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    track("cert_saved");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `${slug(monster.name)}-certificate.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        nav.share?.({ files: [file], title: "My Veggie Monster certificate" }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  }

  async function emailKeepsakes() {
    const email = getProfile()?.email;
    const canvas = canvasRef.current;
    if (!email || !canvas || mail === "sending" || mail === "sent") return;
    setMail("sending");
    track("keepsake_email");
    const attachments = [
      { filename: `${slug(monster.name)}-certificate.png`, dataUrl: canvas.toDataURL("image/png") },
      { filename: `${slug(monster.name)}-clay.png`, dataUrl: monster.photo },
    ];
    if (video) attachments.push({ filename: `${slug(monster.name)}-alive.mp4`, dataUrl: video });
    // stay under the request limit — drop the video first if too big
    while (attachments.reduce((n, a) => n + a.dataUrl.length, 0) > 3_700_000 && attachments.length > 1) {
      attachments.pop();
    }
    try {
      const r = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mk-profile": getProfile()?.id ?? "" },
        body: JSON.stringify({ to: email, monsterName: monster.name, attachments }),
      });
      const j = (await r.json()) as { sent?: boolean; reason?: string };
      if (j.sent) setMail("sent");
      else setMail(j.reason === "no_email_key" ? "unavailable" : "failed");
    } catch {
      setMail("failed");
    }
  }

  return (
    <div className="screen center-screen cert-screen">
      <div className="cert-left">
        <div className="cert-celebrate">
          <MonsterFace monster={monster} video={video ?? undefined} size={130} />
          <h2>🎉 Quest complete!</h2>
        </div>
        <button className="btn-primary big" disabled={!ready} onClick={saveOrShare}>
          🏅 Share certificate
        </button>

        {/* keepsakes: AirDrop / Mail / save via the native share sheet (download on desktop) */}
        <div className="row">
          <button
            className="btn-secondary"
            onClick={() => {
              track("keepsake_clay");
              shareOrDownload(monster.photo, `${slug(monster.name)}-clay.png`, `${monster.name} (clay)`);
            }}
          >
            🎨 Clay art
          </button>
          {video && (
            <button
              className="btn-secondary"
              onClick={() => {
                track("keepsake_video");
                shareOrDownload(video, `${slug(monster.name)}-alive.mp4`, `${monster.name} is alive!`);
              }}
            >
              🎬 Live clip
            </button>
          )}
        </div>

        <button className="btn-secondary" disabled={!ready || mail === "sending" || mail === "sent"} onClick={emailKeepsakes}>
          {mail === "idle" && "✉️ Email them to me"}
          {mail === "sending" && "✉️ Sending…"}
          {mail === "sent" && "✅ Sent! Check your inbox"}
          {mail === "unavailable" && "✉️ Email isn't set up yet"}
          {mail === "failed" && "✉️ Didn't send — tap to retry"}
        </button>

        <div className="lead-cta">
          {/* QR PLACEHOLDER — replace with a real QR image pointing at LEARN_MORE_URL */}
          <div className="qr-box">QR</div>
          <div className="lead-text">
            <strong>Love it?</strong>
            <span>Scan for more Monggle Kids adventures ✨</span>
          </div>
        </div>

        <button className="btn-ghost" onClick={onRestart}>Make another monster</button>
      </div>

      <canvas ref={canvasRef} className="cert-canvas" width={800} height={1130} />
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function badge(ctx: CanvasRenderingContext2D, cx: number, y: number, label: string, fill: string, text: string) {
  ctx.font = "700 26px 'Baloo 2', sans-serif";
  const w = ctx.measureText(label).width + 48;
  const x = cx - w / 2;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, 52, 26);
  ctx.fill();
  ctx.fillStyle = text;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, y + 35);
}

async function drawCertificate(canvas: HTMLCanvasElement, monster: Monster, stars: number, photoSrc: string) {
  const ctx = canvas.getContext("2d")!;
  const W = 800, H = 1130, cx = W / 2;
  try {
    await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts optional */
  }

  ctx.fillStyle = "#f3fbe8";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 36, 36, W - 72, H - 72, 40);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#7cc242";
  roundRect(ctx, 36, 36, W - 72, H - 72, 40);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#6b7a5e";
  ctx.font = "700 30px 'Baloo 2', sans-serif";
  ctx.fillText("CERTIFICATE OF", cx, 150);
  ctx.fillStyle = "#5ba12c";
  ctx.font = "800 60px 'Baloo 2', sans-serif";
  ctx.fillText("CREATIVITY", cx, 218);

  const r = 150, cyc = 410;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cyc, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#eaf6d9";
  ctx.fillRect(cx - r, cyc - r, r * 2, r * 2);
  try {
    const img = await loadImage(photoSrc);
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, cx - r, cyc - r, r * 2, r * 2);
  } catch {
    ctx.font = "120px sans-serif";
    ctx.fillText("🌱", cx, cyc + 40);
  }
  ctx.restore();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#cfe8b0";
  ctx.beginPath();
  ctx.arc(cx, cyc, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#3a4a2f";
  ctx.font = "800 50px 'Baloo 2', sans-serif";
  ctx.fillText(monster.name, cx, 640);

  // traits line (from the character-creation questions)
  if (monster.traits.length) {
    ctx.fillStyle = "#8a9a7c";
    ctx.font = "700 24px 'Baloo 2', sans-serif";
    ctx.fillText(monster.traits.join("  ·  "), cx, 680);
  }

  ctx.fillStyle = "#6b7a5e";
  ctx.font = "600 26px 'Baloo 2', sans-serif";
  ctx.fillText("came to life and completed a quest", cx, 730);

  ctx.font = "40px sans-serif";
  ctx.fillText("⭐".repeat(Math.max(1, Math.min(stars, 3))), cx, 795);

  badge(ctx, cx - 130, 835, "Creativity", "#eaf6d9", "#3b6d11");
  badge(ctx, cx + 130, 835, "Problem-solving", "#fff4d6", "#854f0b");

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  ctx.fillStyle = "#8a9a7c";
  ctx.font = "600 24px 'Baloo 2', sans-serif";
  ctx.fillText(date, cx, 946);

  // Monggle Kids logo footer
  try {
    const logo = await loadImage("/monggle-logo.png");
    const lw = 300, lh = logo.height * (lw / logo.width);
    ctx.drawImage(logo, cx - lw / 2, 982, lw, lh);
  } catch {
    ctx.fillStyle = "#5ba12c";
    ctx.font = "800 30px 'Baloo 2', sans-serif";
    ctx.fillText("Monggle Kids", cx, 1020);
  }
}
