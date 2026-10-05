// The six stimuli of the suggestiveness experiment (docs/RESEARCH.md): one deterministic timeline each,
// render(ctx, sprite, t) for t in 0…DURATION s — the same character size, start / end pose and idle motion;
// what the character is shown to DO differs between LOW and HIGH. Past DURATION every stimulus holds its end
// pose and keeps breathing (the observation window). No text, no sound.
// They play inside the kiosk's own "살아났다!" scene, on its podium, with the child's clay character
// (research/figure.ts) — drawn on a transparent canvas laid over the scene. No generative AI anywhere.
//   A  LOW  a crouch, then big hops across the podium   HIGH  a crouch, a trembling charge-up, a spin into a point
//                                                             — gone — and out of a point on the other side
//   B  LOW  a crouch and an ordinary jump               HIGH  the same crouch and air time, ~3x as high
//   C  LOW  hops and a wiggle beside the pot            HIGH  turns to the pot, winds up and pushes — a stream of
//           (the sprout stays as it is)                       little leaves flies into the pot, and it grows
export const DURATION = 5.6;
export const SW = 640, SH = 360; // stage units (16:9, laid over the scene with the scene's own cover fit)

export type Condition = "HIGH" | "LOW";
export type Pair = "A" | "B" | "C";
export type StimulusId =
  | "PAIR_A_LOW_MOVE" | "PAIR_A_HIGH_TELEPORT"
  | "PAIR_B_LOW_JUMP" | "PAIR_B_HIGH_FLY"
  | "PAIR_C_LOW_PLANT_CONTROL" | "PAIR_C_HIGH_GROW_PLANT";
export const stimulusId = (pair: Pair, cond: Condition): StimulusId => STIMULI.find((s) => s.pair === pair && s.cond === cond)!.id;

// the character: an image whose bottom is the feet; bodyFrac = the share of its height that is the body (a hat
// on top adds to the picture, not to the character's size)
export type Sprite = CanvasImageSource & { width: number; height: number; bodyFrac?: number };
type Stimulus = { pair: Pair; cond: Condition; name: string; id: StimulusId; render: (ctx: CanvasRenderingContext2D, s: Sprite | null, t: number) => void };

// Where things stand, in stage fractions. The kiosk's scene: feet on the podium (its top at ~80 % of the height,
// the podium spanning ~26–74 % of the width); the body 44 % of the screen tall, so the high jump (B HIGH) still
// fits under the top edge.
export const GEO = { ground: 0.8, ch: 0.44, xl: 0.33, xr: 0.67, xc: 0.5, xchar: 0.38, xpot: 0.63 };
const GROUND = SH * GEO.ground, CH = SH * GEO.ch;
const JUMP = { low: 0.085, high: 0.27 }; // B: the apex (stage heights) — the same crouch and air time for both
const HOP_H = 0.055;                     // the hops (A LOW walk, C), bigger than an idle bounce so they read

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const easeIO = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 2.2);
const easeIn = (p: number) => p * p * p;
const breathe = (t: number) => 1 + 0.012 * Math.sin(t * Math.PI * 2 * 0.9); // idle: a slow breath (the same everywhere)
const idleSq = (t: number) => 1 - breathe(t);
const hop = (t: number, a: number, n: number, period: number, h = HOP_H) => { const p = (t - a) / period; return p > 0 && p < n ? Math.abs(Math.sin(p * Math.PI)) * SH * h : 0; };
const hopSq = (t: number, a: number, n: number, period: number) => { const p = (t - a) / period; if (p <= 0 || p >= n) return 0; const f = p % 1; return f < 0.12 || f > 0.88 ? 0.08 : -0.04; };
const crouch = (t: number, a: number, b: number, depth = 0.12) => (t >= a && t < b ? depth * Math.sin(seg(t, a, b) * Math.PI) : 0); // down and back up
const rnd = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }; // (fixed per index: the clip is the same every time)

