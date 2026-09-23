import { useEffect, useRef, useState } from "react";
import { SparkleLoading } from "../components/SparkleLoading";
import { pop, sparkle } from "../lib/sfx";
import { magicDustBurst } from "../lib/dust";
import { track } from "../lib/analytics";
import { keepAsset } from "../lib/keep";
import { narrate, hush, clipMs, voicedCountdown } from "../lib/narrate";
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

const MAX_RETRIES = 2; // "hold it closer" loops before we just go with it
const MATCH_TIMEOUT_MS = 20000; // matcher deadline before the show goes on regardless

// the floating life of the magic meadow (birth scene): leaves, stars,
// sparkles and petals drifting up around the light — a deterministic scatter
const PARTICLES = Array.from({ length: 24 }, (_, i) => {
  const kinds = [["leaf", "🍃"], ["star", "⭐"], ["spark", "✨"], ["petal", "🌼"], ["star", "🌟"]] as const;
  const [kind, glyph] = kinds[i % kinds.length];
  return { kind, glyph, left: 6 + ((i * 37) % 88), top: 8 + ((i * 53) % 66), delay: (i % 8) * 0.55, dur: 4.5 + (i % 5) * 0.9, size: 18 + (i % 4) * 9 };
});

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

  // the camera is live → the voice asks for the creation (first time) or for
  // stillness (a reshoot: the noshow screen already said why), counts
  // "셋! 둘! 하나!" with the numbers landing on the spoken ones, then snaps
  useEffect(() => {
    if (!camOn || step !== "photo") {
      setCount(null);
      return;
    }
    setCount(null);
    let cancel = () => {};
    narrate(tries === 0 ? "w2_show" : "w3_still", () => {
      cancel = voicedCountdown((n) => { setCount(n); pop(); }, () => { setCount(0); capture(); });
    });
    return () => { cancel(); hush(); };
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
    narrate("w5_snap");
    const url = snapshot(v);
    setPhoto(url);
    track("photo_captured");
    keepAsset("original", url);
    window.setTimeout(() => setStep("magic"), clipMs("w5_snap") + 120); // "찰칵!" is heard out before the next scene speaks
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
  type Phase = "match" | "noshow" | "dance" | "alive" | "walk" | "sendoff";
  const SENDOFF_MS = Math.max(5000, clipMs("a3_look") + 800); // "look at the wall next to you" (the whole line is heard) before the station resets
  const [phase, setPhase] = useState<Phase>("match");
  const [variant, setVariant] = useState<string | null>(null);
  const [parts, setParts] = useState<Parts | null>(null);
  const [relayFail, setRelayFail] = useState<string | null>(null); // why the wall did not get it (shown small on the send-off)
  const frameRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timersRef.current.push(window.setTimeout(fn, ms));

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => { aliveRef.current = false; timers.forEach(clearTimeout); hush(); }; // leaving the session: the voice stops with it
  }, []);

  // 1) which pre-made creature does this creation resemble?
  // no run-once ref: StrictMode's dev double-mount would strand the live run.
  useEffect(() => {
    (async () => {
      track("match_start");
      narrate("m1_reading");
      const lineSaid = new Promise((r) => window.setTimeout(r, clipMs("m1_reading") + 80)); // the question is never cut mid-sentence
      const RANDOM = ["pumpkin", "corn", "sweetpotato", "tomato", "cabbage"];
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
        await lineSaid;
        // nothing visible in the shot? ask the child to hold it closer and
        // reshoot (twice at most — then the show goes on with the best guess)
        if (j.none && tries < MAX_RETRIES) {
          if (!aliveRef.current) return;
          track("match_none", { tries });
          narrate("m2_noshow");
          setPhase("noshow");
          later(onRetryCloser, clipMs("m2_noshow") + 500);
          return;
        }
        if (typeof j.variant === "string" && j.variant) v = j.variant;
        else if (typeof j.best === "string" && j.best) v = j.best;
        if (j.parts && j.parts.body === v) p = j.parts;
        track("match_done", { variant: v, matched: j.matched ?? false, parts: p });
      } catch {
        track("match_fail");
      }
      await lineSaid;
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

  // 3) the magic pot bursts (DanceCharge ends on a white-out) -> 4) ALIVE,
  // opening out of that same white -> 5) walks off right
  const variantRef = useRef<string | null>(null);
  variantRef.current = variant;
  const partsRef = useRef<Parts | null>(null);
  partsRef.current = parts;
  const danceDoneRef = useRef(false);
  function danceDone() {
    if (!aliveRef.current || danceDoneRef.current) return;
    danceDoneRef.current = true;
    const v = variantRef.current ?? "tomato";
    track("dance_done", { variant: v });
    setPhase("alive");
    sparkle();
    // ("팡! 마법 완성! 우와~ 채소 친구가 살아났어!" began with the pot's burst and runs on into this scene)
    later(() => magicDustBurst(frameRef.current), 80); // once the podium is on screen
    later(() => {
      setPhase("walk");
      narrate("a2_go");
      track("walk_off", { variant: v });
      // the creature leaves this screen — announce it to the Digital World
      // (a department-store Wi-Fi blip must not cost a child their creature on the wall: a few retries,
      // spread over ~10 s, before the send-off screen admits it)
      const send = (attempt: number): Promise<void> =>
        fetch("/api/creatures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant: v, parts: partsRef.current }),
          signal: AbortSignal.timeout(8000),
        })
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.uploaded) throw new Error(j.reason || j.error || `http_${r.status}`);
          })
          .catch((e) => {
            if (attempt < 3) return new Promise<void>((res) => window.setTimeout(res, 1500 * attempt)).then(() => send(attempt + 1));
            throw e;
          });
      send(1).catch((e) => {
        const reason = String(e?.message || e);
        track("relay_fail", { reason });
        if (aliveRef.current) setRelayFail(reason);
      });
      later(() => {
        // it has arrived on the wall: point the child at it for a moment
        setPhase("sendoff");
        narrate("a3_look");
        later(() => {
          track("build_done", { variant: v });
          onDone();
        }, SENDOFF_MS);
      }, 5200); // walk duration + a breath
    }, 3400);
  }

  if (phase === "sendoff") {
    return (
      <div className="birth-stage is-sendoff">
        <div className="birth-glow" />
        <div className="sendoff">
          <p className="sendoff-title">🌏 디지털 세계에 도착했어요!</p>
          <p className="sendoff-cue">
            <span className="sendoff-arrow">👉</span> 옆 화면에서 확인해 봐요! <span className="sendoff-tv">📺</span>
          </p>
          <div className="sendoff-timer"><div className="sendoff-timer-fill" style={{ animationDuration: `${SENDOFF_MS}ms` }} /></div>
          {relayFail && <p className="sendoff-warn">⚠️ 옆 화면으로 전송하지 못했어요 ({relayFail})</p>}
        </div>
      </div>
    );
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
        <DanceCharge stream={stream} photo={photo} onFull={danceDone} />
      </div>
    );
  }

  // ALIVE -> walk: one continuous scene on the magic meadow stage. The pot's
  // white-out clears into a flash and a ring of light, and the figure bursts
  // onto the grassy podium; then it strolls off to the right.
  // (birth-origin marks the podium for the confetti burst.)
  if ((phase === "alive" || phase === "walk") && parts) {
    return (
      <div className={`birth-stage is-${phase}`}>
        <div className="birth-rays" />
        <div className="birth-glow" />
        <div className="birth-particles" aria-hidden="true">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className={`birth-p ${p.kind}`}
              style={{ left: `${p.left}%`, top: `${p.top}%`, fontSize: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}
            >
              {p.glyph}
            </span>
          ))}
        </div>
        <div className="birth-origin" ref={frameRef} />
        {phase === "alive" && (
          <>
            <div className="birth-flash" />
            <div className="birth-ring" />
            <div className="birth-figure">
              <Figure parts={parts} className="wave" />
            </div>
          </>
        )}
        {phase === "walk" && (
          <div className="walk-stage">
            <div className="walker">
              <Figure parts={parts} />
            </div>
          </div>
        )}
        <p className="birth-title" key={phase}>
          {phase === "alive" ? "🎉 살아났다!" : "🌏 디지털 세계로 출발!"}
        </p>
      </div>
    );
  }

  return (
    <div className="screen center-screen" style={{ alignItems: "center" }}>
      <p className="lead">✨ 마법을 읽는 중…</p>
      <div className="wake-frame" ref={frameRef}>
        <img src={photo} className="wake-media" alt="" style={{ filter: "saturate(1.4) blur(1.2px)" }} />
        <SparkleLoading messages={["넌 누구니…?", "마법을 느끼는 중…"]} />
      </div>
      <button className="btn-ghost" onClick={onRetake}>📷 다시 찍기</button>
    </div>
  );
}
