import { useEffect, useRef, useState } from "react";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { pop, sparkle } from "../lib/sfx";
import { speak } from "../lib/guide";
import { getPoseLandmarker, NOSE, L_WRIST, R_WRIST, L_SHOULDER, R_SHOULDER } from "../lib/pose";
import { CamFrame } from "./CamFrame";

// The dance mini-game: two "magic moves", ONE PER SCENE — the scene changes
// after each move, so the child only ever has one thing to do. The moves are
// held poses (no timing to get right), chosen for how reliably BlazePose reads
// them from an upper-body webcam view: arms out level = airplane, both hands
// joined above the head = heart. Forgiving for the special-needs event:
// holding the pose charges fast, tapping the screen charges too, a trickle
// starts after 10s and each scene hard-completes by ~20s — nobody is stuck.
type LM = NormalizedLandmark[];
const seen = (p: NormalizedLandmark) => (p.visibility ?? 1) > 0.4;

// arms out to the sides, level with the shoulders (each wrist beyond its own
// shoulder, on the outside, and not much higher or lower than it)
export function isAirplane(lm: LM): boolean {
  const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER], lw = lm[L_WRIST], rw = lm[R_WRIST];
  if (![ls, rs, lw, rw].every(seen)) return false;
  const w = Math.abs(ls.x - rs.x);
  if (w < 0.05) return false;
  const dirL = Math.sign(ls.x - rs.x); // which way "outside" is for the left arm
  const level = (p: NormalizedLandmark, s: NormalizedLandmark) => Math.abs(p.y - s.y) < Math.max(0.09, w * 0.55);
  const out = (p: NormalizedLandmark, s: NormalizedLandmark, dir: number) => (p.x - s.x) * dir > w * 0.7;
  return level(lw, ls) && level(rw, rs) && out(lw, ls, dirL) && out(rw, rs, -dirL);
}

// both hands raised above the head and brought together (the two wrists
// close, roughly over the nose)
export function isHeart(lm: LM): boolean {
  const nose = lm[NOSE], ls = lm[L_SHOULDER], rs = lm[R_SHOULDER], lw = lm[L_WRIST], rw = lm[R_WRIST];
  if (![nose, ls, rs, lw, rw].every(seen)) return false;
  const w = Math.abs(ls.x - rs.x);
  if (w < 0.05) return false;
  const up = lw.y < nose.y - 0.02 && rw.y < nose.y - 0.02;
  const close = Math.hypot(lw.x - rw.x, lw.y - rw.y) < w * 0.9;
  const centred = Math.abs((lw.x + rw.x) / 2 - nose.x) < w * 0.8;
  return up && close && centred;
}

// each move comes with a photo of a child doing it (public/dance/), shown
// standing on the frame's edge — a real kid to copy beats a diagram
export const MOVES = [
  { key: "airplane", title: "비행기 날개!", prompt: "양팔을 옆으로 쭉~ 펴 봐!", cheer: "팔이 쑤욱! ✈️", voice: "첫 번째 마법 동작! 비행기처럼 양팔을 옆으로 쭉 펴 볼까?", guide: "/dance/guide_airplane.png", check: isAirplane },
  { key: "heart", title: "머리 위로 하트!", prompt: "사랑을 주어 생명을 불어 넣어봐요! 💖", cheer: "사랑이 가득! 생명이 깨어나요 💖", voice: "이번엔 두 손을 머리 위에서 모아 하트를 만들어 봐! 사랑을 주면 생명이 깨어나!", guide: "/dance/guide_heart.png", check: isHeart },
] as const;

const CHEER_MS = 1500; // "참 잘했어요" beat between scenes