let appear = 1; // the reveal: 0 → 1 as the character pops onto the stage (the stimuli themselves run at 1)

export function drawPlainStage(ctx: CanvasRenderingContext2D) { // (the demo's neutral backdrop, and the covariate's)
  const g = ctx.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, "#dcebf3"); g.addColorStop(1, "#f6f1e3");
  ctx.fillStyle = g; ctx.fillRect(0, 0, SW, GROUND);
  const f = ctx.createLinearGradient(0, GROUND, 0, SH); f.addColorStop(0, "#c9dca8"); f.addColorStop(1, "#b3cc8f");
  ctx.fillStyle = f; ctx.fillRect(0, GROUND, SW, SH - GROUND);
}
type Pose = { x: number; lift?: number; sq?: number; rot?: number; alpha?: number; scale?: number; turn?: number };
// sq > 0 squashes (crouch), < 0 stretches; scale shrinks / grows the whole character about its feet (a point at 0);
// turn = the horizontal scale of a spin (1 → −1 → 1 is one turn about the vertical axis)
function character(ctx: CanvasRenderingContext2D, sprite: Sprite | null, p: Pose) {
  const { x, lift = 0, sq = 0, rot = 0, alpha = 1, scale = 1, turn = 1 } = p;
  if (!sprite || alpha <= 0 || appear <= 0 || scale <= 0.001) return;
  const pop = appear < 1 ? 1 + Math.sin(appear * Math.PI) * 0.12 * (1 - appear) : 1; // a soft overshoot as it appears
  const k0 = (appear < 1 ? easeOut(appear) * pop : 1) * scale;
  const full = CH / (sprite.bodyFrac ?? 1), h = full * k0, w = (h * sprite.width) / sprite.height, sy = 1 - sq, sx = (1 + sq * 0.6) * turn;
  const bodyW = (full * sprite.width) / sprite.height;
  const k = clamp(1 - lift / (SH * 0.45), 0.25, 1) * Math.min(1, scale * 1.4); // ground shadow, shrinking as it rises — the same rule everywhere
  ctx.save(); ctx.globalAlpha = 0.24 * alpha * k * Math.min(1, appear * 2); ctx.fillStyle = "#4a3f22";
  ctx.beginPath(); ctx.ellipse(x, GROUND + 2, bodyW * 0.3 * k, SH * 0.018 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.globalAlpha = alpha * Math.min(1, appear * 2); ctx.translate(x, GROUND - lift); ctx.rotate(rot); ctx.scale(sx, sy);
  ctx.drawImage(sprite, -w / 2, -h, w, h); ctx.restore();
}
const U = CH / 151; // (the pot and plant were drawn at a 151-unit character; scaled to this one)
const POT_H = 44 * U;
function plant(ctx: CanvasRenderingContext2D, x: number, t: number, grow: number, glow = 0) { // a pot with a sprout; sways a little in both conditions
  const potW = 54 * U, potH = POT_H, base = GROUND;
  const sway = Math.sin(t * Math.PI * 2 * 0.55) * 0.035;
  if (glow > 0) { // (C HIGH: where the leaves land, the soil glows for a moment)
    const r = ctx.createRadialGradient(x, base - potH, 0, x, base - potH, potW * 0.9);
    r.addColorStop(0, `rgba(200,255,170,${0.55 * glow})`); r.addColorStop(1, "rgba(200,255,170,0)");
    ctx.fillStyle = r; ctx.beginPath(); ctx.arc(x, base - potH, potW * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  const stemH = (26 + grow * 92) * U, top = base - potH - stemH;
  ctx.save(); ctx.translate(x, base - potH + 2 * U); ctx.rotate(sway); ctx.translate(-x, -(base - potH + 2 * U));
  ctx.strokeStyle = "#5c9a3d"; ctx.lineWidth = 5 * U; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, base - potH + 4 * U); ctx.quadraticCurveTo(x - 6 * U, (base - potH + top) / 2, x, top); ctx.stroke();
  const leaf = (lx: number, ly: number, ang: number, s: number) => { if (s <= 0.01) return; ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang); ctx.scale(s * U, s * U);
    ctx.fillStyle = "#79b84c"; ctx.beginPath(); ctx.ellipse(13, 0, 14, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(24, 0); ctx.stroke(); ctx.restore(); };
  const topLeaf = 1 + 0.25 * Math.sin(clamp(grow, 0, 1) * Math.PI); // (the sprout's top leaves stretch as it shoots up)
  leaf(x, top + 2 * U, -0.5, topLeaf); leaf(x, top + 2 * U, Math.PI + 0.5, topLeaf); // the sprout's two leaves (always)
  [0.3, 0.55, 0.8].forEach((n, j) => { const g = clamp((grow - n * 0.9) / 0.22, 0, 1), s = g < 1 ? g * (1 + 0.35 * Math.sin(g * Math.PI)) : 1; // (each leaf pops open)
    const ly = base - potH - 26 * U - n * 92 * U * 0.95 * clamp(grow / n, 0, 1);
    if (grow > n * 0.9) leaf(x, ly, j % 2 ? -0.35 : Math.PI + 0.35, s * (1.15 - n * 0.2)); }); // HIGH only (grow > 0)
  ctx.restore();
  ctx.fillStyle = "#c46a3f"; ctx.beginPath(); ctx.moveTo(x - potW / 2, base - potH); ctx.lineTo(x + potW / 2, base - potH); ctx.lineTo(x + potW * 0.38, base); ctx.lineTo(x - potW * 0.38, base); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#d77d50"; ctx.fillRect(x - potW / 2 - 3 * U, base - potH - 8 * U, potW + 6 * U, 10 * U);
  ctx.fillStyle = "#6e4b2e"; ctx.fillRect(x - potW / 2 + 2 * U, base - potH - 2 * U, potW - 4 * U, 3 * U);
}
// C HIGH: what the character does to the pot — a twinkle at its side as it pushes, then a stream of bright little
// leaves (lit, so they stand apart from the scene's own drifting leaves) flying in an arc into the pot
function leafStream(ctx: CanvasRenderingContext2D, t: number, from: [number, number], to: [number, number], t0: number, t1: number) {
  for (let i = 0; i < 6; i++) { // the twinkle where the stream starts
    const tw = seg(t, t0 - 0.15 + i * 0.05, t0 + 0.45 + i * 0.05), a = Math.sin(tw * Math.PI);
    if (a <= 0) continue;
    const ang = (i / 6) * Math.PI * 2 + t * 3, r = SH * (0.025 + 0.02 * rnd(i + 90));
    star(ctx, from[0] + Math.cos(ang) * r, from[1] + Math.sin(ang) * r, (3.2 + 2.5 * rnd(i + 50)) * U * a, a);
  }
  const N = 20, FLY = 0.55;
  for (let i = 0; i < N; i++) {
    const start = t0 + (i / (N - 1)) * (t1 - t0 - FLY), p = (t - start) / FLY;
    if (p <= 0 || p >= 1) continue;
    const e = easeIO(p), arc = SH * (0.15 + 0.06 * rnd(i)), wob = (rnd(i + 40) - 0.5) * SH * 0.05;
    const cx = (from[0] + to[0]) / 2, cy = Math.min(from[1], to[1]) - arc;
    const x = (1 - e) * (1 - e) * from[0] + 2 * (1 - e) * e * cx + e * e * to[0];
    const y = (1 - e) * (1 - e) * from[1] + 2 * (1 - e) * e * (cy + wob) + e * e * to[1];
    const dx = 2 * (1 - e) * (cx - from[0]) + 2 * e * (to[0] - cx), dy = 2 * (1 - e) * (cy + wob - from[1]) + 2 * e * (to[1] - cy - wob);
    const a = Math.min(1, p * 5, (1 - p) * 4), s = (1.3 + 0.7 * rnd(i + 7)) * U;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 13 * s); halo.addColorStop(0, "rgba(235,255,200,0.75)"); halo.addColorStop(1, "rgba(235,255,200,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 13 * s, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(Math.atan2(dy, dx) + Math.sin(t * 14 + i) * 0.4); ctx.scale(s, s);
    ctx.fillStyle = i % 3 === 2 ? "#c6f27e" : "#8fdc4f"; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,240,0.95)"; ctx.beginPath(); ctx.arc(-2, -1, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) { // a small four-point twinkle
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = "#fffbe0";
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r); ctx.fill();
  ctx.restore();
}

const XL = SW * GEO.xl, XR = SW * GEO.xr, XC = SW * GEO.xc, XCHAR_C = SW * GEO.xchar, XPOT = SW * GEO.xpot;
const GONE = [2.35, 2.75] as const; // A HIGH: not on the stage (vanished at the left, not yet out at the right)
export const STIMULI: Stimulus[] = [
  { pair: "A", cond: "LOW", name: "Teleport", id: "PAIR_A_LOW_MOVE",
    render(ctx, s, t) { // the crouch, then big hops across the podium, a landing
      const P = (4.4 - 1.0) / 5, x = XL + (XR - XL) * easeIO(seg(t, 1.0, 4.4));
      const sq = crouch(t, 0.7, 1.0) || hopSq(t, 1.0, 5, P) || crouch(t, 4.4, 4.7, 0.08) || idleSq(t);
      character(ctx, s, { x, lift: hop(t, 1.0, 5, P, 0.065), sq, rot: t > 1.0 && t < 4.4 ? 0.08 : 0 }); } },
  { pair: "A", cond: "HIGH", name: "Teleport", id: "PAIR_A_HIGH_TELEPORT",
    render(ctx, s, t) { // the same crouch, then a charge-up: trembling harder and harder, rising a little; a spin into a
                        // point — gone — out of a point at the right with the same spin, a bounce, a landing
      if (t < GONE[0]) {
        const charge = seg(t, 1.0, 2.0), jit = t >= 1.0 && t < 2.0 ? Math.sin(t * Math.PI * 2 * 16) * SW * (0.004 + 0.012 * charge) : 0;
        const pulse = t >= 1.0 && t < 2.0 ? 0.05 * Math.sin(t * Math.PI * 2 * 7) * charge : 0;
        const p = seg(t, 2.0, GONE[0]);
        character(ctx, s, { x: XL + jit, lift: SH * 0.02 * charge * (1 - p), sq: crouch(t, 0.7, 1.0) || pulse || idleSq(t),
          scale: t >= 2.0 ? 1 - easeIn(p) * 0.97 : 1, turn: t >= 2.0 ? Math.cos(p * Math.PI * 4) : 1, alpha: t >= 2.0 ? 1 - Math.pow(p, 3) : 1 });
      } else if (t >= GONE[1]) {
        const p = seg(t, GONE[1], 3.1), q = seg(t, 3.1, 3.45);
        const scale = t < 3.1 ? easeOut(p) * 1.15 : 1.15 - 0.15 * easeOut(q);
        character(ctx, s, { x: XR, sq: crouch(t, 3.1, 3.45, 0.1) || idleSq(t), scale, turn: t < 3.1 ? Math.cos(p * Math.PI * 2) : 1, alpha: Math.min(1, p * 4) });
      }
    } },
  { pair: "B", cond: "LOW", name: "Fly", id: "PAIR_B_LOW_JUMP",
    render(ctx, s, t) { // crouch, an ordinary jump, the landing and a little rebound
      character(ctx, s, { ...jump(t, JUMP.low), x: XC }); } },
  { pair: "B", cond: "HIGH", name: "Fly", id: "PAIR_B_HIGH_FLY",
    render(ctx, s, t) { // the same crouch and air time — soaring ~3x as high
      character(ctx, s, { ...jump(t, JUMP.high), x: XC }); } },
  { pair: "C", cond: "LOW", name: "Grow plants", id: "PAIR_C_LOW_PLANT_CONTROL",
    render(ctx, s, t) { // hops and a wiggle beside the pot, facing out; the sprout stays as it is
      plant(ctx, XPOT, t, 0);
      const P = 0.62, wig = t > 2.24 && t < 2.9 ? Math.sin(seg(t, 2.24, 2.9) * Math.PI * 4) * 0.1 : 0;
      character(ctx, s, { x: XCHAR_C, lift: hop(t, 1.0, 2, P) || hop(t, 3.6, 1, P, 0.04), sq: hopSq(t, 1.0, 2, P) || hopSq(t, 3.6, 1, P) || idleSq(t), rot: wig }); } },
  { pair: "C", cond: "HIGH", name: "Grow plants", id: "PAIR_C_HIGH_GROW_PLANT",
    render(ctx, s, t) { // turns to the pot, winds up and pushes — leaves stream from it into the pot — the plant grows; a happy hop
      const toward = easeIO(seg(t, 1.0, 1.5)) * (1 - easeIO(seg(t, 2.9, 3.4)));
      const push = t >= 1.8 && t < 2.9 ? Math.sin(seg(t, 1.8, 2.9) * Math.PI) : 0;
      const x = XCHAR_C + SW * 0.02 * toward + SW * 0.012 * push;
      const glow = t >= 2.6 && t < 3.5 ? Math.sin(seg(t, 2.6, 3.5) * Math.PI) : 0;
      plant(ctx, XPOT, t, easeOut(seg(t, 2.75, 4.3)), glow);
      leafStream(ctx, t, [x + SW * 0.04, GROUND - CH * 0.5], [XPOT, GROUND - POT_H - 4 * U], 1.85, 2.95);
      const P = 0.62;
      character(ctx, s, { x, lift: hop(t, 3.75, 1, P, 0.05), rot: 0.12 * toward + 0.1 * push,
        sq: crouch(t, 1.5, 1.85, 0.12) || -0.08 * push || hopSq(t, 3.75, 1, P) || idleSq(t) }); } },
];
// B: the crouch (1.6–1.95), 1.2 s in the air to `apex` (fast up, a moment at the top, down), the landing, a rebound
function jump(t: number, apex: number): Omit<Pose, "x"> {
  const A0 = 1.95, AIR = 1.2;
  if (t >= 1.6 && t < A0) return { sq: crouch(t, 1.6, A0 + 0.05, 0.16) };
  if (t >= A0 && t < A0 + AIR) {
    const p = (t - A0) / AIR, up = p < 0.5 ? easeOut(p / 0.5) : 1 - easeIn((p - 0.5) / 0.5);
    return { lift: SH * apex * up, sq: p < 0.35 ? -0.08 : p > 0.75 ? -0.05 : 0 };
  }
  if (t >= A0 + AIR && t < A0 + AIR + 0.3) return { sq: crouch(t, A0 + AIR, A0 + AIR + 0.3, 0.14) };
  if (t >= A0 + AIR + 0.3 && t < A0 + AIR + 0.3 + 0.84) { const q = (t - A0 - AIR - 0.3) / 0.42; return { lift: Math.sin((q % 1) * Math.PI) * SH * 0.025 * (q < 1 ? 1 : 0.5) }; }
  return { sq: idleSq(t) };
}
const byId = (id: StimulusId) => STIMULI.find((s) => s.id === id)!;
// where each clip leaves the character at its end (the walk to the world starts from there)
export const endX = (id: StimulusId) => (id === "PAIR_A_LOW_MOVE" || id === "PAIR_A_HIGH_TELEPORT" ? XR : id.startsWith("PAIR_B") ? XC : XCHAR_C);

// one frame: `appearK` < 1 = the reveal (the character popping in at the clip's start pose); plain = draw the
// neutral backdrop (the demo, the covariate) — otherwise transparent, over the kiosk's own scene
export function drawFrame(ctx: CanvasRenderingContext2D, id: StimulusId, sprite: Sprite | null, t: number, appearK = 1, plain = false, clear = true) {
  if (clear) ctx.clearRect(0, 0, SW, SH); // (false: over a backdrop already drawn on this canvas)
  if (plain) drawPlainStage(ctx);
  appear = appearK;
  byId(id).render(ctx, sprite, t);
  appear = 1;
}
// the walk to the digital world after the observation window: from the clip's end place, hop-walking off the
// right edge (s = seconds since it set off); in Pair C the pot (grown or not) stays where it is
export function drawWalkOff(ctx: CanvasRenderingContext2D, id: StimulusId, sprite: Sprite | null, s: number, tClip: number) {
  ctx.clearRect(0, 0, SW, SH);
  if (id.startsWith("PAIR_C")) plant(ctx, XPOT, tClip, id === "PAIR_C_HIGH_GROW_PLANT" ? 1 : 0);
  const x0 = endX(id), x = x0 + (SW * 1.25 - x0) * Math.pow(seg(s, 0.2, 4.6), 1.35);
  character(ctx, sprite, { x, lift: Math.abs(Math.sin((s / 0.48) * Math.PI)) * SH * 0.025, rot: s > 0.2 ? 0.06 : 0 });
}

export type ClipMetrics = { id: StimulusId; motion: number; moving: number; visible: number; lum: number; sat: number };
// how much a clip moves (sum of frame-to-frame screen change, 30 fps at 160x90, on the plain backdrop), and its
// light and colour — the matching check, and per session the covariate (the child's own character in the clip)
export function measure(id: StimulusId, sprite: Sprite | null): ClipMetrics {
  const MW = 160, MH = 90, F = Math.round(DURATION * 30);
  const c = Object.assign(document.createElement("canvas"), { width: MW, height: MH });
  const g = c.getContext("2d", { willReadFrequently: true })!; g.scale(MW / SW, MH / SH);
  let prev: Uint8ClampedArray | null = null, motion = 0, movingFrames = 0, lum = 0, sat = 0, visible = 0;
  for (let f = 0; f <= F; f++) {
    const t = (f / F) * DURATION;
    drawFrame(g, id, sprite, t, 1, true);
    const d = g.getImageData(0, 0, MW, MH).data; let diff = 0, lsum = 0, ssum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      lsum += 0.299 * r + 0.587 * gg + 0.114 * b; ssum += Math.max(r, gg, b) - Math.min(r, gg, b);
      if (prev) diff += Math.abs(r - prev[i]) + Math.abs(gg - prev[i + 1]) + Math.abs(b - prev[i + 2]);
    }
    if (prev) { const m = diff / (MW * MH * 3); motion += m; if (m > 0.15) movingFrames++; }
    lum += lsum / (MW * MH); sat += ssum / (MW * MH); prev = d.slice();
    if (!(id === "PAIR_A_HIGH_TELEPORT" && t >= GONE[0] && t < GONE[1])) visible++;
  }
  return { id, motion: +motion.toFixed(2), moving: +(movingFrames / 30).toFixed(2), visible: +((visible / (F + 1)) * DURATION).toFixed(2), lum: +(lum / (F + 1)).toFixed(1), sat: +(sat / (F + 1)).toFixed(1) };
}

// the kiosk scene is drawn `cover` (background-size: cover; centred): the canvas uses the same fit so the
// stage's ground line lands on the painted podium at any window size
export function coverTransform(w: number, h: number) {
  const k = Math.max(w / SW, h / SH);
  return { k, ox: (w - SW * k) / 2, oy: (h - SH * k) / 2 };
}
