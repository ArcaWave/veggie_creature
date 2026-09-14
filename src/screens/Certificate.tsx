import { useEffect, useRef, useState } from "react";
import { MonsterFace } from "../components/MonsterFace";
import { saveToGallery } from "../lib/gallery";
import { getProfile, completeProfile } from "../lib/profile";
import { track } from "../lib/analytics";
import { sparkle } from "../lib/sfx";
import { shareOrDownload } from "../lib/share";
import type { Monster } from "../types";

// TODO: point the QR placeholder at the real Monglekids landing URL
// (generate a QR for it and drop the image into the .qr-box below)
const IDLE_RESET_MS = 150_000; // attract-loop: back to Welcome after 2.5 min idle

export function Certificate({
  monster,
  video,
  originalPhoto,
  profilePhoto,
  stars,
  onRestart,
}: {
  monster: Monster;
  video: string | null;
  originalPhoto?: string | null; // the very first veggie snapshot
  profilePhoto?: string | null; // the booth selfie — used as the certificate photo
  stars: number;
  onRestart: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [certTitle, setCertTitle] = useState("CREATIVITY"); // the word after "CERTIFICATE OF" — editable
  const [mail, setMail] = useState<"idle" | "form" | "sending" | "sent" | "unavailable" | "failed">("idle");
  const [mailAddr, setMailAddr] = useState("");
  const [mailChild, setMailChild] = useState("");
  const [mailNews, setMailNews] = useState(true);
  const [agreePhoto, setAgreePhoto] = useState(false);
  const [agreeData, setAgreeData] = useState(false);
  const savedRef = useRef(false); // guards the saves against double-run effects

  // (re)draw whenever the editable title changes
  useEffect(() => {
    let alive = true;
    drawCertificate(canvasRef.current!, monster, stars, profilePhoto ?? monster.photo, certTitle).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certTitle]);

  useEffect(() => {
    if (savedRef.current) return;
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

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailAddr.trim());
  const formReady = emailOk && agreePhoto && agreeData;

  // all five keepsakes: original photo · clay art · live clip · booth photo · certificate
  async function emailKeepsakes() {
    const email = mailAddr.trim();
    const canvas = canvasRef.current;
    if (!formReady || !canvas || mail === "sending") return;
    setMail("sending");
    track("keepsake_email", { newsletter: mailNews });
    // email + child name + the consents are recorded here (end of the journey)
    completeProfile({ email, childName: mailChild.trim() || undefined, newsletter: mailNews });
    const n = slug(monster.name);
    const vidExt = video?.startsWith("data:image/gif") ? "gif" : "mp4";
    const attachments: { filename: string; dataUrl: string }[] = [];
    if (originalPhoto) attachments.push({ filename: `${n}-original.jpg`, dataUrl: originalPhoto });
    attachments.push({ filename: `${n}-clay.png`, dataUrl: monster.photo });
    if (video) attachments.push({ filename: `${n}-alive.${vidExt}`, dataUrl: video });
    if (profilePhoto) attachments.push({ filename: `${n}-together.jpg`, dataUrl: profilePhoto });
    attachments.push({ filename: `${n}-certificate.png`, dataUrl: canvas.toDataURL("image/png") });
    // stay under the request limit — drop the (big) clip first if needed
    if (attachments.reduce((t, a) => t + a.dataUrl.length, 0) > 3_700_000 && video) {
      const i = attachments.findIndex((a) => a.filename.startsWith(`${n}-alive.`));
      if (i >= 0) attachments.splice(i, 1);
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
          <h2>🎉 You did it!</h2>
        </div>

        {/* editable award word — retypes straight onto the certificate */}
        <label className="field cert-title-field">
          <span>🏷️ Certificate of…</span>
          <input
            value={certTitle}
            onChange={(e) => setCertTitle(e.target.value)}
            placeholder="CREATIVITY"
            maxLength={20}
          />
        </label>

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
                const ext = video.startsWith("data:image/gif") ? "gif" : "mp4";
                shareOrDownload(video, `${slug(monster.name)}-alive.${ext}`, `${monster.name} is alive!`);
              }}
            >
              🎬 Live clip
            </button>
          )}
        </div>

        {/* Email me! — email + child name + consents are asked HERE, in a popup */}
        {(mail === "idle" || mail === "form" || mail === "sending" || mail === "failed") && (
          <button className="btn-secondary" disabled={!ready} onClick={() => setMail("form")}>
            ✉️ Email me everything!
          </button>
        )}
        {mail === "sent" && <p className="mail-note ok">✅ Sent! Check your inbox</p>}
        {mail === "unavailable" && <p className="mail-note">✉️ Email isn't set up yet — use the share buttons above</p>}

        {(mail === "form" || mail === "sending" || mail === "failed") && (
          <div className="modal-backdrop" onClick={() => mail !== "sending" && setMail("idle")}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <h3>👋 Grown-ups — one quick step!</h3>
              <label className="field">
                <span>Parent email *</span>
                <input
                  type="email"
                  placeholder="you@email.com"
                  value={mailAddr}
                  onChange={(e) => setMailAddr(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Child's first name (optional)</span>
                <input value={mailChild} onChange={(e) => setMailChild(e.target.value)} placeholder="Alex" maxLength={20} />
              </label>
              <label className="check">
                <input type="checkbox" checked={agreePhoto} onChange={(e) => setAgreePhoto(e.target.checked)} />
                <span>I'm a parent/guardian and agree that photos were processed by AI (Google) to create the character. *</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={agreeData} onChange={(e) => setAgreeData(e.target.checked)} />
                <span>I agree that my email, my child's creation (name and artwork), and usage data are saved to improve Monglekids. *</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={mailNews} onChange={(e) => setMailNews(e.target.checked)} />
                <span>Also send me the Monglekids newsletter (unsubscribe anytime).</span>
              </label>
              {mail === "failed" && <p className="mail-note">Didn't send — try again?</p>}
              <div className="row">
                <button className="btn-ghost" disabled={mail === "sending"} onClick={() => setMail("idle")}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={mail === "sending" || !formReady} onClick={emailKeepsakes}>
                  {mail === "sending" ? "Sending…" : mail === "failed" ? "Retry 📮" : "Send 📮"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="lead-cta">
          {/* QR PLACEHOLDER — replace with a real QR image pointing at LEARN_MORE_URL */}
          <div className="qr-box">QR</div>
          <div className="lead-text">
            <strong>Love it?</strong>
            <span>Scan for more Monglekids adventures ✨</span>
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

async function drawCertificate(canvas: HTMLCanvasElement, monster: Monster, stars: number, photoSrc: string, title: string) {
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
  // the editable award word — shrink to fit inside the border when long
  const word = (title.trim() || "CREATIVITY").toUpperCase();
  ctx.fillStyle = "#5ba12c";
  let size = 60;
  ctx.font = `800 ${size}px 'Baloo 2', sans-serif`;
  while (size > 28 && ctx.measureText(word).width > 620) {
    size -= 4;
    ctx.font = `800 ${size}px 'Baloo 2', sans-serif`;
  }
  ctx.fillText(word, cx, 218);

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

  // (no character name on the certificate — by request)
  ctx.fillStyle = "#3a4a2f";
  ctx.font = "800 34px 'Baloo 2', sans-serif";
  ctx.fillText("My veggie creature came to life", cx, 655);
  ctx.fillText("and said hello!", cx, 700);

  // traits line (from the character-creation questions)
  if (monster.traits.length) {
    ctx.fillStyle = "#8a9a7c";
    ctx.font = "700 24px 'Baloo 2', sans-serif";
    ctx.fillText(monster.traits.join("  ·  "), cx, 745);
  }

  ctx.font = "40px sans-serif";
  ctx.fillText("⭐".repeat(Math.max(1, Math.min(stars, 3))), cx, 800);

  badge(ctx, cx - 130, 835, "Creativity", "#eaf6d9", "#3b6d11");
  badge(ctx, cx + 130, 835, "Problem-solving", "#fff4d6", "#854f0b");

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  ctx.fillStyle = "#8a9a7c";
  ctx.font = "600 24px 'Baloo 2', sans-serif";
  ctx.fillText(date, cx, 946);

  // Monglekids logo as a SEAL: tilted like an approval stamp, bottom-right
  try {
    const logo = await loadImage("/monggle-logo.png");
    const lh = 130, lw = logo.width * (lh / logo.height);
    ctx.save();
    ctx.translate(W - 185, 985); // seal centre, inside the border
    ctx.rotate(-0.16); // a gentle counter-clockwise stamp tilt
    ctx.globalAlpha = 0.96;
    ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#5ba12c";
    ctx.font = "800 30px 'Baloo 2', sans-serif";
    ctx.fillText("Monglekids", W - 185, 1000);
  }
}
