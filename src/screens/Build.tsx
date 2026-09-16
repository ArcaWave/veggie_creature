import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { Clip } from "../components/Clip";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import { ensureProfile } from "../lib/profile";
import { speak } from "../lib/guide";
import { getPoseLandmarker, NOSE, L_WRIST, R_WRIST, L_SHOULDER, R_SHOULDER } from "../lib/pose";

// "Step up to the magic mirror and your creature comes alive."
// The station is an ALWAYS-ON attract screen: a cinematic courtyard with the
// live camera in a round mirror portal. No buttons — pose tracking notices a
// child standing close (shoulders in view, big enough) and, after a short
// steady dwell, counts 3-2-1 and snaps by itself. If the AI can't see a
// creation in the shot it asks to hold it closer and reshoots (never a dead
// end). The camera stream lives for the whole day; nothing ever restarts it
// between visitors.
type Step = "photo" | "magic";

const COUNTDOWN_S = 3; // after presence is confirmed
const DWELL_MS = 2200; // steady presence needed before the countdown arms
const MAX_RETRIES = 2; // "hold it closer" loops before we just go with it
const CINE_BG = "/main-bg.png";

const DEBUG_POSE = new URLSearchParams(location.search).has("posedebug");
function debugLine(text: string, hot = false) {
  let el = document.getElementById("posedebug");
  if (!el) {
    el = document.createElement("div");
    el.id = "posedebug";
    el.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:99;background:rgba(0,0,0,0.75);color:#0f0;font:700 20px monospace;padding:8px 14px;border-radius:10px;pointer-events:none;";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.color = hot ? "#ff0" : "#0f0";
}
function drawDebug(rise: number) {
  debugLine(`rise ${(rise * 100).toFixed(1)}%  (jump at 4.5%)`, rise > 0.045);
}

// drifting leaves + embers over the courtyard (fixed at module load so the
// attract loop never re-randomises mid-day)
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  kind: i % 3 === 2 ? "ember" : "leaf",
  left: (i * 61) % 100,
  size: 14 + ((i * 37) % 22),
  dur: 14 + ((i * 53) % 14),
  delay: -((i * 29) % 20),
  drift: ((i * 17) % 9) - 4,
}));

// the cinematic stage every screen sits on: courtyard, slow drift, vignette
function Cine({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`cine${dim ? " dim" : ""}`}>
      <div className="cine-bg" style={{ backgroundImage: `url(${CINE_BG})` }} />
      <div className="cine-vignette" />
      <div className="cine-particles" aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className={`cine-particle ${p.kind}`}
            style={{
              left: `${p.left}vw`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              // @ts-expect-error css var
              "--drift": `${p.drift}vw`,
            }}
          >
            {p.kind === "leaf" && (
              <svg viewBox="0 0 24 24"><path d="M12 2 C 19 6, 21 13, 12 22 C 3 13, 5 6, 12 2 Z" /><path className="vein" d="M12 5 L12 19" /></svg>
            )}
          </span>
        ))}
      </div>
      <div className="cine-content">{children}</div>
    </div>
  );
}

// a magic-step screen: dimmed courtyard behind glass panels
function CineScreen({ children }: { children: React.ReactNode }) {
  return (
    <Cine dim>
      <div className="cine-screen">{children}</div>
    </Cine>
  );
}

