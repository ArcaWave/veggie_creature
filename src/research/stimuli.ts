// The six stimuli of the suggestiveness experiment (docs/RESEARCH.md): one deterministic timeline each,
// render(ctx, sprite, t) for t in 0…DURATION s — the same character size, start / end pose and idle motion;
// what the character is shown to DO differs between LOW and HIGH. Past DURATION every stimulus holds its end
// pose and keeps breathing (the observation window). No text, no sound.
// They play inside the kiosk's own "살아났다!" scene, on its podium, with the child's clay character
// (research/figure.ts) — drawn on a transparent canvas laid over the scene. No generative AI anywhere.
//   A  LOW  a crouch, then big hops across the podium   HIGH  a crouch, a glowing, trembling charge-up, a spin into a
//                                                             point with a burst — a comet across — a burst, and out
//                                                             of a point on the other side
//   B  LOW  a crouch and an ordinary jump               HIGH  the same crouch and air time, ~3x as high — a burst at
//                                                             take-off, glowing all the way up with a trail of stars
//   C  LOW  hops and a wiggle beside the pot            HIGH  turns to the pot, winds up and pushes — a beam of sparkles
//           (the sprout stays as it is)                       and leaves into the pot, the soil flares, the plant shoots
//                                                             up past the character's head and a big flower bursts open
// The HIGH clips share one look for "a superpower" (a glow, sparkles, bursts, a trail) in colours that stand apart
// from the scene's warm greens, so even the youngest child sees magic rather than an ordinary move; the LOW clips
// have none of it.
export const DURATION = 5.6;
// which version of the clips a session saw (kept with every session — the clips changed during the exhibition):
// "" (sessions before 10/5) = v1, the plain moves; "2026-10-05-magic" = the HIGH clips with the magic look
export const STIMULUS_VERSION = "2026-10-05-magic";
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
const GROW = 150; // C HIGH: how much the stem grows (units) — the plant ends up taller than the character
function plant(ctx: CanvasRenderingContext2D, x: number, t: number, grow: number, glow = 0, bloom = 0) { // a pot with a sprout; sways a little in both conditions
  const potW = 54 * U, potH = POT_H, base = GROUND;
  const sway = Math.sin(t * Math.PI * 2 * 0.55) * 0.035;
  if (glow > 0) aura(ctx, x, base - potH, potW * 1.5, glow); // (C HIGH: where the magic lands, the soil flares)
  const stemH = (26 + grow * GROW) * U, top = base - potH - stemH;
  ctx.save(); ctx.translate(x, base - potH + 2 * U); ctx.rotate(sway); ctx.translate(-x, -(base - potH + 2 * U));
  ctx.strokeStyle = "#5c9a3d"; ctx.lineWidth = (5 + 2.5 * grow) * U; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, base - potH + 4 * U); ctx.quadraticCurveTo(x - 6 * U, (base - potH + top) / 2, x, top); ctx.stroke();
  const leaf = (lx: number, ly: number, ang: number, s: number) => { if (s <= 0.01) return; ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang); ctx.scale(s * U, s * U);
    ctx.fillStyle = "#79b84c"; ctx.beginPath(); ctx.ellipse(13, 0, 14, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(24, 0); ctx.stroke(); ctx.restore(); };
  const topLeaf = 1 + 0.25 * Math.sin(clamp(grow, 0, 1) * Math.PI); // (the sprout's top leaves stretch as it shoots up)
  leaf(x, top + 2 * U, -0.5, topLeaf); leaf(x, top + 2 * U, Math.PI + 0.5, topLeaf); // the sprout's two leaves (always)
  [0.16, 0.32, 0.48, 0.64, 0.8].forEach((n, j) => { const g = clamp((grow - n * 0.9) / 0.2, 0, 1), s = g < 1 ? g * (1 + 0.35 * Math.sin(g * Math.PI)) : 1; // (each leaf pops open)
    const ly = base - potH - 26 * U - n * GROW * U * 0.95 * clamp(grow / n, 0, 1);
    if (grow > n * 0.9) leaf(x, ly, j % 2 ? -0.35 : Math.PI + 0.35, s * (1.55 - n * 0.55)); }); // HIGH only (grow > 0)
  if (bloom > 0) flower(ctx, x, top - 4 * U, bloom, t);
  ctx.restore();
  ctx.fillStyle = "#c46a3f"; ctx.beginPath(); ctx.moveTo(x - potW / 2, base - potH); ctx.lineTo(x + potW / 2, base - potH); ctx.lineTo(x + potW * 0.38, base); ctx.lineTo(x - potW * 0.38, base); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#d77d50"; ctx.fillRect(x - potW / 2 - 3 * U, base - potH - 8 * U, potW + 6 * U, 10 * U);
  ctx.fillStyle = "#6e4b2e"; ctx.fillRect(x - potW / 2 + 2 * U, base - potH - 2 * U, potW - 4 * U, 3 * U);
}
// C HIGH: the flower at the top of the grown plant, bursting open (b 0→1, with an overshoot)
function flower(ctx: CanvasRenderingContext2D, x: number, y: number, b: number, t: number) {
  const s = b < 1 ? easeOut(b) * (1 + 0.25 * Math.sin(b * Math.PI)) : 1, R = 27 * U * s;
  if (R <= 0.3) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.15 * (1 - b) + Math.sin(t * 1.3) * 0.04);
  for (let i = 0; i < 8; i++) {
    ctx.save(); ctx.rotate((i / 8) * Math.PI * 2);
    ctx.fillStyle = i % 2 ? "#ff8ac4" : "#ff6fb3"; ctx.beginPath(); ctx.ellipse(R * 0.62, 0, R * 0.5, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.ellipse(R * 0.55, -R * 0.06, R * 0.24, R * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#ffc21f"; ctx.beginPath(); ctx.arc(0, 0, R * 0.36, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffe27a"; ctx.beginPath(); ctx.arc(-R * 0.09, -R * 0.1, R * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
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
  const beam = Math.sin(seg(t, t0, t1) * Math.PI); // (a soft rainbow arc under the stream while it flows)
  if (beam > 0) {
    const cx = (from[0] + to[0]) / 2, cy = Math.min(from[1], to[1]) - SH * 0.2;
    const g = ctx.createLinearGradient(from[0], 0, to[0], 0); g.addColorStop(0, rgba(MAGIC[1], 0.8 * beam)); g.addColorStop(0.5, rgba(MAGIC[0], 0.8 * beam)); g.addColorStop(1, rgba(MAGIC[3], 0.85 * beam));
    ctx.save(); ctx.strokeStyle = g; ctx.lineCap = "round";
    for (const [w, a] of [[20, 0.3], [8, 1]] as const) { ctx.globalAlpha = a; ctx.lineWidth = w * U; ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.quadraticCurveTo(cx, cy, to[0], to[1]); ctx.stroke(); }
    ctx.restore();
  }
  const N = 26, FLY = 0.55;
  for (let i = 0; i < N; i++) {
    const start = t0 + (i / (N - 1)) * (t1 - t0 - FLY), p = (t - start) / FLY;
    if (p <= 0 || p >= 1) continue;
    const e = easeIO(p), arc = SH * (0.15 + 0.06 * rnd(i)), wob = (rnd(i + 40) - 0.5) * SH * 0.05;
    const cx = (from[0] + to[0]) / 2, cy = Math.min(from[1], to[1]) - arc;
    const x = (1 - e) * (1 - e) * from[0] + 2 * (1 - e) * e * cx + e * e * to[0];
    const y = (1 - e) * (1 - e) * from[1] + 2 * (1 - e) * e * (cy + wob) + e * e * to[1];
    const dx = 2 * (1 - e) * (cx - from[0]) + 2 * e * (to[0] - cx), dy = 2 * (1 - e) * (cy + wob - from[1]) + 2 * e * (to[1] - cy - wob);
    const a = Math.min(1, p * 5, (1 - p) * 4), s = (1.3 + 0.7 * rnd(i + 7)) * U;
    if (i % 2) { sparkle(ctx, x, y, (3.8 + 1.8 * rnd(i + 11)) * U, a, i); continue; } // (every other one a sparkle)
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

// ---- the HIGH clips' magic ---------------------------------------------------------------------------------------
const MAGIC = ["#ff4fcf", "#8f63ff", "#2fc6ff", "#ffc21f"]; // pink, violet, sky, gold
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${clamp(a, 0, 1)})`;
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, i: number) { // a coloured star with a white heart, in a halo
  if (a <= 0.01 || r <= 0.05) return;
  const col = MAGIC[((i % MAGIC.length) + MAGIC.length) % MAGIC.length];
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
  const h = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4); h.addColorStop(0, rgba(col, 0.9)); h.addColorStop(0.4, rgba(col, 0.45)); h.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
  starPath(ctx, x, y, r * 1.5); ctx.fillStyle = col; ctx.fill();
  starPath(ctx, x, y, r * 0.75); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.restore();
}
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
}
function aura(ctx: CanvasRenderingContext2D, x: number, cy: number, r: number, a: number) { // the glow of a power around the character
  if (a <= 0.01 || r <= 1) return;
  const g = ctx.createRadialGradient(x, cy, r * 0.1, x, cy, r);
  g.addColorStop(0, `rgba(255,255,255,${0.6 * a})`); g.addColorStop(0.4, rgba("#b38cff", 0.62 * a)); g.addColorStop(0.75, rgba("#ff6fd2", 0.36 * a)); g.addColorStop(1, "rgba(255,111,210,0)");
  ctx.save(); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function orbit(ctx: CanvasRenderingContext2D, x: number, cy: number, rx: number, ry: number, t: number, n: number, a: number, speed: number, seed = 0) { // sparkles circling
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + t * speed + rnd(i + seed) * 0.6, tw = 0.65 + 0.35 * Math.sin(t * 9 + i * 1.7);
    sparkle(ctx, x + Math.cos(ang) * rx, cy + Math.sin(ang) * ry, (3.6 + 2 * rnd(i + seed + 20)) * U * tw, a * tw, i + seed);
  }
}
function burst(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, R: number, seed = 0, n = 12) { // p 0→1: a ring and stars flying out
  if (p <= 0 || p >= 1) return;
  const e = easeOut(p), fade = 1 - p;
  ctx.save();
  ctx.globalAlpha = fade; ctx.lineWidth = (5 * (1 - p) + 1) * U;
  ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.beginPath(); ctx.arc(x, y, R * e, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = (3 * (1 - p) + 0.8) * U; ctx.strokeStyle = rgba(MAGIC[seed % 4], 0.85); ctx.beginPath(); ctx.arc(x, y, R * e * 0.82, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  const flash = clamp(1 - p * 3, 0, 1);
  if (flash > 0) aura(ctx, x, y, R * (0.5 + 0.6 * e), flash);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rnd(i + seed) * 0.5, d = R * (0.35 + 0.95 * e) * (0.75 + 0.35 * rnd(i + seed + 7));
    sparkle(ctx, x + Math.cos(ang) * d, y + Math.sin(ang) * d, (4.2 + 2.4 * rnd(i + seed + 3)) * U * (1 - 0.5 * p), fade, i + seed);
  }
}
const quad = (a: number, b: number, c: number, e: number) => (1 - e) * (1 - e) * a + 2 * (1 - e) * e * b + e * e * c;

const XL = SW * GEO.xl, XR = SW * GEO.xr, XC = SW * GEO.xc, XCHAR_C = SW * GEO.xchar, XPOT = SW * GEO.xpot;
const BODY_CY = (lift = 0) => GROUND - lift - CH * 0.5; // the middle of the character's body
const GONE = [2.35, 2.95] as const; // A HIGH: not on the stage (vanished at the left, a comet across, not yet out at the right)
export const STIMULI: Stimulus[] = [
  { pair: "A", cond: "LOW", name: "Teleport", id: "PAIR_A_LOW_MOVE",
    render(ctx, s, t) { // the crouch, then big hops across the podium, a landing
      const P = (4.4 - 1.0) / 5, x = XL + (XR - XL) * easeIO(seg(t, 1.0, 4.4));
      const sq = crouch(t, 0.7, 1.0) || hopSq(t, 1.0, 5, P) || crouch(t, 4.4, 4.7, 0.08) || idleSq(t);
      character(ctx, s, { x, lift: hop(t, 1.0, 5, P, 0.065), sq, rot: t > 1.0 && t < 4.4 ? 0.08 : 0 }); } },
  { pair: "A", cond: "HIGH", name: "Teleport", id: "PAIR_A_HIGH_TELEPORT",
    render(ctx, s, t) { // the same crouch, then a charge-up: a glow gathering, sparkles circling faster and faster, trembling
                        // harder and harder, rising a little; a spin into a point and a burst — a comet across the podium —
                        // a burst, and out of a point at the right with the same spin; a bounce, a landing, a last twinkle
      const OUT = GONE[1] + 0.35, cy = BODY_CY();
      if (t < GONE[0]) {
        const charge = seg(t, 1.0, 2.0), jit = t >= 1.0 && t < 2.0 ? Math.sin(t * Math.PI * 2 * 16) * SW * (0.0025 + 0.0075 * charge) : 0; // (a third gentler after the first look)
        const pulse = t >= 1.0 && t < 2.0 ? 0.035 * Math.sin(t * Math.PI * 2 * 7) * charge : 0;
        const p = seg(t, 2.0, GONE[0]), shrink = 1 - 0.85 * easeIn(p), lift = SH * 0.02 * charge * (1 - p);
        aura(ctx, XL, BODY_CY(lift), CH * (0.45 + 0.3 * charge) * shrink, charge);
        character(ctx, s, { x: XL + jit, lift, sq: crouch(t, 0.7, 1.0) || pulse || idleSq(t),
          scale: t >= 2.0 ? 1 - easeIn(p) * 0.97 : 1, turn: t >= 2.0 ? Math.cos(p * Math.PI * 4) : 1, alpha: t >= 2.0 ? 1 - Math.pow(p, 3) : 1 });
        if (t >= 1.0) orbit(ctx, XL, BODY_CY(lift), CH * 0.52 * shrink, CH * 0.44 * shrink, t, 7, Math.min(1, charge * 1.6), 2 + 9 * charge);
      } else if (t >= GONE[1]) {
        const p = seg(t, GONE[1], OUT), q = seg(t, OUT, OUT + 0.35);
        const scale = t < OUT ? easeOut(p) * 1.15 : 1.15 - 0.15 * easeOut(q);
        aura(ctx, XR, cy, CH * 0.72, 1 - seg(t, GONE[1] + 0.2, GONE[1] + 1.1));
        character(ctx, s, { x: XR, sq: crouch(t, OUT, OUT + 0.35, 0.1) || idleSq(t), scale, turn: t < OUT ? Math.cos(p * Math.PI * 2) : 1, alpha: Math.min(1, p * 4) });
        orbit(ctx, XR, cy, CH * 0.55, CH * 0.45, t, 6, 1 - seg(t, OUT + 0.3, OUT + 1.1), 3, 30);
      }
      burst(ctx, XL, cy, seg(t, GONE[0] - 0.05, GONE[0] + 0.6), CH * 0.7, 0);
      comet(ctx, t, [XL, cy], [XR, cy], GONE[0], GONE[1]);
      burst(ctx, XR, cy, seg(t, GONE[1] - 0.05, GONE[1] + 0.6), CH * 0.75, 2);
    } },
  { pair: "B", cond: "LOW", name: "Fly", id: "PAIR_B_LOW_JUMP",
    render(ctx, s, t) { // crouch, an ordinary jump, the landing and a little rebound
      character(ctx, s, { ...jump(t, JUMP.low), x: XC }); } },
  { pair: "B", cond: "HIGH", name: "Fly", id: "PAIR_B_HIGH_FLY",
    render(ctx, s, t) { // the same crouch and air time — power gathering in the crouch, a burst at take-off, soaring ~3x as
                        // high in a glow with a trail of stars below it, a twinkle at the top, a ring where it lands
      const pose = jump(t, JUMP.high), lift = pose.lift ?? 0, LAND = JUMP_A0 + JUMP_AIR;
      const charge = seg(t, 1.45, JUMP_A0);
      aura(ctx, XC, BODY_CY(lift), CH * 0.66, t < JUMP_A0 ? charge : 1 - seg(t, LAND - 0.1, LAND + 0.5));
      if (t >= JUMP_A0 && t < LAND + 0.45) for (let k = 1; k <= 14; k++) { // the trail: where it was a moment ago
        const tk = t - k * 0.04; if (tk < JUMP_A0) break;
        const lk = jump(tk, JUMP.high).lift ?? 0, a = (1 - k / 15) * (1 - seg(t, LAND, LAND + 0.45));
        sparkle(ctx, XC + (rnd(k + 60) - 0.5) * CH * 0.5, GROUND - lk - CH * 0.05, (2.6 + 2.6 * (1 - k / 15)) * U, a, k);
      }
      const top = JUMP_A0 + JUMP_AIR * 0.5;
      burst(ctx, XC, BODY_CY(SH * JUMP.high), seg(t, top - 0.12, top + 0.45), CH * 0.7, 3, 10); // the top
      burst(ctx, XC, GROUND - 4 * U, seg(t, JUMP_A0 - 0.05, JUMP_A0 + 0.55), CH * 0.8, 1, 14); // take-off
      burst(ctx, XC, GROUND - 4 * U, seg(t, LAND, LAND + 0.5), CH * 0.55, 0, 10);          // the landing (all behind it)
      character(ctx, s, { ...pose, x: XC });
      if (t >= 1.45 && t < JUMP_A0 + 0.15) orbit(ctx, XC, BODY_CY(lift), CH * 0.52, CH * 0.42, t, 6, charge * (1 - seg(t, JUMP_A0, JUMP_A0 + 0.15)), 6, 50);
    } },
  { pair: "C", cond: "LOW", name: "Grow plants", id: "PAIR_C_LOW_PLANT_CONTROL",
    render(ctx, s, t) { // hops and a wiggle beside the pot, facing out; the sprout stays as it is
      plant(ctx, XPOT, t, 0);
      const P = 0.62, wig = t > 2.24 && t < 2.9 ? Math.sin(seg(t, 2.24, 2.9) * Math.PI * 4) * 0.1 : 0;
      character(ctx, s, { x: XCHAR_C, lift: hop(t, 1.0, 2, P) || hop(t, 3.6, 1, P, 0.04), sq: hopSq(t, 1.0, 2, P) || hopSq(t, 3.6, 1, P) || idleSq(t), rot: wig }); } },
  { pair: "C", cond: "HIGH", name: "Grow plants", id: "PAIR_C_HIGH_GROW_PLANT",
    render(ctx, s, t) { // turns to the pot, winds up in a glow and pushes — a beam of sparkles and leaves into the pot — the
                        // soil flares, the plant shoots up past the character's head with sparkles climbing it, and a big
                        // flower bursts open; a happy hop
      const toward = easeIO(seg(t, 1.0, 1.5)) * (1 - easeIO(seg(t, 2.95, 3.45)));
      const push = t >= 1.8 && t < 2.95 ? Math.sin(seg(t, 1.8, 2.95) * Math.PI) : 0;
      const x = XCHAR_C + SW * 0.02 * toward + SW * 0.012 * push;
      const grow = easeOut(seg(t, 2.75, 4.1)), bloom = seg(t, 3.95, 4.5), stemTop = GROUND - POT_H - (26 + grow * GROW) * U - 4 * U;
      const glow = t >= 2.6 && t < 3.6 ? Math.sin(seg(t, 2.6, 3.6) * Math.PI) : 0;
      const power = Math.sin(seg(t, 1.45, 3.05) * Math.PI); // (its own glow and sparkles while it works the magic)
      aura(ctx, x, BODY_CY(), CH * 0.68, 0.9 * power);
      plant(ctx, XPOT, t, grow, glow, bloom);
      if (t >= 2.75 && t < 4.4) for (let i = 0; i < 8; i++) { // sparkles spiralling up the plant as it grows
        const f = ((t - 2.75) * 0.9 + i / 8) % 1, h = (26 + grow * GROW) * U;
        sparkle(ctx, XPOT + Math.sin(f * 10 + i) * 15 * U, GROUND - POT_H - f * h, (2.4 + 1.4 * rnd(i + 80)) * U, Math.sin(f * Math.PI) * (1 - seg(t, 4.1, 4.4)), i + 1);
      }
      burst(ctx, XPOT, GROUND - POT_H, seg(t, 2.72, 3.35), POT_H * 1.7, 1, 12); // the soil flares
      burst(ctx, XPOT, stemTop, seg(t, 3.95, 4.7), 46 * U, 0, 14);              // the flower bursts open
      orbit(ctx, XPOT, stemTop, 32 * U, 24 * U, t, 6, seg(t, 4.3, 4.6) * (1 - seg(t, 5.0, 5.6)), 2.2, 70);
      const P = 0.62;
      character(ctx, s, { x, lift: hop(t, 4.55, 1, P, 0.05), rot: 0.12 * toward + 0.1 * push,
        sq: crouch(t, 1.5, 1.85, 0.12) || -0.08 * push || hopSq(t, 4.55, 1, P) || idleSq(t) });
      orbit(ctx, x, BODY_CY(), CH * 0.55, CH * 0.45, t, 7, power, 4, 40);
      leafStream(ctx, t, [x + CH * 0.42, GROUND - CH * 0.48], [XPOT, GROUND - POT_H - 4 * U], 1.85, 2.95); } }, // (from its hand, over it)
];
// A HIGH: the comet that carries it across while it is gone — a bright head in a glow over the podium, stars behind
function comet(ctx: CanvasRenderingContext2D, t: number, from: [number, number], to: [number, number], t0: number, t1: number) {
  const fade = 1 - seg(t, t1, t1 + 0.2);
  if (t < t0 || fade <= 0) return;
  const at = (e: number) => [quad(from[0], (from[0] + to[0]) / 2, to[0], e), quad(from[1], from[1] - SH * 0.24, to[1], e)] as const;
  const e = easeIO(seg(t, t0, t1));
  for (let k = 12; k >= 1; k--) {
    const ek = e - k * 0.035; if (ek <= 0) continue;
    const [px, py] = at(ek), w = 1 - k / 13;
    sparkle(ctx, px + (rnd(k + 20) - 0.5) * 8 * U, py + (rnd(k + 33) - 0.5) * 8 * U, (1.8 + 3 * w) * U, w * fade, k);
  }
  if (t <= t1) { const [hx, hy] = at(e); aura(ctx, hx, hy, 34 * U, 1); sparkle(ctx, hx, hy, 6.5 * U, 1, 3); }
}
// B: the crouch (1.6–1.95), 1.2 s in the air to `apex` (fast up, a moment at the top, down), the landing, a rebound
const JUMP_A0 = 1.95, JUMP_AIR = 1.2;
function jump(t: number, apex: number): Omit<Pose, "x"> {
  const A0 = JUMP_A0, AIR = JUMP_AIR;
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
  if (id.startsWith("PAIR_C")) { const high = id === "PAIR_C_HIGH_GROW_PLANT" ? 1 : 0; plant(ctx, XPOT, tClip, high, 0, high); }
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
