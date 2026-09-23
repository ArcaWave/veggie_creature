import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { pop, sparkle } from "../lib/sfx";
import { narrate, narrating, clipMs, type VoiceId } from "../lib/narrate";
import { magicDustBurst } from "../lib/dust";
import { getPoseLandmarker, NOSE, L_WRIST, R_WRIST, L_INDEX, R_INDEX, L_SHOULDER, R_SHOULDER } from "../lib/pose";
import { StirDetector } from "../lib/stir";
import { coverFit } from "../lib/camera";
import { CamFrame } from "./CamFrame";

// The dance mini-game: three "magic moves", ONE PER SCENE — the scene changes
// after each move, so the child only ever has one thing to do. The first two
// are held poses (no timing to get right), chosen for how reliably BlazePose
// reads them from an upper-body webcam view: arms out level = airplane, both
// hands joined above the head = heart. The finale is the magic pot: the
// child's creation drops into a cauldron, a ladle sticks to the child's hand,
// and a turn or two of stirring makes the pot burst with light and stars —
// which is the moment the creature comes alive (Build carries on from the
// white-out). Forgiving for the special-needs event: doing the move charges
// fast; and when nothing has been recognised for a few seconds (a child who
// doesn't follow, or is just playing around) the dust quietly starts
// gathering by itself — easing in, never a visible jump — so every scene
// completes on its own in about 20 s. Nobody is ever stuck.
// (Tapping/clicking the stage also charges: a tester's shortcut — the
// exhibition screen is not a touch screen, so it is not advertised.)
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

// the hand that holds the ladle: between the wrist and the index knuckle
// (the wrist alone sits a little up the arm). null when it isn't in view.
function handOf(lm: LM, wrist: number, index: number): { x: number; y: number } | null {
  const w = lm[wrist], i = lm[index];
  if ((w.visibility ?? 1) < 0.5 || w.x < -0.02 || w.x > 1.02 || w.y < -0.02 || w.y > 1.02) return null;
  return seen(i) ? { x: (w.x + i.x) / 2, y: (w.y + i.y) / 2 } : { x: w.x, y: w.y };
}

// the posed moves come with a photo of a child doing them (public/dance/),
// shown standing on the frame's edge — a real kid to copy beats a diagram.
// The stir has no `check`: it is followed by the StirDetector instead.
type Move = { key: string; title: string; prompt: string; cheer: string; voice: VoiceId; cheerVoice?: VoiceId | VoiceId[]; guide?: string; check?: (lm: LM) => boolean };
export const MOVES: Move[] = [
  { key: "airplane", title: "비행기 날개!", prompt: "양팔을 옆으로 쭉~ 펴 봐!", cheer: "팔이 쑥! 잘했어! ✈️", voice: "d1_airplane", cheerVoice: ["d1_cheer_a", "d1_cheer_b"], guide: "/dance/guide_airplane.png", check: isAirplane },
  { key: "heart", title: "머리 위로 하트!", prompt: "사랑을 주어 생명을 불어 넣어봐요! 💖", cheer: "사랑을 듬뿍 주었어! 💖", voice: "d2_heart", cheerVoice: "d2_cheer", guide: "/dance/guide_heart.png", check: isHeart },
  { key: "stir", title: "마법 냄비 젓기!", prompt: "국자로 냄비를 빙글빙글 저어 봐! 🥄", cheer: "팡! 마법 완성! ✨", voice: "d3_stir" },
];

const CHEER_MS = 1500; // "참 잘했어요" beat between scenes (stretched to the spoken cheer)
const CHEER_PAUSE_S = 0.2; // "팔이 쑥!" (0.2 s) "잘했어!"
const WAIT_LINE_AFTER_MS = 6000; // this long after the instruction ended, still no move → "천천히 해도 괜찮아~" (once a scene)
const HAND_LINE_AFTER_MS = 3500; // stir: no hand in view this long → "손을 들어 봐!" (at most every 12 s)
const ASSIST_AFTER_MS = 5000; // this long without a recognised move → the quiet assist begins
const ASSIST_RAMP_MS = 4000;  // …easing in over this long, so its start is imperceptible
const ASSIST_RATE = 7;        // gauge % per second once fully eased in
const EMPTY_AFTER_MS = 4000;  // nobody at all in the camera this long → the scene wraps up fast…
const EMPTY_RATE = 30;        // …at this many % per second (~3 s a scene)
const POSE_RATE = 46;         // gauge % per second while a pose is held (~2 s to fill)
const TICK_MS = 100;
const STIR_TURNS = 2;         // turns of the ladle that fill the pot…
const STIR_TRAVEL = 8;        // …or this much hand travel (frame heights) — scribbles count too
                              // (together: a little under two real turns)
