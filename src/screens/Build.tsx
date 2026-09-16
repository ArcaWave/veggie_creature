import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { Clip } from "../components/Clip";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import { speak } from "../lib/guide";
import { getPoseLandmarker, NOSE, L_WRIST, R_WRIST, L_SHOULDER, R_SHOULDER } from "../lib/pose";

// "Show it to the camera and it comes alive."
// The station runs WITHOUT staff: big on-screen guidance + spoken Korean
// prompts, the camera counts down and snaps by itself, and if the AI can't
// see a creation in the shot it kindly asks the child to hold it closer and
// retries on its own (never a dead end — after 2 retries the show goes on
// with the best guess). Small Retake escape hatch only.
type Step = "photo" | "magic";

const COUNTDOWN_S = 6; // time to hold the creature up before the auto-snap
const MAX_RETRIES = 2; // "hold it closer" loops before we just go with it

export function Build({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState("");
  const [tries, setTries] = useState(0);

  // -------- camera with auto countdown snap --------
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  // the stream is kept alive through the magic step too — the dance mini-game
  // watches the child move — and only stops on unmount / retake
  useEffect(() => {
    let cancelled = false;
    setCamError(null);

    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setCamError(window.isSecureContext ? "카메라가 없어요 — 사진을 업로드해 주세요!" : "카메라는 https 주소에서 열 수 있어요.");
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
          NotAllowedError: "카메라가 막혀 있어요 — 허용 후 다시 시도!",
          NotFoundError: "카메라가 없어요 — 사진을 업로드해 주세요!",
          NotReadableError: "다른 앱이 카메라를 쓰고 있어요.",
        };
        setCamError(byName[err?.name] || "카메라가 잠깐 말썽이에요 — 다시 시도!");
        setCamOn(false);
      });

    return () => {
      cancelled = true;
      stopCam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camTry]);

  // bind the stream after the <video> renders (prevents a black screen).
  // keyed on step/camTry too: coming back from the magic step remounts the
  // <video> without camOn ever toggling, and it must be re-bound.
  useEffect(() => {
    const v = videoRef.current;
    if (camOn && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play?.().catch(() => {});
    }
  }, [camOn, step, camTry]);

  // the countdown starts as soon as the camera is live, then snaps by itself
  useEffect(() => {
    if (!camOn || step !== "photo") {
      setCount(null);
      return;
    }
    // (retries were already prompted by the noshow screen's voice line)
    if (tries === 0) speak("내가 만든 채소 친구를 화면 가운데에 보여 줘! 곧 사진을 찍을 거야!");
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
    if (!v || v.readyState < 2) {
      // camera wasn't ready at snap time — restart it instead of stranding
      setCamTry((t) => t + 1);
      return;
    }
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
    setTries(0);
    setStep("photo");
    setCamTry((t) => t + 1);
  }

  // the AI saw no creation in the shot — ask (with a voice) and reshoot
  function retryCloser() {
    track("match_retry", { tries: tries + 1 });
    setPhoto("");
    setTries((t) => t + 1);
    setStep("photo");
    setCamTry((t) => t + 1);
  }

  if (step === "magic") {
    return (
      <MagicStep
        photo={photo}
        stream={streamRef.current}
        tries={tries}
        onRetake={retake}
        onRetryCloser={retryCloser}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="screen">
      <div className="stack center">
        <p className="lead">
          {tries > 0 ? "🥕 조금만 더 가까이 보여줄래요?" : "📸 내가 만든 채소 친구를 카메라에 보여주세요!"}
        </p>
        <div className="camera-box">
          {camOn ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="camera" />
              <div className="guide-zone" aria-hidden="true">
                <span className="guide-label">여기에 보여 줘!</span>
              </div>
              {count !== null && count > 0 && <span className="count-badge">{count}</span>}
            </>
          ) : (
            <div className="camera placeholder">
              <img src="/camera-cover.jpg" alt="" className="cover-bg" />
              <span>📷</span>
              <p>{camError ?? "카메라 켜는 중…"}</p>
            </div>
          )}
        </div>
        {!camOn && camError && (
          <button className="btn-secondary" onClick={() => { stopCam(); setCamTry((t) => t + 1); }}>
            📷 다시 시도
          </button>
        )}
        <label className="btn-ghost">
          🖼️ 사진으로 올리기
          <input type="file" accept="image/*" onChange={onFile} hidden />
        </label>
      </div>
    </div>
  );
}

