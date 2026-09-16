import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { Clip } from "../components/Clip";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import { speak } from "../lib/guide";

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
  type Phase = "match" | "noshow" | "dance" | "dust" | "alive" | "walk";
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
      speak("이제 마법 춤을 출 시간이야! 신나게 움직여서 마법가루를 모아 줘!");
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
          track("build_done", { variant: v });
          onDone();
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
        <p className="lead">🕺 마법 춤을 춰서 채소 친구를 깨워 줘!</p>
        <DanceCharge stream={stream} onFull={danceDone} />
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

// -------- the dance mini-game: the child's own movement charges the magic ----
// Frame-difference motion detection on a tiny canvas — ANY joyful movement
// counts (deliberately forgiving for the special-needs event). Tapping the
// screen also charges it, a gentle trickle starts after a few seconds, so a
// shy or still child is never stuck; a vigorous dancer fills it in ~5s.
const DANCE_PROMPTS = [
  "🙌 손을 높이 들고 흔들어!",
  "🕺 신나게 몸을 흔들흔들!",
  "🐰 폴짝폴짝 뛰어 볼까?",
  "🌀 빙글빙글 돌아 보자!",
];

function DanceCharge({ stream, onFull }: { stream: MediaStream | null; onFull: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const [gauge, setGauge] = useState(0);
  const gaugeRef = useRef(0);
  const doneRef = useRef(false);
  const onFullRef = useRef(onFull);
  onFullRef.current = onFull;
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPromptIdx((i) => (i + 1) % DANCE_PROMPTS.length), 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const v = vRef.current;
    if (v && stream) {
      v.srcObject = stream;
      v.play?.().catch(() => {});
    }
  }, [stream]);

  function charge(amount: number) {
    if (doneRef.current) return;
    gaugeRef.current = Math.min(100, gaugeRef.current + amount);
    setGauge(gaugeRef.current);
    if (gaugeRef.current >= 100) {
      doneRef.current = true;
      onFullRef.current();
    }
  }
  const chargeRef = useRef(charge);
  chargeRef.current = charge;

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;
    const t0 = Date.now();
    const id = setInterval(() => {
      const v = vRef.current;
      if (ctx && v && v.readyState >= 2) {
        ctx.drawImage(v, 0, 0, 64, 48);
        const d = ctx.getImageData(0, 0, 64, 48).data;
        if (prev) {
          let moved = 0;
          const samples = d.length / 16;
          for (let i = 0; i < d.length; i += 16) {
            if (Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) > 40) moved++;
          }
          const frac = moved / samples;
          if (frac > 0.04) chargeRef.current(1.2 + frac * 6);
        }
        prev = d;
      }
      // never a dead end: a slow trickle kicks in, hard-full within ~22s
      if (Date.now() - t0 > 7000) chargeRef.current(0.9);
    }, 140);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="dance-stage" onPointerDown={() => chargeRef.current(6)}>
      <div className="dance-cam-box">
        {stream ? (
          <video ref={vRef} autoPlay playsInline muted className="dance-cam" />
        ) : (
          <div className="dance-cam dance-cam-ph">🥕✨</div>
        )}
        <span className="dance-prompt">{DANCE_PROMPTS[promptIdx]}</span>
      </div>
      <div className="magic-gauge" aria-hidden="true">
        <div className="magic-gauge-fill" style={{ width: `${gauge}%` }} />
        <span className="magic-gauge-label">✨ 마법가루 {Math.round(gauge)}%</span>
      </div>
      <p className="dance-hint">화면을 팡팡 눌러도 마법가루가 모여요!</p>
    </div>
  );
}