const STIR_INTRO_MS = 1700;   // the creation drops into the pot first; stirring counts after
const BURST_MS = 1500;        // the pot's burst, ending in the white-out Build picks up from
const WHITE_AT_MS = 950;

// pot.png geometry (fractions of the sprite): where the soup is
const SOUP_Y = 0.27, SOUP_HALF_W = 0.3;
// ladle.png geometry (fractions of the sprite): the grip the hand holds and
// the middle of the bowl; its drawn length range, × window height
const GRIP_Y = 0.16, BOWL_Y = 0.86, LADLE_ASPECT = 239 / 720, LADLE_LEN: [number, number] = [0.34, 0.95];
const PREDICT_MS = 90;        // the ladle leads the last sample by this much (detection lag)

type Box = { x0: number; y0: number; x1: number; y1: number };
type Spark = { x: number; y: number; vx: number; vy: number; g: number; age: number; life: number; size: number; hue: number };

export function DanceCharge({ stream, photo, onFull }: { stream: MediaStream | null; photo?: string | null; onFull: () => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const potRef = useRef<HTMLImageElement>(null);
  const [stage, setStage] = useState(0);
  const [cheer, setCheer] = useState(false);
  const [gauge, setGauge] = useState(0);
  const [hit, setHit] = useState(false); // move currently recognised (guide lights up)
  const [holding, setHolding] = useState(false); // stir: a hand is holding the ladle
  const [burst, setBurst] = useState(false);
  const [white, setWhite] = useState(false);
  const gaugeRef = useRef(0);
  const stageRef = useRef(0);
  const cheerRef = useRef(false);
  const stageT0 = useRef(Date.now());
  const lastHitAt = useRef(Date.now()); // last moment the child's own move charged the gauge
  const doneRef = useRef(false);
  const waitSaid = useRef(false);  // "천천히 해도 괜찮아~" was said in this scene
  const seenAt = useRef(Date.now()); // when anybody at all was last in the camera
  const talkEnd = useRef(Date.now() + clipMs("d0_intro") + 250 + clipMs(MOVES[0].voice)); // when this scene's instruction has been said
  const handSaidAt = useRef(0);    // when "손을 들어 봐!" was last said
  const onFullRef = useRef(onFull);
  onFullRef.current = onFull;
  // what the last detection saw (video-normalised), for the render loop
  const view = useRef<{ boxes: Box[]; main: number; hand: { x: number; y: number; vx: number; vy: number } | null; handAt: number; turningAt: number; burstAt: number }>(
    { boxes: [], main: -1, hand: null, handAt: 0, turningAt: 0, burstAt: 0 });

  useEffect(() => {
    narrate(["d0_intro", MOVES[0].voice]); // (cut at once if the child is already doing the move)
    document.body.classList.add("stage-dance"); // the brand moves into the title pill
    return () => document.body.classList.remove("stage-dance");
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
    cheerRef.current = true;
    sparkle();
    if (stageRef.current < MOVES.length - 1) {
      // scene complete: cheer (spoken — it cuts the instruction if that was
      // still running), then the next move on its own screen
      const said = MOVES[stageRef.current].cheerVoice;
      if (said) narrate(said, undefined, CHEER_PAUSE_S);
      setCheer(true);
      window.setTimeout(() => {
        stageRef.current += 1;
        stageT0.current = Date.now();
        lastHitAt.current = Date.now();
        gaugeRef.current = 0;
        cheerRef.current = false;
        setGauge(0);
        setHit(false);
        setCheer(false);
        setStage(stageRef.current);
        pop();
        waitSaid.current = false;
        talkEnd.current = Date.now() + clipMs(MOVES[stageRef.current].voice);
        narrate(MOVES[stageRef.current].voice);
      }, said ? Math.max(CHEER_MS, clipMs(said, CHEER_PAUSE_S) + 200) : CHEER_MS);
    } else {
      // the finale: the pot bursts, the screen goes white — and Build's
      // "alive" scene opens out of that same white
      view.current.burstAt = performance.now();
      // "팡!" (0.2 s) "마법 완성!" with the burst and through the white-out; "우와~ 채소 친구가
      // 살아났어!" comes once the figure has popped up, in Build's alive scene
      narrate(["a1_pang", "a1_done"], undefined, 0.2);
      setBurst(true);
      magicDustBurst(potRef.current);
      window.setTimeout(() => setWhite(true), WHITE_AT_MS);
      window.setTimeout(() => {
        doneRef.current = true;
        onFullRef.current();
      }, BURST_MS);
    }
  }
  const chargeRef = useRef(charge);
  chargeRef.current = charge;

  // detection: poses → gauge (and what the render loop should draw)
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

    // stir: the ladle goes to whichever hand is doing the moving
    const stir = new StirDetector();
    const HANDS = [[R_WRIST, R_INDEX], [L_WRIST, L_INDEX]] as const;
    let active = 0;
    let smooth: { x: number; y: number } | null = null;
    const lastPos: ({ x: number; y: number } | null)[] = [null, null];
    const energy = [0, 0];

    let lastTick = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(300, now - lastTick) / 1000;
      lastTick = now;
      const v = vRef.current;
      const move = MOVES[stageRef.current];
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
            // …but whoever DOES the move counts: with a parent behind (bigger in
            // frame) or brothers and sisters alongside, the child doing the
            // airplane must not be ignored. The glow follows the one doing it.
            const doer = move.check ? poses.findIndex((lm) => move.check!(lm)) : -1;
            if (move.check && doer >= 0) main = doer;
            if (!move.check) { // the ladle goes to the biggest person who has a hand in view
              let best = -1, bestArea = 0;
              poses.forEach((lm, i) => {
                const area = (boxes[i].x1 - boxes[i].x0) * (boxes[i].y1 - boxes[i].y0);
                if (area > bestArea && HANDS.some(([w, ix]) => handOf(lm, w, ix))) { bestArea = area; best = i; }
              });
              if (best >= 0) main = best;
            }
            view.current.boxes = boxes;
            view.current.main = main;
            if (poses.length) seenAt.current = now;

            if (move.check) {
              const ok = doer >= 0;
              setHit(ok);
              if (ok) { lastHitAt.current = now; chargeRef.current(POSE_RATE * dt); }
            } else {
              const hands = HANDS.map(([w, i]) => (main >= 0 ? handOf(poses[main], w, i) : null));
              hands.forEach((h, k) => {
                const p = lastPos[k];
                energy[k] = energy[k] * 0.85 + (h && p ? Math.hypot(h.x - p.x, h.y - p.y) : 0);
                lastPos[k] = h;
              });
              const other = 1 - active;
              if (hands[other] && (!hands[active] || energy[other] > energy[active] * 2 + 0.02)) {
                active = other;
                smooth = null;
                stir.lost();
              }
              const h = hands[active];
              if (h) {
                const was = smooth;
                smooth = was ? { x: was.x + (h.x - was.x) * 0.6, y: was.y + (h.y - was.y) * 0.6 } : h;
                const span = Math.max(30, now - view.current.handAt); // ms since the last sample
                const old = view.current.hand;
                const vx = was ? (smooth.x - was.x) / span : 0, vy = was ? (smooth.y - was.y) / span : 0;
                view.current.hand = { x: h.x, y: h.y, vx: old ? old.vx * 0.5 + vx * 0.5 : vx, vy: old ? old.vy * 0.5 + vy * 0.5 : vy };
                view.current.handAt = now;
                const step = stir.update(smooth.x, smooth.y, now, v.videoWidth / v.videoHeight);
                if (step.turning) view.current.turningAt = now;
                if (step.turning || step.moved > 0) lastHitAt.current = now;
                if (now - stageT0.current > STIR_INTRO_MS) chargeRef.current((step.turned / STIR_TURNS + step.moved / STIR_TRAVEL) * 100);
              } else {
                smooth = null;
                stir.lost();
                if (now - view.current.handAt > 600) view.current.hand = null;
              }
              setHolding(now - view.current.handAt < 600);
              setHit(now - view.current.turningAt < 500);
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
            if (moved / (d.length / 16) > 0.04) { lastHitAt.current = now; chargeRef.current(19 * dt); }
          }
          prev = d;
        }
      }
      // never a dead end — and never obvious: idle for a few seconds → the
      // gauge eases into a slow, slightly uneven climb of its own
      const idle = now - Math.max(stageT0.current, lastHitAt.current);
      // the gentle lines — only into silence, never over another line, never after the scene is won
      if (!cheerRef.current && !doneRef.current && !narrating()) {
        if (!move.check && now - Math.max(stageT0.current, view.current.handAt) > HAND_LINE_AFTER_MS + clipMs("d3_stir") * (view.current.handAt ? 0 : 1) && now - handSaidAt.current > 12000) {
          handSaidAt.current = now;
          narrate("d3_hand");
        } else if (now - Math.max(talkEnd.current, lastHitAt.current) > WAIT_LINE_AFTER_MS && !waitSaid.current) {
          waitSaid.current = true;
          narrate("d_wait");
        }
      }
      // nobody in front of the camera at all (the child walked off; a queue is waiting):
      // don't hold the station for a minute — each scene wraps up in a few seconds
      const empty = landmarker && now - seenAt.current > EMPTY_AFTER_MS;
      if (empty) chargeRef.current(EMPTY_RATE * dt);
      else if (idle > ASSIST_AFTER_MS) {
        const r = Math.min(1, (idle - ASSIST_AFTER_MS) / ASSIST_RAMP_MS), ease = r * r * (3 - 2 * r);
        const breath = 1 + 0.25 * Math.sin(now / 700) + 0.1 * Math.sin(now / 230);
        chargeRef.current(ASSIST_RATE * ease * breath * dt);
      }
    }, TICK_MS);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  // render loop: the outline around the recognised child and — in the pot
  // scene — the ladle riding the child's hand, the sparkles the stirring
  // raises from the soup, and the final burst. Drawn every frame (detection
  // only runs ~10×/s; the ladle glides between its samples). The video is
  // mirrored via CSS, so x-coords are mirrored to match.
  useEffect(() => {
    const ladleImg = new Image();
    ladleImg.src = "/dance/ladle.png";
    const sparks: Spark[] = [];
    const ladle = { x: 0, y: 0, a: 0, len: 0, set: false };
    let spawnDebt = 0, burstDone = false, last = performance.now(), raf = 0;

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const c = overlayRef.current, v = vRef.current;
      if (!c || !v || !v.videoWidth) return;
      const cw = c.clientWidth, ch = c.clientHeight;
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      const { s, ox, oy } = coverFit(v, cw, ch);
      const toX = (nx: number) => cw - (ox + nx * v.videoWidth * s);
      const toY = (ny: number) => oy + ny * v.videoHeight * s;
      const { boxes, main, hand, handAt, turningAt, burstAt } = view.current;
      const now = Date.now();

      boxes.forEach((b, i) => {
        const pad = 0.05;
        const mx0 = toX(Math.min(1, b.x1 + pad)), mx1 = toX(Math.max(0, b.x0 - pad));
        const y0 = toY(Math.max(0, b.y0 - pad)), y1 = toY(Math.min(1, b.y1 + pad));
        ctx.beginPath();
        ctx.roundRect(mx0, y0, mx1 - mx0, y1 - y0, 22);
        if (i === main) {
          const pulse = 0.75 + 0.25 * Math.sin(now / 220);
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
          ctx.stroke();
        }
      });

      const pot = potRef.current;
      if (!pot || !pot.offsetWidth) return; // not the pot scene
      const potW = pot.offsetWidth, potH = pot.offsetHeight;
      const soupX = pot.offsetLeft + potW / 2, soupY = pot.offsetTop + potH * SOUP_Y;
      const bursting = burstAt > 0;

      // the ladle: its grip in the child's hand, its bowl always down in the
      // soup — so whatever the hand does, the child sees it stirring the pot.
      // While no hand is in view it stirs by itself (the demonstration).
      const held = !!hand && now - handAt < 600 && !bursting;
      let tx: number, ty: number;
      if (held) {
        const lead = Math.min(250, now - handAt + PREDICT_MS);
        tx = toX(hand!.x + hand!.vx * lead);
        // (a hand down at pot level would hide the whole ladle behind the pot:
        // there the grip floats just above the rim instead)
        ty = Math.min(toY(hand!.y + hand!.vy * lead), soupY - ch * 0.17);
      } else {
        const k = t / 1000 * 2.4;
        tx = soupX + potW * 0.16 * Math.cos(k);
        ty = soupY - ch * 0.3 + potH * 0.05 * Math.sin(k);
      }
      if (!ladle.set) { ladle.x = tx; ladle.y = ty; ladle.set = true; }
      const follow = 1 - Math.exp(-dt * (held ? 26 : 5));
      ladle.x += (tx - ladle.x) * follow;
      ladle.y += (ty - ladle.y) * follow;
      // the bowl circles inside the soup as the hand circles above it
      const clamp = (n: number, m: number) => Math.max(-m, Math.min(m, n));
      const bx = soupX + clamp((ladle.x - soupX) * 0.3, potW * 0.2);
      const by = soupY + potH * 0.02 + clamp((ladle.y - (soupY - ch * 0.3)) * 0.12, potH * 0.04);
      const dx = bx - ladle.x, dy = Math.max(ch * 0.08, by - ladle.y);
      const len = Math.max(ch * LADLE_LEN[0], Math.min(ch * LADLE_LEN[1], Math.hypot(dx, dy) / (BOWL_Y - GRIP_Y)));
      ladle.len += (len - ladle.len) * (ladle.len ? 1 - Math.exp(-dt * 14) : 1);
      ladle.a = -Math.atan2(dx, dy);
      if (ladleImg.complete && ladleImg.naturalWidth && !bursting) {
        const L = ladle.len, W = L * LADLE_ASPECT;
        ctx.save();
        ctx.translate(ladle.x, ladle.y);
        ctx.rotate(ladle.a);
        ctx.shadowColor = "rgba(60, 35, 10, 0.35)";
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 8;
        ctx.drawImage(ladleImg, -W / 2, -L * GRIP_Y, W, L);
        ctx.restore();
      }

      // sparkles rising from the soup: a few always, more as the pot fills,
      // a flurry while the ladle is going round
      const turning = now - turningAt < 500;
      const mk = (big: boolean): Spark => {
        if (big) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.5, sp = ch * (0.5 + Math.random() * 1.3);
          return { x: soupX + (Math.random() - 0.5) * potW * 0.4, y: soupY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: ch * 0.9, age: 0, life: 1.1 + Math.random() * 0.8, size: ch * (0.012 + Math.random() * 0.03), hue: 38 + Math.random() * 22 };
        }
        return { x: soupX + (Math.random() - 0.5) * 2 * potW * SOUP_HALF_W, y: soupY + (Math.random() - 0.5) * potH * 0.08, vx: (Math.random() - 0.5) * ch * 0.06, vy: -ch * (0.1 + Math.random() * 0.16), g: 0, age: 0, life: 0.9 + Math.random() * 0.9, size: ch * (0.007 + Math.random() * 0.013), hue: 40 + Math.random() * 20 };
      };
      if (bursting && !burstDone) {
        burstDone = true;
        for (let i = 0; i < 110; i++) sparks.push(mk(true));
      }
      spawnDebt += dt * (bursting ? 60 : 3 + gaugeRef.current * 0.16 + (turning ? 16 : 0));
      while (spawnDebt >= 1) { spawnDebt -= 1; sparks.push(mk(bursting)); }

      ctx.globalCompositeOperation = "lighter";
      if (bursting) { // the light that pours out of the pot
        const k = Math.min(1, (t - burstAt) / 900), r = ch * (0.15 + 1.5 * (1 - (1 - k) * (1 - k)));
        const glow = ctx.createRadialGradient(soupX, soupY, 0, soupX, soupY, r);
        glow.addColorStop(0, "rgba(255, 252, 225, 0.95)");
        glow.addColorStop(0.35, "rgba(255, 226, 130, 0.6)");
        glow.addColorStop(1, "rgba(255, 210, 90, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, cw, ch);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.age += dt;
        if (p.age >= p.life) { sparks.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.age / p.life, fade = Math.min(1, k * 6) * (1 - k) ** 0.7;
        const r = p.size * (0.7 + 0.5 * Math.sin(p.age * 9 + p.hue));
        // a four-point twinkle over a soft halo
        ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${0.16 * fade})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${p.hue}, 100%, 88%, ${fade})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r * 1.6);
        ctx.quadraticCurveTo(p.x, p.y, p.x + r * 1.6, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r * 1.6);
        ctx.quadraticCurveTo(p.x, p.y, p.x - r * 1.6, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r * 1.6);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const move = MOVES[stage];
  const isStir = !move.check;
  return (
    <div className="dance-stage" onPointerDown={() => chargeRef.current(4)}>
      <div className="move-scene" key={stage}>
        {/* the camera is the show: the frame takes the whole screen height, and
            the title (with the brand, whose fixed logo this scene hides) and the
            gauge ride on the frame's clay bands instead of taking rows of their own */}
        <div className="dance-cam-wrap">
          <div className="move-head">
            <img className="move-logo" src="/monggle-logo-kr.png" alt="몽글키즈" draggable={false} />
            <span className="move-badge">{stage + 1} / {MOVES.length}</span>
            <h2 className="move-title">{move.title}</h2>
          </div>
          <CamFrame className="dance-cam-box">
            {stream ? (
              <video ref={vRef} autoPlay playsInline muted className="dance-cam" />
            ) : (
              <div className="dance-cam dance-cam-ph">🥕✨</div>
            )}
            {/* the pot is drawn twice: whole, behind the ladle — and its front
                half again on top, so the ladle dips INTO the soup */}
            {isStir && (
              <>
                <img
                  ref={potRef}
                  src="/dance/pot.png"
                  alt=""
                  draggable={false}
                  className={`stir-pot${hit ? " stirring" : ""}${burst ? " burst" : ""}`}
                  style={{ "--g": gauge / 100 } as CSSProperties}
                />
                {photo && <div className="stir-photo"><img src={photo} alt="" /></div>}
                {!burst && gauge < 45 && (
                  <svg className="stir-hint" viewBox="0 0 200 80" aria-hidden="true">
                    <ellipse cx="100" cy="40" rx="92" ry="32" />
                  </svg>
                )}
              </>
            )}
            {stream && <canvas ref={overlayRef} className="dance-overlay" />}
            {isStir && (
              <img
                src="/dance/pot.png"
                alt=""
                draggable={false}
                className={`stir-pot stir-pot-front${hit ? " stirring" : ""}${burst ? " burst" : ""}`}
                style={{ "--g": gauge / 100 } as CSSProperties}
              />
            )}
            {burst ? (
              <span className="dance-prompt top done">{move.cheer}</span>
            ) : (
              <span className={`dance-prompt${isStir ? " top" : ""}`}>
                {isStir && stream && !holding ? "손을 들어 국자를 잡아 봐! 🥄" : move.prompt}
              </span>
            )}
          </CamFrame>
          {move.guide && (
            <div className={`move-guide${hit ? " hit" : ""}`}>
              <span className="move-guide-label">{hit ? "좋아요! 그대로~ ✨" : "이렇게 해 봐!"}</span>
              <img src={move.guide} alt="" draggable={false} />
            </div>
          )}
          <div className="magic-gauge" aria-hidden="true">
            <div className="magic-gauge-fill" style={{ width: `${gauge}%` }} />
            <span className="magic-gauge-label">✨ 마법가루 {Math.round(gauge)}%</span>
          </div>
        </div>
      </div>
      {cheer && (
        <div className="move-cheer">
          <span className="move-cheer-star">⭐</span>
          <span>{move.cheer}</span>
        </div>
      )}
      {white && <div className="stir-whiteout" />}
    </div>
  );
}