// -------- the automated magic: photo -> match -> dust -> ALIVE -> walk off ---
// No runtime generation: the scan photo is matched (one cheap vision call, ~2s)
// against the PRE-MADE variant library, dust falls for a moment of theatre, the
// creature bursts alive, waves for a beat — then stomps off the RIGHT edge of
// the screen into the Digital World, and the station resets.
function MagicStep({
  photo,
  stream,
  tries,
  onRetake,
  onRetryCloser,
  onDone,
}: {
  photo: string;
  stream: MediaStream | null;
  tries: number;
  onRetake: () => void;
  onRetryCloser: () => void;
  onDone: () => void;
}) {
  type Phase = "match" | "noshow" | "dance" | "dust" | "alive" | "walk" | "sendoff";
  const [phase, setPhase] = useState<Phase>("match");
  const [variant, setVariant] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timersRef.current.push(window.setTimeout(fn, ms));

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => { aliveRef.current = false; timers.forEach(clearTimeout); };
  }, []);

  // 1) which pre-made creature does this creation resemble?
  // no run-once ref: StrictMode's dev double-mount would strand the live run.
  useEffect(() => {
    (async () => {
      track("match_start");
      const RANDOM = ["carrot", "broccoli", "tomato", "potato", "cucumber", "eggplant", "corn", "cauliflower"];
      let v = RANDOM[Math.floor(Math.random() * RANDOM.length)];
      try {
        const r = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: photo }),
        });
        const j = await r.json();
        // nothing visible in the shot? ask the child to hold it closer and
        // reshoot (twice at most — then the show goes on with the best guess)
        if (j.none && tries < MAX_RETRIES) {
          if (!aliveRef.current) return;
          track("match_none", { tries });
          speak("어라? 채소 친구가 잘 안 보여! 조금만 더 가까이 보여줄래? 다시 찍어 보자!");
          setPhase("noshow");
          later(onRetryCloser, 2800);
          return;
        }
        if (typeof j.variant === "string" && j.variant) v = j.variant;
        else if (typeof j.best === "string" && j.best) v = j.best;
        track("match_done", { variant: v, matched: j.matched ?? false });
      } catch {
        track("match_fail");
      }
      if (!aliveRef.current) return;
      setVariant(v);
      // 2) the dance mini-game: the child's own moves charge the magic
      setPhase("dance");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) gauge full -> dust -> 4) ALIVE -> 5) walks off right
  const variantRef = useRef<string | null>(null);
  variantRef.current = variant;
  const danceDoneRef = useRef(false);
  function danceDone() {
    if (!aliveRef.current || danceDoneRef.current) return;
    danceDoneRef.current = true;
    const v = variantRef.current ?? "carrot";
    track("dance_done", { variant: v });
    setPhase("dust");
    speak("우와! 마법가루가 가득 모였어! 마법가루가 내려온다!");
    later(() => {
      setPhase("alive");
      magicDustBurst(frameRef.current);
      sparkle();
      speak("채소 친구가 살아났어!");
      later(() => {
        setPhase("walk");
        speak("디지털 세계로 출발! 큰 화면에서 다시 만나!");
        track("walk_off", { variant: v });
        // the creature leaves this screen — announce it to the Digital World
        fetch("/api/creatures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant: v }),
        }).catch(() => {});
        later(() => {
          // tell the child where to go next — then reset for the next family
          setPhase("sendoff");
          speak("옆에 있는 디지털 마을 화면에서 네 친구를 확인해 봐!");
          later(() => {
            track("build_done", { variant: v });
            onDone();
          }, 5000);
        }, 5200); // walk duration + a breath
      }, 3200);
    }, 1600);
  }

  if (phase === "noshow") {
    return (
      <div className="screen center-screen" style={{ alignItems: "center" }}>
        <p className="lead">🔍 어라? 채소 친구가 잘 안 보여요!</p>
        <div className="noshow-card">
          <span className="noshow-emoji">🥕🙌</span>
          <p>조금만 더 <b>가까이</b>, 화면 <b>가운데</b>에 보여줄래요?</p>
          <p className="noshow-sub">잠시 후에 다시 찍어요…</p>
        </div>
      </div>
    );
  }

  if (phase === "dance") {
    return (
      <div className="screen center-screen" style={{ alignItems: "center" }}>
        <p className="lead">🕺 마법 동작으로 채소 친구를 깨워 줘!</p>
        <DanceCharge stream={stream} onFull={danceDone} />
      </div>
    );
  }

  if (phase === "sendoff") {
    return (
      <div className="screen center-screen" style={{ alignItems: "center" }}>
        <div className="sendoff-card">
          <span className="sendoff-emoji" aria-hidden="true">🏘️</span>
          <p className="sendoff-title">디지털 마을로 떠났어요!</p>
          <p className="sendoff-sub">
            옆 화면 <span className="sendoff-arrow">👉</span> 디지털 마을에서<br />네 친구를 확인해 봐!
          </p>
        </div>
      </div>
    );
  }

  if (phase === "walk" && variant) {
    return (
      <div className="screen center-screen" style={{ alignItems: "center" }}>
        <p className="lead">🌏 디지털 세계로 출발!</p>
        <div className="walk-stage">
          <div className="walker">
            <img src={`/variants/${variant}.smile.gif`} alt="" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen center-screen" style={{ alignItems: "center" }}>
      <p className="lead">
        {phase === "match" ? "✨ 마법을 읽는 중…" : phase === "dust" ? "✨ 마법가루를 뿌리는 중…" : "🎉 살아났다!"}
      </p>

      <div className={`wake-frame${phase === "alive" && variant ? " reveal-pop" : ""}`} ref={frameRef}>
        {phase === "alive" && variant ? (
          // fit (not cover): the square clip must show the WHOLE creature —
          // sprout hat to feet — inside the wide reveal frame
          <Clip src={`/variants/${variant}.greet.gif`} className="wake-media fit" />
        ) : (
          <img
            src={photo}
            className="wake-media"
            alt=""
            style={phase === "match" ? { filter: "saturate(1.4) blur(1.2px)" } : undefined}
          />
        )}
        {phase === "match" && <SparkleLoading messages={["넌 누구니…?", "마법을 느끼는 중…"]} />}
        {phase === "dust" && (
          <div className="dust-shower">
            {Array.from({ length: 14 }).map((_, k) => (
              <span key={k} className="dust-fleck" style={{ left: `${5 + k * 6.5}%`, animationDelay: `${(k % 7) * 0.18}s` }}>✨</span>
            ))}
            <span className="sparkle-msg">마법가루가 내려와요…</span>
          </div>
        )}
      </div>

      {phase !== "alive" && (
        <button className="btn-ghost" onClick={onRetake}>📷 다시 찍기</button>
      )}
    </div>
  );
}