export function DanceCharge({ stream, onFull }: { stream: MediaStream | null; onFull: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState(0);
  const [cheer, setCheer] = useState(false);
  const [gauge, setGauge] = useState(0);
  const [hit, setHit] = useState(false); // pose currently recognised (pictogram lights up)
  const gaugeRef = useRef(0);
  const stageRef = useRef(0);
  const cheerRef = useRef(false);
  const stageT0 = useRef(Date.now());
  const doneRef = useRef(false);
  const onFullRef = useRef(onFull);
  onFullRef.current = onFull;

  useEffect(() => {
    speak(MOVES[0].voice);
  }, []);

  useEffect(() => {
    const v = vRef.current;
    if (v && stream) {
      v.srcObject = stream;
      v.play?.().catch(() => {});
    }
  }, [stream, stage]); // the <video> remounts with each scene

  function charge(amount: number) {
    if (doneRef.current || cheerRef.current) return;
    gaugeRef.current = Math.min(100, gaugeRef.current + amount);
    setGauge(gaugeRef.current);
    if (gaugeRef.current < 100) return;
    // scene complete: cheer, then the next move on its own screen
    cheerRef.current = true;
    setCheer(true);
    sparkle();
    window.setTimeout(() => {
      if (stageRef.current < MOVES.length - 1) {
        stageRef.current += 1;
        stageT0.current = Date.now();
        gaugeRef.current = 0;
        cheerRef.current = false;
        setGauge(0);
        setHit(false);
        setCheer(false);
        setStage(stageRef.current);
        pop();
        speak(MOVES[stageRef.current].voice);
      } else {
        doneRef.current = true;
        onFullRef.current();
      }
    }, CHEER_MS);
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
            const ok = main >= 0 && MOVES[stageRef.current].check(poses[main]);
            setHit(ok);
            if (ok) chargeRef.current(6);
          } catch { /* one bad frame — skip */ }
        } else if (diffCtx) {
          diffCtx.drawImage(v, 0, 0, 64, 48);
          const d = diffCtx.getImageData(0, 0, 64, 48).data;
          if (prev) {
            let moved = 0;
            for (let i = 0; i < d.length; i += 16) {
              if (Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) > 40) moved++;
            }
            if (moved / (d.length / 16) > 0.04) chargeRef.current(2.5);
          }
          prev = d;
        }
      }
      // never a dead end: per-scene trickle, hard-full within ~20s
      const held = Date.now() - stageT0.current;
      if (held > 10000) chargeRef.current(0.8);
      if (held > 20000) chargeRef.current(5);
    }, 130);
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
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
    boxes.forEach((b, i) => {
      const pad = 0.05;
      const x0 = ox + Math.max(0, b.x0 - pad) * v.videoWidth * s;
      const x1 = ox + Math.min(1, b.x1 + pad) * v.videoWidth * s;
      const y0 = oy + Math.max(0, b.y0 - pad) * v.videoHeight * s;
      const y1 = oy + Math.min(1, b.y1 + pad) * v.videoHeight * s;
      const mx0 = cw - x1, mx1 = cw - x0;
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

  const move = MOVES[stage];
  return (
    <div className="dance-stage" onPointerDown={() => chargeRef.current(4)}>
      <div className="move-scene" key={stage}>
        <div className="move-head">
          <span className="move-badge">{stage + 1} / {MOVES.length}</span>
          <h2 className="move-title">{move.title}</h2>
        </div>
        <div className="dance-cam-wrap">
          <CamFrame className="dance-cam-box">
            {stream ? (
              <>
                <video ref={vRef} autoPlay playsInline muted className="dance-cam" />
                <canvas ref={overlayRef} className="dance-overlay" />
              </>
            ) : (
              <div className="dance-cam dance-cam-ph">🥕✨</div>
            )}
            <span className="dance-prompt">{move.prompt}</span>
          </CamFrame>
          <div className={`move-guide${hit ? " hit" : ""}`}>
            <span className="move-guide-label">{hit ? "좋아요! 그대로~ ✨" : "이렇게 해 봐!"}</span>
            <img src={move.guide} alt="" draggable={false} />
          </div>
        </div>
        <div className="magic-gauge" aria-hidden="true">
          <div className="magic-gauge-fill" style={{ width: `${gauge}%` }} />
          <span className="magic-gauge-label">✨ 마법가루 {Math.round(gauge)}% <small>화면을 팡팡 눌러도 모여요!</small></span>
        </div>
      </div>
      {cheer && (
        <div className="move-cheer">
          <span className="move-cheer-star">⭐</span>
          <span>{move.cheer}</span>
        </div>
      )}
    </div>
  );
}
