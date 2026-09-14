import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { Clip } from "../components/Clip";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import type { Monster, MonsterVideos } from "../types";

// "Show it to the camera and it comes alive."
// No taps, no mini-games: the camera counts down and snaps by itself, then one
// automated magic sequence runs — clay ta-da, dust falling, and the reveal —
// and we hand straight over to the greeting. (Small Retake escape hatch only.)
type Step = "photo" | "magic";

const COUNTDOWN_S = 5; // time to hold the creature up before the auto-snap

export function Build({ onDone }: { onDone: (m: Monster, videos: MonsterVideos, originalPhoto: string) => void }) {
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState("");

  // -------- camera with auto countdown snap --------
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (step !== "photo") {
      stopCam();
      return;
    }
    let cancelled = false;
    setCamError(null);

    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setCamError(window.isSecureContext ? "No camera here — upload a photo!" : "Open the https link for the camera.");
      return;
    }

    md.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
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
          NotAllowedError: "Camera blocked — allow it, then retry.",
          NotFoundError: "No camera — upload a photo!",
          NotReadableError: "Another app has the camera.",
        };
        setCamError(byName[err?.name] || "Camera hiccup — retry.");
        setCamOn(false);
      });

    return () => {
      cancelled = true;
      stopCam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, camTry]);

  // bind the stream after the <video> renders (prevents a black screen)
  useEffect(() => {
    const v = videoRef.current;
    if (camOn && v && streamRef.current) {
      v.srcObject = streamRef.current;
      v.play?.().catch(() => {});
    }
  }, [camOn]);

  // the countdown starts as soon as the camera is live, then snaps by itself
  useEffect(() => {
    if (!camOn || step !== "photo") {
      setCount(null);
      return;
    }
    setCount(COUNTDOWN_S);
    const id = setInterval(() => {
      setCount((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(id);
          capture();
          return 0;
        }
        pop();
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn, step, camTry]);

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  function capture() {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    sparkle();
    // WYSIWYG: crop what the (object-fit: cover) preview shows
    const ratio = v.clientWidth && v.clientHeight ? v.clientWidth / v.clientHeight : 1;
    let cw = v.videoWidth, ch = v.videoHeight;
    if (cw / ch > ratio) cw = Math.round(ch * ratio);
    else ch = Math.round(cw / ratio);
    const scale = Math.min(1, 960 / Math.max(cw, ch));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(ch * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    setPhoto(url);
    track("photo_captured");
    keepAsset("original", url);
    setStep("magic");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      track("photo_uploaded");
      keepAsset("original", String(reader.result));
      setStep("magic");
    };
    reader.readAsDataURL(file);
  }

  function retake() {
    track("photo_retake");
    setPhoto("");
    setStep("photo");
    setCamTry((t) => t + 1);
  }

  if (step === "magic") {
    return <MagicStep photo={photo} onRetake={retake} onDone={onDone} />;
  }

  return (
    <div className="screen">
      <div className="stack center">
        <p className="lead">📸 Show your veggie creature to the camera!</p>
        <div className="camera-box">
          {camOn ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="camera" />
              {count !== null && count > 0 && <span className="count-badge">{count}</span>}
            </>
          ) : (
            <div className="camera placeholder">
              <img src="/camera-cover.jpg" alt="" className="cover-bg" />
              <span>📷</span>
              <p>{camError ?? "Starting the camera…"}</p>
            </div>
          )}
        </div>
        {!camOn && camError && (
          <button className="btn-secondary" onClick={() => { stopCam(); setCamTry((t) => t + 1); }}>
            📷 Retry
          </button>
        )}
        <label className="btn-ghost">
          🖼️ Upload instead
          <input type="file" accept="image/*" onChange={onFile} hidden />
        </label>
      </div>
    </div>
  );
}

// -------- the automated magic: photo -> match -> dust -> ALIVE --------------
// No runtime generation at all: the scan photo is matched (one cheap vision
// call, ~2s) against the PRE-MADE variant library in public/variants, magic
// dust falls for a moment of theatre, and the matching creature bursts to life.
function MagicStep({
  photo,
  onRetake,
  onDone,
}: {
  photo: string;
  onRetake: () => void;
  onDone: (m: Monster, videos: MonsterVideos, originalPhoto: string) => void;
}) {
  type Phase = "match" | "dust" | "alive";
  const [phase, setPhase] = useState<Phase>("match");
  const [clips, setClips] = useState<MonsterVideos>({ greet: null, smile: null });
  const frameRef = useRef<HTMLDivElement>(null);

  // no run-once ref: StrictMode's dev double-mount would strand the live run.
  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) which pre-made creature does this creation resemble?
      track("match_start");
      let variant = "carrot";
      try {
        const r = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: photo }),
        });
        const j = await r.json();
        if (typeof j.variant === "string") variant = j.variant;
        track("match_done", { variant, matched: j.matched ?? false });
      } catch {
        track("match_fail");
      }
      if (!alive) return;

      const videos: MonsterVideos = {
        greet: `/variants/${variant}.greet.gif`,
        smile: `/variants/${variant}.smile.gif`,
      };

      // 2) a short shower of magic dust — the moment of transformation
      setPhase("dust");
      window.setTimeout(() => {
        if (!alive) return;
        setClips(videos);
        setPhase("alive");
        magicDustBurst(frameRef.current);
        sparkle();
        // announce the arrival to the Digital World (display PC)
        fetch("/api/creatures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant }),
        }).catch(() => {});

        // 3) a beat to take it in, then onwards
        window.setTimeout(() => {
          if (!alive) return;
          const m: Monster = {
            name: "My Monster",
            photo: `/variants/${variant}.png`,
            eyes: [
              { x: 0.36, y: 0.4 },
              { x: 0.64, y: 0.4 },
            ],
            traits: [],
          };
          track("build_done", { variant });
          onDone(m, videos, photo);
        }, 3000);
      }, 2600);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = clips.greet ?? clips.smile ?? null;
  return (
    <div className="screen center-screen" style={{ alignItems: "center" }}>
      <p className="lead">
        {phase === "match" ? "✨ Reading the magic…" : phase === "dust" ? "✨ Sprinkling magic dust…" : "🎉 It's ALIVE!"}
      </p>

      <div className={`wake-frame${phase === "alive" && shown ? " reveal-pop" : ""}`} ref={frameRef}>
        {phase === "alive" && shown ? (
          <Clip src={shown} className="wake-media" />
        ) : (
          <img
            src={photo}
            className="wake-media"
            alt=""
            style={phase === "match" ? { filter: "saturate(1.4) blur(1.2px)" } : undefined}
          />
        )}
        {phase === "match" && <SparkleLoading messages={["Who are you in there…?", "Feeling the magic…"]} />}
        {phase === "dust" && (
          <div className="dust-shower">
            {Array.from({ length: 14 }).map((_, k) => (
              <span key={k} className="dust-fleck" style={{ left: `${5 + k * 6.5}%`, animationDelay: `${(k % 7) * 0.18}s` }}>✨</span>
            ))}
            <span className="sparkle-msg">Magic dust is falling…</span>
          </div>
        )}
      </div>

      {phase !== "alive" && (
        <button className="btn-ghost" onClick={onRetake}>📷 Retake</button>
      )}
    </div>
  );
}
