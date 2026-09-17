import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import { speak } from "../lib/guide";
import { getCamera, releaseCamera, cameraErrorText, snapshot } from "../lib/camera";
import { DanceCharge } from "../components/DanceCharge";
import { Figure, randomParts, type Parts } from "../components/Figure";
import { CamFrame } from "../components/CamFrame";

// "Show it to the camera and it comes alive."
// The station runs WITHOUT staff: the welcome mirror usually takes the photo
// by itself (initialPhoto), so this screen starts straight at the magic. The
// photo step remains for the "hold it closer" reshoot and the staff fallback:
// big on-screen guidance, the camera counts down and snaps by itself, and if
// the AI can't see a creation in the shot it kindly asks the child to hold it
// closer and retries on its own (never a dead end — after 2 retries the show
// goes on with the best guess). Small Retake escape hatch only.
type Step = "photo" | "magic";

const COUNTDOWN_S = 6; // time to hold the creature up before the auto-snap
const MAX_RETRIES = 2; // "hold it closer" loops before we just go with it
const MATCH_TIMEOUT_MS = 20000; // matcher deadline before the show goes on regardless

export function Build({ onDone, initialPhoto = "" }: { onDone: () => void; initialPhoto?: string }) {
  const [step, setStep] = useState<Step>(initialPhoto ? "magic" : "photo");
  const [photo, setPhoto] = useState(initialPhoto);
  const [tries, setTries] = useState(0);

  // -------- camera with auto countdown snap --------
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  // the shared kiosk stream: the dance mini-game watches the child through it
  // too, and the welcome mirror takes it back afterwards — so it is never
  // stopped here, only re-acquired when the camera itself failed (camTry).
  // camOn drops to false meanwhile so the <video> re-binds when it returns.
  useEffect(() => {
    let cancelled = false;
    setCamError(null);
    if (camTry > 0) {
      releaseCamera();
      setCamOn(false);
    }
    getCamera()
      .then((stream) => {
        if (cancelled) return;
        streamRef.current = stream;
        setCamOn(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setCamError(cameraErrorText(err));
        setCamOn(false);
      });
    return () => {
      cancelled = true;
      streamRef.current = null;
    };
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

  function capture() {
    const v = videoRef.current;
    if (!v || v.readyState < 2) {
      // camera wasn't ready at snap time — restart it instead of stranding
      setCamTry((t) => t + 1);
      return;
    }
    sparkle();
    const url = snapshot(v);
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

  // (back to the photo step re-mounts the <video>; the bind effect above
  // attaches the still-running stream — no camera restart needed)
  function retake() {
    track("photo_retake");
    setPhoto("");
    setTries(0);
    setStep("photo");
  }

  // the AI saw no creation in the shot — ask (with a voice) and reshoot
  function retryCloser() {
    track("match_retry", { tries: tries + 1 });
    setPhoto("");
    setTries((t) => t + 1);
    setStep("photo");
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
        <CamFrame className="camera-box">
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
        </CamFrame>
        {!camOn && camError && (
          <button className="btn-secondary" onClick={() => setCamTry((t) => t + 1)}>
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
// to a body vegetable AND the sticker parts on it; the PRE-MADE figure for
// that part set (the same art the Digital Village uses) bursts alive, waves
// for a beat — then stomps off the RIGHT edge of the screen into the Digital
// World with its part set, and the station resets.
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
  const [parts, setParts] = useState<Parts | null>(null);
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
      let p: Parts | null = null;
      try {
        // a slow answer must never strand a child: past the deadline the show
        // goes on with a random creature
        const r = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: photo }),
          signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
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
        if (j.parts && j.parts.body === v) p = j.parts;
        track("match_done", { variant: v, matched: j.matched ?? false, parts: p });
      } catch {
        track("match_fail");
      }
      if (!aliveRef.current) return;
      if (!p) p = await randomParts(v).catch(() => ({ body: v, hat: "none", arms: "twig", legs: "twig" }));
      if (!aliveRef.current) return;
      setVariant(v);
      setParts(p);
      // 2) the dance mini-game: the child's own moves charge the magic
      setPhase("dance");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) gauge full -> dust -> 4) ALIVE -> 5) walks off right
  const variantRef = useRef<string | null>(null);
  variantRef.current = variant;
  const partsRef = useRef<Parts | null>(null);
  partsRef.current = parts;
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
          body: JSON.stringify({ variant: v, parts: partsRef.current }),
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
        <p className="lead">🕺 마법 동작으로 채소 친구를 깨워 줘!</p>
        <DanceCharge stream={stream} onFull={danceDone} />
      </div>
    );
  }

  if (phase === "walk" && variant && parts) {
    return (
      <div className="screen center-screen" style={{ alignItems: "center" }}>
        <p className="lead">🌏 디지털 세계로 출발!</p>
        <div className="walk-stage">
          <div className="walker">
            <Figure parts={parts} />
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
        {phase === "alive" && variant && parts ? (
          // the whole figure — hat to feet — inside the wide reveal frame
          <div className="wake-media wake-figure">
            <Figure parts={parts} className="wave" />
          </div>
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