// -------- the dance mini-game: one move per SCENE wakes the creature -------
// Scene 1: JUMP (hip height dips above its rolling baseline). Scene 2: raise
// both hands (만세). A "따라 해 봐!" demo card animates the move beside the
// big camera view, the recognised child gets a glowing outline, and clearing
// a scene pops a 통과! splash before the next scene slides in.
// Deliberately forgiving: taps charge, a trickle starts after 10s, each scene
// hard-completes by ~20s, and plain motion detection takes over if the pose
// model cannot load.
const DEBUG_POSE = new URLSearchParams(location.search).has("posedebug");
function drawDebug(rise: number) {
  let el = document.getElementById("posedebug");
  if (!el) {
    el = document.createElement("div");
    el.id = "posedebug";
    el.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:99;background:rgba(0,0,0,0.75);color:#0f0;font:700 20px monospace;padding:8px 14px;border-radius:10px;pointer-events:none;";
    document.body.appendChild(el);
  }
  el.textContent = `rise ${(rise * 100).toFixed(1)}%  (jump at 4.5%)`;
  el.style.color = rise > 0.045 ? "#ff0" : "#0f0";
}

const SCENES = [
  { prompt: "🐰 폴짝폴짝! 점프 두 번!", voice: "폴짝폴짝, 점프해 볼까?", demo: "jump" },
  { prompt: "🙌 두 손 번쩍! 만세~!", voice: "이번엔 두 손 다 번쩍! 만세 해 볼까?", demo: "manse" },
];

