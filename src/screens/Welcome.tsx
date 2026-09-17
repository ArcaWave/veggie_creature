import { useEffect, useRef, useState } from "react";
import { getCamera, releaseCamera, cameraErrorText, snapshot } from "../lib/camera";
import { getPoseLandmarker } from "../lib/pose";
import { ShowGate, gateParamsFromUrl, type GateReport } from "../lib/gate";
import { pop, sparkle } from "../lib/sfx";
import { speak } from "../lib/guide";
import { track } from "../lib/analytics";
import { CamFrame } from "../components/CamFrame";

// The always-on welcome screen is a MIRROR in a clay picture frame. A child
// who walks up close, stands in the middle and holds their creation in front
// of the chest for a moment gets a 3·2·1 and the photo is taken by itself —
// no button, no staff (the rules live in lib/gate.ts; ?posedebug shows the
// live numbers for tuning on site, ?nogate turns the auto start off). The
// small 시작 button is the staff fallback; Space/Enter do the same so a
// physical big button or a sensor can be plugged in later as a keyboard.
type Dir = "ur" | "ul" | "dr" | "dl"; // doodle arrow tip direction
const STEPS: { img: string; emoji: string; caption: string; dir: Dir }[] = [
  { img: "/welcome/step1.jpg", emoji: "📷", caption: "찰칵!", dir: "ul" },
  { img: "/welcome/step2.jpg", emoji: "✨", caption: "살아난다!", dir: "dr" },
  { img: "/welcome/step3.jpg", emoji: "🚶", caption: "뚜벅뚜벅!", dir: "dr" },
  { img: "/welcome/step4.jpg", emoji: "🌏", caption: "디지털 세계로!", dir: "dl" },
];

const q = new URLSearchParams(location.search);
const DEBUG = q.has("posedebug");
const GATE_ON = !q.has("nogate");
const COUNT_FROM = 3;
const COOLDOWN_MS = 1500;      // nobody close for this long before the gate may arm again…
const COOLDOWN_MAX_MS = 8000;  // …or this long since the screen came back, whichever first
const LOST_MS = 700;           // child gone from the frame this long mid-count = quiet cancel

let hadSession = false; // a fresh page load has nobody to wait out — the gate arms at once

type Hint = "come" | "hold" | "still" | "count" | "snap";
const HINTS: Record<Hint, string> = {
  come: "여기 서서 채소 친구를 보여 주세요",
  hold: "채소 친구를 가슴 앞에 들어 주세요!",
  still: "그대로 잠깐만~ ✨",
  count: "가만히~ 찍을게요!",
  snap: "찰칵! ✨",
};