export function Build({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState("");
  const [tries, setTries] = useState(0);

  // -------- the always-on camera --------
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  // presence: a child standing close and steady arms the countdown
  const [dwell, setDwell] = useState(0); // 0..1
  const dwellRef = useRef(0);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  // after a show the mirror waits for the frame to EMPTY for a moment, so the
  // same child lingering in front doesn't restart it — the next child steps up
  const needClearRef = useRef(false);
  const clearSinceRef = useRef(0);
  const [waitingClear, setWaitingClear] = useState(false);
  function disarm(requireClear = false) {
    armedRef.current = false;
    dwellRef.current = 0;
    setArmed(false);
    setDwell(0);
    needClearRef.current = requireClear;
    clearSinceRef.current = 0;
    setWaitingClear(requireClear);
  }

  useEffect(() => {
    let cancelled = false;
    setCamError(null);

    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setCamError(window.isSecureContext ? "카메라가 없어요 — 사진을 업로드해 주세요!" : "카메라는 https 주소에서 열 수 있어요.");
      return;
    }

    md.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
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

  // (re)bind the stream whenever the <video> (re)mounts
  useEffect(() => {
    const v = videoRef.current;
    if (camOn && v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.play?.().catch(() => {});
    }
  }, [camOn, step, camTry]);

  // presence watcher: pose tracking on the mirror. A person whose shoulders
  // are in view and who fills enough of the frame counts as "standing here";
  // dwell fills over DWELL_MS while they stay, drains when they leave.
  // Without a pose model (load failure) the mirror simply arms after a while.
  useEffect(() => {
    if (!camOn || step !== "photo") return;
    let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
    let stopped = false;
    let modelFailed = false;
    const t0 = Date.now();
    getPoseLandmarker()
      .then((l) => { if (!stopped) landmarker = l; })
      .catch(() => { modelFailed = true; });
    let last = Date.now();
    let lastDetect = 0;
    let lastPresent = false;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = Date.now();
      const dt = now - last;
      last = now;
      if (armedRef.current) return;
      const v = videoRef.current;
      // inference runs at ~30fps; between runs the last verdict holds
      if (v && v.readyState >= 2 && now - lastDetect >= 33) {
        lastDetect = now;
        if (landmarker) {
          try {
            const res = landmarker.detectForVideo(v, performance.now());
            lastPresent = (res.landmarks ?? []).some((lm) => {
              const shoulders = (lm[L_SHOULDER].visibility ?? 1) > 0.5 && (lm[R_SHOULDER].visibility ?? 1) > 0.5;
              let y0 = 1, y1 = 0;
              for (const q of lm) { if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
              return shoulders && y1 - y0 > 0.3;
            });
          } catch { /* skip frame */ }
        } else if (modelFailed || now - t0 > 8000) {
          lastPresent = true;
        }
      }
      const present = lastPresent;
      if (needClearRef.current) {
        if (present) clearSinceRef.current = 0;
        else if (!clearSinceRef.current) clearSinceRef.current = now;
        else if (now - clearSinceRef.current > 1500) { needClearRef.current = false; setWaitingClear(false); }
        return;
      }
      dwellRef.current = Math.max(0, Math.min(1, dwellRef.current + (present ? dt / DWELL_MS : -dt / 900)));
      setDwell(dwellRef.current);
      if (DEBUG_POSE) debugLine(`model ${landmarker ? "ok" : modelFailed ? "FAILED" : "loading"}  present ${present}  dwell ${(dwellRef.current * 100).toFixed(0)}%`);
      if (dwellRef.current >= 1) {
        armedRef.current = true;
        setArmed(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn, step, camTry]);

  // once armed: 3-2-1, then snap by itself
  useEffect(() => {
    if (!armed || !camOn || step !== "photo") {
      setCount(null);
      return;
    }
    if (tries === 0) speak("좋아요, 그대로! 셋, 둘, 하나!");
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
  }, [armed, camOn, step, camTry]);

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  function capture() {
    const v = videoRef.current;
    if (!v || v.readyState < 2) {
      // camera wasn't ready at snap time — restart it instead of stranding
      disarm();
      setCamTry((t) => t + 1);
      return;
    }
    ensureProfile(); // silent session profile keys rate limits & saves
    sparkle();
    setFlash(true);
    setTimeout(() => setFlash(false), 500);
    // WYSIWYG: crop what the (object-fit: cover) mirror shows
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

  // back to the mirror WITHOUT touching the camera stream
  function backToMirror(nextTries: number, requireClear = false) {
    setPhoto("");
    setTries(nextTries);
    disarm(requireClear);
    setStep("photo");
  }
  function retake() {
    track("photo_retake");
    backToMirror(0);
  }
  // the AI saw no creation in the shot — ask and reshoot
  function retryCloser() {
    track("match_retry", { tries: tries + 1 });
    backToMirror(tries + 1);
  }
  function finish() {
    onDone();
    backToMirror(0, true);
  }

  if (step === "magic") {
    return (
      <MagicStep
        photo={photo}
        stream={streamRef.current}
        tries={tries}
        onRetake={retake}
        onRetryCloser={retryCloser}
        onDone={finish}
      />
    );
  }

  const caption =
    count !== null && count > 0 ? "그대로 있어 주세요"
    : tries > 0 ? "채소 친구가 잘 보이지 않았어요 — 조금 더 가까이 보여 주세요"
    : waitingClear ? "다음 친구는 잠시 후에 거울 앞에 서 주세요"
    : dwell > 0.05 ? "좋아요, 잠시만 그대로"
    : "채소 친구를 들고 거울 앞에 서 주세요";

  return (
    <Cine>
      <header className="cine-head">
        <p className="cine-eyebrow">몽글몽글 가을 놀이터</p>
        <h1 className="cine-title">채소 친구를 깨우는 마법 거울</h1>
      </header>

      <div className={`portal${dwell > 0.05 ? " sensing" : ""}${armed ? " armed" : ""}`}>
        <svg className="portal-ring" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
          <rect className="ring-track" x="1" y="1" width="158" height="88" rx="7" pathLength="100" />
          <rect className="ring-fill" x="1" y="1" width="158" height="88" rx="7" pathLength="100" style={{ strokeDashoffset: 100 * (1 - dwell) }} />
        </svg>
        <div className="portal-clip">
          {camOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="portal-cam" />
          ) : (
            <div className="portal-ph">
              <p>{camError ?? "거울을 깨우는 중"}</p>
            </div>
          )}
          {count !== null && count > 0 && <span className="portal-count">{count}</span>}
          {flash && <div className="portal-flash" />}
        </div>
      </div>

      <p className="cine-caption">{caption}</p>

      {!camOn && camError && (
        <button className="btn-glass" onClick={() => { stopCam(); setCamTry((t) => t + 1); }}>
          다시 시도
        </button>
      )}
      <label className="cine-upload">
        사진으로 올리기
        <input type="file" accept="image/*" onChange={onFile} hidden />
      </label>
    </Cine>
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
      <CineScreen>
        <p className="lead">채소 친구가 잘 보이지 않아요</p>
        <div className="noshow-card">
                    <p>조금 더 <b>가까이</b>, 화면 <b>가운데</b>에 보여 주세요</p>
          <p className="noshow-sub">잠시 후 다시 찍습니다</p>
        </div>
      </CineScreen>
    );
  }

  if (phase === "dance") {
    return (
      <CineScreen>
        <p className="lead">마법 동작으로 채소 친구를 깨워 주세요</p>
        <DanceCharge stream={stream} onFull={danceDone} />
      </CineScreen>
    );
  }

  if (phase === "sendoff") {
    return (
      <CineScreen>
        <div className="sendoff-card">
                    <p className="sendoff-title">디지털 마을로 떠났어요</p>
          <p className="sendoff-sub">
            옆 화면 <span className="sendoff-arrow">→</span> 디지털 마을에서<br />내 친구를 만나 보세요
          </p>
        </div>
      </CineScreen>
    );
  }

  if (phase === "walk" && variant) {
    return (
      <CineScreen>
        <p className="lead">디지털 마을로 떠나요</p>
        <div className="walk-stage">
          <div className="walker">
            <img src={`/variants/${variant}.smile.gif`} alt="" />
          </div>
        </div>
      </CineScreen>
    );
  }

  return (
    <CineScreen>
      <p className="lead">
        {phase === "match" ? "채소 친구를 읽고 있어요" : phase === "dust" ? "마법가루가 내려와요" : "깨어났어요"}
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
    </CineScreen>
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
const SCENES = [
  { prompt: "폴짝폴짝, 점프 두 번", voice: "폴짝폴짝, 점프해 볼까?", demo: "jump" },
  { prompt: "두 손을 번쩍, 만세", voice: "이번엔 두 손 다 번쩍! 만세 해 볼까?", demo: "manse" },
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
    const smoothBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    getPoseLandmarker()
      .then((l) => { if (!stopped) landmarker = l; })
      .catch(() => { /* fallback below keeps working */ });

    // motion-diff fallback (used until/unless the pose model is ready)
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = 64;
    diffCanvas.height = 48;
    const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;

    let raf = 0;
    let lastDetect = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = vRef.current;
      const now = Date.now();
      if (v && v.readyState >= 2 && now - lastDetect >= 33) {
        lastDetect = now;
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
              // ease toward the fresh box so the outline glides instead of jittering
              const prev = smoothBoxes[i];
              const k = 0.35;
              const b = prev
                ? { x0: prev.x0 + (x0 - prev.x0) * k, y0: prev.y0 + (y0 - prev.y0) * k, x1: prev.x1 + (x1 - prev.x1) * k, y1: prev.y1 + (y1 - prev.y1) * k }
                : { x0, y0, x1, y1 };
              smoothBoxes[i] = b;
              return b;
            });
            smoothBoxes.length = poses.length;
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
                if (up >= 2) chargeRef.current(2.4); // hold 만세 ~1.5s at 30fps
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
            if (moved / (d.length / 16) > 0.04) chargeRef.current(0.9);
          }
          prev = d;
        }
      }
      // never a dead end: per-scene trickle, hard-full within ~20s
      // (per-frame now, so scale the per-tick amounts to ~per-90ms)
      const held = Date.now() - sceneT0.current;
      if (held > 10000) chargeRef.current(0.3);
      if (held > 20000) chargeRef.current(1.5);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
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
        <span className="dance-scene-no">{scene + 1} <em>/ {SCENES.length}</em></span>
        <div className="dance-demo">
          <span className={`demo-fig demo-${sc.demo}`} aria-hidden="true">
            {sc.demo === "jump" ? (
              <svg viewBox="0 0 60 80" className="fig">
                <circle cx="30" cy="14" r="8" />
                <path d="M30 22 V48 M30 30 L14 40 M30 30 L46 40 M30 48 L18 70 M30 48 L42 70" />
                <path className="fig-ground" d="M8 76 H52" />
              </svg>
            ) : (
              <svg viewBox="0 0 60 80" className="fig">
                <circle cx="30" cy="14" r="8" />
                <path d="M30 22 V50 M30 50 L18 72 M30 50 L42 72" />
                <path className="fa" d="M30 30 L14 44 M30 30 L46 44" />
                <path className="fb" d="M30 30 L14 10 M30 30 L46 10" />
              </svg>
            )}
          </span>
          <span className="demo-label">따라 해 보세요</span>
        </div>
        <span className="dance-prompt">{sc.prompt}</span>
        {cleared && <div className="dance-clear">통과</div>}
      </div>
      <div className="magic-gauge" aria-hidden="true">
        <div className="magic-gauge-fill" style={{ width: `${gauge}%` }} />
        <span className="magic-gauge-label">마법가루 {Math.round(gauge)}%</span>
      </div>
      <p className="dance-hint">화면을 두드려도 마법가루가 모여요</p>
    </div>
  );
}
