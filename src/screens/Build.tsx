import { useEffect, useRef, useState } from "react";
import { MonsterFace } from "../components/MonsterFace";
import { SparkleLoading } from "../components/SparkleLoading";
import { DustGame } from "../components/DustGame";
import { ClayGame } from "../components/ClayGame";
import { stylizePhoto } from "../api/stylize";
import { animateMonster } from "../api/animate";
import { pop, sparkle } from "../lib/sfx";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import type { Monster } from "../types";

type Step = "photo" | "style" | "wake" | "eyes" | "name";

export function Build({ onDone }: { onDone: (m: Monster, video: string | null) => void }) {
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState("");
  const [stylized, setStylized] = useState<string | null>(null);
  const [wakeVideo, setWakeVideo] = useState<string | null>(null);
  const [traits, setTraits] = useState<string[]>([]);
  const [eyes, setEyes] = useState([
    { x: 0.36, y: 0.4 },
    { x: 0.64, y: 0.4 },
  ]);
  const [name, setName] = useState("");

  const active = stylized ?? photo;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);

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

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  function capture() {
    const v = videoRef.current;
    if (!v) return;
    pop();
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, 480, 480);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    setPhoto(url);
    setStylized(null);
    track("photo_captured");
    keepAsset("original", url); // gallery raw material
    setStep("style");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      setStylized(null);
      track("photo_uploaded");
      keepAsset("original", String(reader.result)); // gallery raw material
      setStep("style");
    };
    reader.readAsDataURL(file);
  }

  function finish() {
    const m: Monster = { name: name.trim() || "My Monster", photo: active, eyes, traits };
    track("named", { name: m.name });
    onDone(m, wakeVideo);
  }

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Make your monster</h1>
      </header>

      <Steps step={step} />

      {step === "photo" && (
        <div className="stack center">
          <div className="camera-box">
            {camOn ? (
              <video ref={videoRef} autoPlay playsInline muted className="camera" />
            ) : (
              <div className="camera placeholder">
                <span>📷</span>
                <p>{camError ?? "Show me your creature!"}</p>
              </div>
            )}
          </div>
          {camOn ? (
            <button className="btn-primary big" onClick={capture}>📸 Snap!</button>
          ) : (
            <button className="btn-secondary" onClick={() => { stopCam(); setCamTry((t) => t + 1); }}>
              📷 Retry
            </button>
          )}
          <label className="btn-secondary">
            🖼️ Upload
            <input type="file" accept="image/*" onChange={onFile} hidden />
          </label>
        </div>
      )}

      {step === "style" && (
        <StyleStep
          photo={photo}
          stylized={stylized}
          setStylized={setStylized}
          onNext={() => setStep("wake")}
          onRetake={() => {
            // back to the camera for a brand-new photo (clay result is discarded)
            setPhoto("");
            setStylized(null);
            track("photo_retake");
            setStep("photo");
          }}
        />
      )}

      {step === "wake" && (
        <WakeStep
          image={active}
          video={wakeVideo}
          setVideo={setWakeVideo}
          traits={traits}
          setTraits={setTraits}
          onDone={(hasVideo) => setStep(hasVideo ? "name" : "eyes")}
        />
      )}

      {step === "eyes" && (
        <EyesStep photo={active} eyes={eyes} setEyes={setEyes} onNext={() => setStep("name")} />
      )}

      {step === "name" && (
        <div className="stack center">
          <MonsterFace monster={{ photo: active, eyes }} video={wakeVideo ?? undefined} size={160} />
          {traits.length > 0 && (
            <div className="name-chips">
              {traits.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          )}
          <p className="lead">Name it!</p>
          <input
            className="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rocket Carrot"
            maxLength={16}
            autoFocus
          />
          <button className="btn-primary big" onClick={finish}>Quest! →</button>
        </div>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["photo", "style", "wake", "eyes", "name"];
  const labels: Record<Step, string> = { photo: "Photo", style: "Clay", wake: "Wake", eyes: "Eyes", name: "Name" };
  const idx = order.indexOf(step);
  return (
    <div className="steps">
      {order.map((s, i) => (
        <span key={s} className={`step ${i <= idx ? "done" : ""}`}>{labels[s]}</span>
      ))}
    </div>
  );
}

// Photo -> clay image. The AI runs in the background while the child kneads the
// photo (ClayGame). The reveal is HELD until BOTH the kneading is finished and
// the AI result is ready — then a short beat, then ta-da. Redo skips the game.
function StyleStep({
  photo,
  stylized,
  setStylized,
  onNext,
  onRetake,
}: {
  photo: string;
  stylized: string | null;
  setStylized: (s: string | null) => void;
  onNext: () => void;
  onRetake: () => void;
}) {
  type Status = "working" | "done" | "nokey" | "error";
  const [status, setStatus] = useState<Status>(stylized ? "done" : "working");
  const [ready, setReady] = useState<string | null>(null); // AI result waiting for the game
  const [gameDone, setGameDone] = useState(!!stylized);
  const [revealed, setRevealed] = useState(!!stylized);
  const [progress, setProgress] = useState(0); // top loading bar (eases to 90, jumps on ready)
  const started = useRef(false);

  useEffect(() => {
    if (status !== "working") return;
    const id = setInterval(() => setProgress((p) => (p > 90 ? p : Math.min(90, p + Math.max(0.4, (90 - p) * 0.04)))), 250);
    return () => clearInterval(id);
  }, [status]);

  async function run(withGame: boolean) {
    setStatus("working");
    setProgress(0);
    setReady(null);
    setRevealed(false);
    setGameDone(!withGame);
    const res = await stylizePhoto(photo);
    if (res.stylized) {
      setReady(res.stylized);
      setProgress(100);
    } else if (res.reason === "no_key") {
      setStatus("nokey");
    } else {
      setStatus("error");
      track("clay_fail", { error: res.error ?? res.reason });
    }
  }

  useEffect(() => {
    if (started.current || stylized) return;
    started.current = true;
    run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reveal when BOTH the AI is ready and the kneading is done (+ a short beat)
  useEffect(() => {
    if (ready && gameDone && !revealed) {
      const t = setTimeout(() => {
        setStylized(ready);
        setReady(null);
        setRevealed(true);
        setStatus("done");
        track("clay_success");
        sparkle();
      }, 900);
      return () => clearTimeout(t);
    }
  }, [ready, gameDone, revealed, setStylized]);

  // kneading in progress (first run)
  if (status === "working" && !gameDone) {
    return (
      <div className="stack center">
        <ClayGame photo={photo} progress={progress} onDone={() => { setGameDone(true); track("clay_game_done"); }} />
      </div>
    );
  }

  // kneading finished but the AI is still cooking (or a redo is running)
  if (status === "working") {
    return (
      <div className="stack center">
        <div className="clay-bar">
          <div className="clay-bar-fill" style={{ width: `${progress}%` }} />
          <span>✨ Clay magic…</span>
        </div>
        <div className="wake-frame">
          <img src={photo} className="wake-media" alt="" style={{ filter: "saturate(1.5) blur(1.4px)" }} />
          <SparkleLoading messages={["The clay is setting…", "Almost there…"]} />
        </div>
      </div>
    );
  }

  return (
    <div className="stack center">
      <p className="lead">✨ Ta-da!</p>
      <div className="style-row">
        <div className="style-card">
          <div className="style-frame">
            {photo ? <img src={photo} alt="original" /> : <div className="eyes-placeholder">🌱</div>}
          </div>
          <span className="style-label">Photo</span>
        </div>
        <span className="style-arrow">→</span>
        <div className="style-card">
          <div className="style-frame">
            {stylized ? <img src={stylized} alt="clay" /> : <div className="eyes-placeholder">🪄</div>}
          </div>
          <span className="style-label">Clay</span>
        </div>
      </div>

      {status === "nokey" && <div className="style-note">🔑 AI key needed — keeping your photo.</div>}
      {status === "error" && <div className="style-note">Oops! Try again or keep the photo.</div>}

      <div className="row">
        <button className="btn-secondary" onClick={onRetake}>📷 Retake</button>
        {(status === "done" || status === "error") && (
          <button className="btn-secondary" onClick={() => run(false)}>🔄 Redo</button>
        )}
        <button className="btn-primary" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}

// Wake step: one Veo clip, budgeted by "magic dust" (2 lives max).
// The child GATHERS ingredients -> GRINDS them into magic dust -> SPRINKLES it to
// give life. Even if the video finishes early, the reveal is HELD (loading) until
// the dust is sprinkled — the sprinkle is what brings the monster to life.
function WakeStep({
  image,
  video,
  setVideo,
  traits,
  setTraits,
  onDone,
}: {
  image: string;
  video: string | null;
  setVideo: (v: string | null) => void;
  traits: string[];
  setTraits: (t: string[]) => void;
  onDone: (hasVideo: boolean) => void;
}) {
  type S = "idle" | "working" | "done" | "nokey" | "error";
  const [status, setStatus] = useState<S>(video ? "done" : "idle");
  const [dust, setDust] = useState(video ? 50 : 100);
  const [ready, setReady] = useState<string | null>(null); // video arrived, waiting for the sprinkle
  const [sprinkled, setSprinkled] = useState(false); // dust has been thrown
  const [revealed, setRevealed] = useState(false); // both done -> show it
  const cancel = useRef({ cancelled: false });
  const hasDust = dust >= 50;
  const needGame = traits.length === 0; // only the first life includes the game

  useEffect(() => () => {
    cancel.current.cancelled = true;
  }, []);

  // reveal only when BOTH the video is ready AND the dust has been sprinkled
  useEffect(() => {
    const sprinkleDone = sprinkled || !needGame;
    if (ready && sprinkleDone && !revealed) {
      setRevealed(true);
      setVideo(ready);
      keepAsset("wake-video", ready); // the moving gallery asset!
      setReady(null);
      setDust((d) => Math.max(0, d - 50));
      setStatus("done");
      track("wake_success");
      sparkle();
    }
  }, [ready, sprinkled, needGame, revealed, setVideo]);

  async function run() {
    if (!hasDust) return;
    setStatus("working");
    setSprinkled(false);
    setRevealed(false);
    track("wake_start");
    pop();
    cancel.current = { cancelled: false };
    const res = await animateMonster(image, () => {}, cancel.current);
    if (res.video) {
      setReady(res.video);
    } else if (res.reason === "no_key") setStatus("nokey");
    else if (res.reason === "cancelled") setStatus("idle");
    else {
      setStatus("error");
      track("wake_fail", { error: res.error ?? res.reason });
    }
  }

  const waitingAfterSprinkle = status === "working" && sprinkled && !revealed;
  const gameOn = status === "working" && needGame && !sprinkled;

  const frame = (
    <div className="wake-frame">
      {video ? (
        <video src={video} className="wake-media" autoPlay loop muted playsInline />
      ) : image ? (
        <img src={image} className="wake-media" alt="" />
      ) : (
        <div className="eyes-placeholder">🌱</div>
      )}
      {status === "working" && (sprinkled ? (
        <div className="dust-shower">
          {Array.from({ length: 14 }).map((_, k) => (
            <span key={k} className="dust-fleck" style={{ left: `${5 + k * 6.5}%`, animationDelay: `${(k % 7) * 0.18}s` }}>✨</span>
          ))}
          <span className="sparkle-msg">Sprinkling magic dust…</span>
        </div>
      ) : (
        <SparkleLoading messages={["Cooking up the magic…", "Almost ready…"]} />
      ))}
    </div>
  );

  const meter = (
    <div className="dust">
      <span className="dust-label">✨ Magic dust</span>
      <div className="dust-bar"><div className="dust-fill" style={{ width: `${dust}%` }} /></div>
    </div>
  );

  // game running: the monster hides backstage — the child dives into the powder game
  if (gameOn) {
    return (
      <div className="stack center">
        <p className="lead">✨ Give it life!</p>
        <DustGame
          onSprinkle={(t) => {
            setTraits(t);
            setSprinkled(true);
            track("dust_sprinkle", { traits: t });
          }}
        />
        <p className="hint-small">Your creature is getting ready backstage… 🎬</p>
      </div>
    );
  }

  return (
    <div className="stack center">
      <p className="lead">✨ Give it life!</p>
      {frame}
      {meter}

      {status === "idle" && (
        <>
          <button className="btn-primary big" onClick={run} disabled={!hasDust}>
            ✨ Make the magic dust!
          </button>
          <button className="btn-ghost" onClick={() => { track("wake_skip"); onDone(false); }}>Skip →</button>
        </>
      )}
      {status === "working" && (
        <p className="hint-small">{waitingAfterSprinkle ? "The magic is working… ✨" : "Almost alive… ✨"}</p>
      )}
      {status === "done" && (
        <div className="row">
          {hasDust && <button className="btn-secondary" onClick={run}>🔄 Again</button>}
          <button className="btn-primary" onClick={() => onDone(true)}>Next →</button>
        </div>
      )}
      {status === "nokey" && (
        <>
          <div className="style-note">🔑 AI key needed — let's add eyes instead.</div>
          <button className="btn-primary" onClick={() => onDone(false)}>Eyes →</button>
        </>
      )}
      {status === "error" && (
        <>
          <div className="style-note">Oops! Try again or skip.</div>
          <div className="row">
            {hasDust && <button className="btn-secondary" onClick={run}>🔄 Retry</button>}
            <button className="btn-primary" onClick={() => onDone(false)}>Skip →</button>
          </div>
        </>
      )}
    </div>
  );
}

function EyesStep({
  photo,
  eyes,
  setEyes,
  onNext,
}: {
  photo: string;
  eyes: { x: number; y: number }[];
  setEyes: (e: { x: number; y: number }[]) => void;
  onNext: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  function onPointerDown(i: number) {
    dragging.current = i;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragging.current === null || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setEyes(eyes.map((p, idx) => (idx === dragging.current ? { x, y } : p)));
  }
  function onPointerUp() {
    dragging.current = null;
  }

  return (
    <div className="stack center">
      <p className="lead">👀 Drag the eyes!</p>
      <div
        ref={boxRef}
        className="eyes-stage"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {photo ? <img src={photo} alt="" className="eyes-photo" /> : <div className="eyes-placeholder">🌱</div>}
        {eyes.map((e, i) => (
          <span
            key={i}
            className="eye draggable"
            style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%` }}
            onPointerDown={() => onPointerDown(i)}
          >
            <span className="pupil" />
          </span>
        ))}
      </div>
      <button className="btn-primary big" onClick={onNext}>Next →</button>
    </div>
  );
}