function DanceCharge({ stream, onFull }: { stream: MediaStream | null; onFull: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [gauge, setGauge] = useState(0);
  const [scene, setScene] = useState(0);
  const [cleared, setCleared] = useState(false);
  const gaugeRef = useRef(0);
  const sceneRef = useRef(0);
  const sceneT0 = useRef(Date.now());
  const clearedRef = useRef(false);
  const doneRef = useRef(false);
  const hipBase = useRef(0);
  const lastJump = useRef(0);
  const onFullRef = useRef(onFull);
  onFullRef.current = onFull;

  useEffect(() => {
    speak(SCENES[0].voice);
  }, []);

  useEffect(() => {
    const v = vRef.current;
    if (v && stream) {
      v.srcObject = stream;
      v.play?.().catch(() => {});
    }
  }, [stream]);

  function charge(amount: number) {
    if (doneRef.current || clearedRef.current) return;
    gaugeRef.current = Math.min(100, gaugeRef.current + amount);
    setGauge(gaugeRef.current);
    if (gaugeRef.current < 100) return;
    // scene cleared! pop the splash, then the next scene (or the finale)
    sparkle();
    if (sceneRef.current < SCENES.length - 1) {
      clearedRef.current = true;
      setCleared(true);
      setTimeout(() => {
        sceneRef.current += 1;
        sceneT0.current = Date.now();
        gaugeRef.current = 0;
        hipBase.current = 0;
        clearedRef.current = false;
        setGauge(0);
        setScene(sceneRef.current);
        setCleared(false);
        speak(SCENES[sceneRef.current].voice);
      }, 1300);
    } else {
      doneRef.current = true;
      onFullRef.current();
    }
  }
  const chargeRef = useRef(charge);
  chargeRef.current = charge;

  useEffect(() => {
    let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
    let stopped = false;
    getPoseLandmarker()
      .then((l) => { if (!stopped) landmarker = l; })
      .catch(() => { /* fallback below keeps working */ });

    // motion-diff fallback (used until/unless the pose model is ready)
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = 64;
    diffCanvas.height = 48;
    const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;

    const id = setInterval(() => {
      const v = vRef.current;
      if (v && v.readyState >= 2) {
        if (landmarker) {
          try {
            const res = landmarker.detectForVideo(v, performance.now());
            const poses = res.landmarks ?? [];
            // the MAIN child = the largest body in frame (closest to camera)
            let main = -1, mainArea = 0;
            const boxes = poses.map((lm, i) => {
              let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
              for (const p of lm) {
                if (p.x < x0) x0 = p.x;
                if (p.y < y0) y0 = p.y;
                if (p.x > x1) x1 = p.x;
                if (p.y > y1) y1 = p.y;
              }
              const area = (x1 - x0) * (y1 - y0);
              if (area > mainArea) { mainArea = area; main = i; }
              return { x0, y0, x1, y1 };
            });
            drawOverlay(v, boxes, main);
            if (main >= 0) {
              const lm = poses[main];
              const vis = (i: number) => (lm[i].visibility ?? 1) > 0.4;
              if (sceneRef.current === 0) {
                // JUMP: shoulders rising sharply above their rolling standing
                // level (shoulders, unlike hips, are practically always in
                // frame and tracked confidently)
                if (vis(L_SHOULDER) && vis(R_SHOULDER)) {
                  const bodyY = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2;
                  const b = hipBase.current || bodyY;
                  hipBase.current = bodyY > b ? bodyY : b + (bodyY - b) * 0.04;
                  const rise = hipBase.current - bodyY;
                  if (DEBUG_POSE) drawDebug(rise);
                  if (rise > 0.045 && Date.now() - lastJump.current > 650) {
                    lastJump.current = Date.now();
                    chargeRef.current(50); // two jumps clear the scene
                  }
                }
              } else if (vis(NOSE) && vis(L_WRIST) && vis(R_WRIST)) {
                const headY = lm[NOSE].y - 0.03;
                const up = (lm[L_WRIST].y < headY ? 1 : 0) + (lm[R_WRIST].y < headY ? 1 : 0);
                if (up >= 2) chargeRef.current(8); // hold 만세 ~1.5s
              }
            }
          } catch { /* one bad frame — skip */ }
        } else if (diffCtx) {
          diffCtx.drawImage(v, 0, 0, 64, 48);
          const d = diffCtx.getImageData(0, 0, 64, 48).data;
          if (prev) {
            let moved = 0;
            for (let i = 0; i < d.length; i += 16) {
              if (Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) > 40) moved++;
            }
            if (moved / (d.length / 16) > 0.04) chargeRef.current(3);
          }
          prev = d;
        }
      }
      // never a dead end: per-scene trickle, hard-full within ~20s
      const held = Date.now() - sceneT0.current;
      if (held > 10000) chargeRef.current(1);
      if (held > 20000) chargeRef.current(5);
    }, 90);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  // glowing outline around the recognised child (thin white for the others).
  // the video is mirrored via CSS, so x-coords are mirrored to match.
  function drawOverlay(v: HTMLVideoElement, boxes: { x0: number; y0: number; x1: number; y1: number }[], main: number) {
    const c = overlayRef.current;
    if (!c) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    // object-fit: cover mapping from video frame -> displayed box
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
    boxes.forEach((b, i) => {
      const pad = 0.05;
      const x0 = ox + Math.max(0, b.x0 - pad) * v.videoWidth * s;
      const x1 = ox + Math.min(1, b.x1 + pad) * v.videoWidth * s;
      const y0 = oy + Math.max(0, b.y0 - pad) * v.videoHeight * s;
      const y1 = oy + Math.min(1, b.y1 + pad) * v.videoHeight * s;
      const mx0 = cw - x1, mx1 = cw - x0; // mirror to match the mirrored video
      ctx.beginPath();
      ctx.roundRect(mx0, y0, mx1 - mx0, y1 - y0, 22);
      if (i === main) {
        const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 220);
        ctx.lineWidth = 6;
        ctx.strokeStyle = `rgba(242, 165, 55, ${pulse})`;
        ctx.shadowColor = "rgba(255, 190, 60, 0.9)";
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✨", (mx0 + mx1) / 2, Math.max(30, y0 - 10));
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
    });
  }

  const sc = SCENES[scene];
  return (
    <div className="dance-stage" onPointerDown={() => chargeRef.current(6)}>
      <div className="dance-cam-box">
        {stream ? (
          <>
            <video ref={vRef} autoPlay playsInline muted className="dance-cam" />
            <canvas ref={overlayRef} className="dance-overlay" />
          </>
        ) : (
          <div className="dance-cam dance-cam-ph">🥕✨</div>
        )}
        <span className="dance-scene-no">{scene + 1} / {SCENES.length}</span>
        <div className="dance-demo">
          <span className={`demo-fig demo-${sc.demo}`} aria-hidden="true">
            {sc.demo === "jump" ? "🐰" : <><span className="fa">🧍</span><span className="fb">🙌</span></>}
          </span>
          <span className="demo-label">따라 해 봐!</span>
        </div>
        <span className="dance-prompt">{sc.prompt}</span>
        {cleared && <div className="dance-clear">통과! 🎉</div>}
      </div>
      <div className="magic-gauge" aria-hidden="true">
        <div className="magic-gauge-fill" style={{ width: `${gauge}%` }} />
        <span className="magic-gauge-label">✨ 마법가루 {Math.round(gauge)}%</span>
      </div>
      <p className="dance-hint">화면을 팡팡 눌러도 마법가루가 모여요!</p>
    </div>
  );
}