export function Welcome({ onCaptured, onStart }: { onCaptured: (photo: string) => void; onStart: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [hint, setHint] = useState<Hint>("come");
  const [report, setReport] = useState<GateReport | null>(null); // debug HUD only
  const [flash, setFlash] = useState(false);

  const countRef = useRef<number | null>(null);
  const countTimer = useRef<number | null>(null);
  const gateRef = useRef<ShowGate | null>(null);
  const armedRef = useRef(false);
  const doneRef = useRef(false);
  const params = useRef(gateParamsFromUrl()).current;

  // -------- the shared kiosk camera --------
  useEffect(() => {
    let cancelled = false;
    setCamError(null);
    if (camTry > 0) releaseCamera();
    getCamera()
      .then((stream) => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v && v.srcObject !== stream) {
          v.srcObject = stream;
          v.play?.().catch(() => {});
        }
        setCamOn(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setCamError(cameraErrorText(err));
        setCamOn(false);
      });
    return () => { cancelled = true; };
  }, [camTry]);

  // -------- countdown → snap --------
  function setCountBoth(c: number | null) {
    countRef.current = c;
    setCount(c);
  }
  function startCountdown(reason: "gate" | "button" | "key") {
    if (countRef.current !== null || doneRef.current) return;
    track("welcome_countdown", { reason });
    speak("움직이지 말고 잠깐만, 사진 찍을게!");
    setHint("count");
    setCountBoth(COUNT_FROM);
    pop();
    countTimer.current = window.setInterval(() => {
      const c = (countRef.current ?? 1) - 1;
      if (c <= 0) {
        clearCountTimer();
        setCountBoth(0);
        snap();
      } else {
        setCountBoth(c);
        pop();
      }
    }, 1000);
  }
  function clearCountTimer() {
    if (countTimer.current !== null) clearInterval(countTimer.current);
    countTimer.current = null;
  }
  function cancelCountdown() {
    clearCountTimer();
    setCountBoth(null);
    gateRef.current?.reset();
    track("welcome_countdown_cancel");
  }
  function snap() {
    const v = videoRef.current;
    if (!v || v.readyState < 2) { cancelCountdown(); return; }
    doneRef.current = true;
    hadSession = true;
    sparkle();
    setHint("snap");
    setFlash(true);
    const url = snapshot(v);
    window.setTimeout(() => onCaptured(url), 550);
  }
  useEffect(() => () => clearCountTimer(), []);

  // staff / physical-trigger fallback: the button, Space or Enter
  function manualStart(reason: "button" | "key") {
    if (camOn) startCountdown(reason);
    else onStart();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); manualStart("key"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  // -------- the show-me gate --------
  useEffect(() => {
    if (!camOn || !GATE_ON) return;
    let stopped = false;
    let landmarker: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
    getPoseLandmarker()
      .then((l) => { if (!stopped) landmarker = l; })
      .catch(() => { /* no pose model: the button/keyboard still work */ });
    const gate = new ShowGate(params);
    gateRef.current = gate;
    const t0 = Date.now();
    let lastNear = t0;
    if (!hadSession) armedRef.current = true;
    let frame = 0;

    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !landmarker || doneRef.current) return;
      let rep: GateReport;
      try {
        const now = performance.now();
        rep = gate.update(landmarker.detectForVideo(v, now).landmarks ?? [], now);
      } catch { return; } // one bad frame — skip
      const now = Date.now();
      if (rep.near) lastNear = now;
      // after a session the previous child must step away (or a few seconds
      // pass) before the gate can fire again — no accidental double runs
      if (!armedRef.current && (now - lastNear > COOLDOWN_MS || now - t0 > COOLDOWN_MAX_MS)) armedRef.current = true;

      drawOverlay(v, rep);
      if (DEBUG && frame++ % 4 === 0) setReport(rep);

      if (countRef.current === null) {
        setHint(!rep.near ? "come" : !rep.holding ? "hold" : "still");
        if (rep.ready && armedRef.current) startCountdown("gate");
      } else if (now - lastNear > LOST_MS) {
        cancelCountdown(); // walked off mid-count: back to the mirror, quietly
        setHint("come");
      }
    }, 66);
    return () => { stopped = true; clearInterval(id); gateRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  // the guide silhouette (stand here, this big), the creature spot, the glow
  // around the recognised child — all drawn over the mirrored video, so x is
  // mirrored to match
  function drawOverlay(v: HTMLVideoElement, rep: GateReport) {
    const c = overlayRef.current;
    if (!c) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
    const X = (x: number) => cw - (ox + x * v.videoWidth * s); // mirrored
    const Y = (y: number) => oy + y * v.videoHeight * s;

    // guide silhouette: fitting it means "close enough" (its shoulders are
    // the near threshold plus a little). It invites from afar and fades once
    // a child has stepped into it — the glow box takes over from there.
    const progress = Math.min(1, rep.dwell / params.hold);
    const counting = countRef.current !== null;
    const ws = params.near * 1.2 * v.videoWidth * s; // shoulder width on screen
    const cx = cw / 2;
    const headR = ws * 0.28, headY = ch * 0.30, shY = ch * 0.50;
    ctx.save();
    ctx.globalAlpha = rep.near ? 0.18 : 1;
    ctx.beginPath();
    ctx.arc(cx, headY, headR, 0, Math.PI * 2);
    ctx.moveTo(cx - ws * 0.62, ch + 10);
    ctx.lineTo(cx - ws * 0.62, shY + ws * 0.25);
    ctx.quadraticCurveTo(cx - ws * 0.62, shY, cx - ws * 0.38, shY);
    ctx.lineTo(cx + ws * 0.38, shY);
    ctx.quadraticCurveTo(cx + ws * 0.62, shY, cx + ws * 0.62, shY + ws * 0.25);
    ctx.lineTo(cx + ws * 0.62, ch + 10);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.stroke();
    ctx.restore();

    // the creature spot at chest height: dashed white, then orange filling up
    // with the hold, solid and glowing through the countdown
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - ws * 0.55, ch * 0.54, ws * 1.1, ch * 0.30, 18);
    if (rep.holding || counting) {
      ctx.fillStyle = `rgba(242, 165, 55, ${counting ? 0.35 : 0.08 + 0.27 * progress})`;
      ctx.fill();
    }
    ctx.setLineDash(counting || progress >= 1 ? [] : [10, 8]);
    ctx.lineWidth = counting ? 5 : 3;
    ctx.strokeStyle = rep.holding || counting ? "rgba(242, 165, 55, 0.95)" : "rgba(255, 255, 255, 0.75)";
    ctx.shadowColor = "rgba(255, 190, 60, 0.9)";
    ctx.shadowBlur = counting || progress > 0 ? 16 : 0;
    ctx.stroke();
    ctx.restore();

    // everyone tracked: thin white; the recognised (nearest) child: pulsing orange
    rep.boxes.forEach((b, i) => {
      const pad = 0.04;
      const x0 = X(Math.min(1, b.x1 + pad)), x1 = X(Math.max(0, b.x0 - pad));
      const y0 = Y(Math.max(0, b.y0 - pad)), y1 = Y(Math.min(1, b.y1 + pad));
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 22);
      if (i === rep.main && rep.near) {
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 220);
        ctx.lineWidth = 6;
        ctx.strokeStyle = `rgba(242, 165, 55, ${pulse})`;
        ctx.shadowColor = "rgba(255, 190, 60, 0.9)";
        ctx.shadowBlur = 18;
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      }
      ctx.stroke();
      ctx.restore();
    });

    if (DEBUG && rep.zone) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(80, 200, 255, 0.9)";
      ctx.strokeRect(X(rep.zone.x1), Y(rep.zone.y0), X(rep.zone.x0) - X(rep.zone.x1), Y(rep.zone.y1) - Y(rep.zone.y0));
      ctx.restore();
    }
  }

  const stageHint = HINTS[hint];
  return (
    <div className="screen welcome">
      <div className="welcome-left">
        <div className="welcome-hero">
          <img src="/veggie-creature-logo.png" className="welcome-logo" alt="Veggie Creature" />
          <p className="welcome-strap">몽글키즈 마법 체험</p>
          <p className="welcome-tag">내가 만든 채소 친구가 살아나요!</p>
        </div>
        <div className="mini-steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <div key={i} className={`mini-step m${i + 1}`} style={{ animationDelay: `${0.3 + i * 0.35}s` }}>
              <div className="mini-polaroid"><Photo src={s.img} emoji={s.emoji} /></div>
              <span className="mini-caption">{s.caption}</span>
            </div>
          ))}
        </div>
        <button className="btn-ghost staff-start" onClick={() => manualStart("button")}>시작 ▶</button>
      </div>

      <div className="mirror">
        <div className={`mirror-stage${count !== null ? " counting" : ""}`}>
          <CamFrame>
            <video ref={videoRef} autoPlay playsInline muted className="mirror-cam" />
            <canvas ref={overlayRef} className="mirror-overlay" />
            {!camOn && (
              <div className="mirror-ph">
                <span>📷</span>
                <p>{camError ?? "카메라 켜는 중…"}</p>
                {camError && (
                  <button className="btn-secondary" onClick={() => setCamTry((t) => t + 1)}>📷 다시 시도</button>
                )}
              </div>
            )}
            {flash && <div className="mirror-flash" />}
            {count !== null && count > 0 && <span className="count-badge">{count}</span>}
            {DEBUG && report && (
              <pre className="gate-hud">
                {`어깨 ${report.width.toFixed(2)} / ${params.near} ${report.near ? "✓" : "✗"}\n가운데 ${report.centered ? "✓" : "✗"}  손 ${report.holding ? "✓" : "✗"}  정지 ${report.still ? "✓" : "✗"}\n유지 ${(report.dwell / 1000).toFixed(1)}s / ${params.hold / 1000}s  ${armedRef.current ? "준비됨" : "쿨다운"}`}
              </pre>
            )}
          </CamFrame>
          <span className={`mirror-pill ${hint}`}>{stageHint}</span>
        </div>
        <p className="mirror-note">📷 카메라 화면은 사진 찍기에만 쓰여요</p>
      </div>
    </div>
  );
}

function Photo({ src, emoji }: { src: string; emoji: string }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img src={src} alt="" className="photo" onError={() => setOk(false)} />
  ) : (
    <div className="photo photo-ph">{emoji}</div>
  );
}
