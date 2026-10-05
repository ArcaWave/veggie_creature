// The six stimuli of the suggestiveness experiment (docs/RESEARCH.md): one deterministic timeline each,
// render(ctx, sprite, t) for t in 0…DURATION s — the same character size, start / end pose and idle motion;
// only what the character is shown to DO differs between LOW and HIGH. Past DURATION every stimulus holds its
// end pose and keeps breathing (the observation window). No text, no sound.
// They play inside the kiosk's own "살아났다!" scene, on its podium, with the child's clay character
// (research/figure.ts) — drawn on a transparent canvas laid over the scene. No generative AI anywhere.
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

// Where things stand, in stage fractions. The kiosk's scene: feet on the podium (its top at ~80 % of the
// height, the podium spanning ~26–74 % of the width), the body half the screen tall — so a flight to the
// same height as the jump stays on screen and the walk / the blink stay on the podium.
export const GEO = { ground: 0.8, ch: 0.5, xl: 0.33, xr: 0.67, xc: 0.5, xchar: 0.39, xpot: 0.63, hj: 0.2, hop: 0.03 };
const GROUND = SH * GEO.ground, CH = SH * GEO.ch;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const easeIO = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 2.2);
const breathe = (t: number) => 1 + 0.012 * Math.sin(t * Math.PI * 2 * 0.9); // idle: a slow breath (the same everywhere)
const HOP = 4 / 6;                                                            // one hop = 0.667 s
// Movement amounts within each pair are matched with these (?research=demo's table): Pair B with a gentle
// hover and the jump's natural landing rebound; Pair C within a few %. Pair A's LOW walks across the podium
// (the start and end places are fixed by design), so it moves more — the hops are kept the same rather than
// pumping HIGH up; every session logs its clip's movement amount as a covariate.
const P = { hoverB: 0.008, settleB_low: 0.025 };
const hopLift = (t: number, a: number, n: number) => { const p = (t - a) / HOP; return p > 0 && p < n ? Math.abs(Math.sin(p * Math.PI)) * SH * GEO.hop : 0; };
const hopSquash = (t: number, a: number, n: number) => { const p = (t - a) / HOP; if (p <= 0 || p >= n) return 0; const f = p % 1; return f < 0.12 || f > 0.88 ? 0.06 : -0.03; };

let appear = 1; // the reveal: 0 → 1 as the character pops onto the stage (the stimuli themselves run at 1)

export function drawPlainStage(ctx: CanvasRenderingContext2D) { // (the demo's neutral backdrop, and the covariate's)
  const g = ctx.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, "#dcebf3"); g.addColorStop(1, "#f6f1e3");
  ctx.fillStyle = g; ctx.fillRect(0, 0, SW, GROUND);
  const f = ctx.createLinearGradient(0, GROUND, 0, SH); f.addColorStop(0, "#c9dca8"); f.addColorStop(1, "#b3cc8f");
  ctx.fillStyle = f; ctx.fillRect(0, GROUND, SW, SH - GROUND);
}
function character(ctx: CanvasRenderingContext2D, sprite: Sprite | null, x: number, lift: number, sq = 0, rot = 0, alpha = 1) {
  if (!sprite || alpha <= 0 || appear <= 0) return;
  const pop = appear < 1 ? 1 + Math.sin(appear * Math.PI) * 0.12 * (1 - appear) : 1; // a soft overshoot as it appears
  const k0 = appear < 1 ? easeOut(appear) * pop : 1;
  const h = (CH / (sprite.bodyFrac ?? 1)) * k0, w = (h * sprite.width) / sprite.height, sy = 1 - sq, sx = 1 + sq * 0.6;
  const bodyW = ((CH / (sprite.bodyFrac ?? 1)) * sprite.width) / sprite.height;
  const k = clamp(1 - lift / (SH * 0.5), 0.35, 1); // ground shadow, shrinking as it rises — the same rule everywhere
  ctx.save(); ctx.globalAlpha = 0.24 * alpha * k * Math.min(1, appear * 2); ctx.fillStyle = "#4a3f22";
  ctx.beginPath(); ctx.ellipse(x, GROUND + 2, bodyW * 0.3 * k, SH * 0.018 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.globalAlpha = alpha * Math.min(1, appear * 2); ctx.translate(x, GROUND - lift); ctx.rotate(rot); ctx.scale(sx, sy);
  ctx.drawImage(sprite, -w / 2, -h, w, h); ctx.restore();
}
function plant(ctx: CanvasRenderingContext2D, x: number, t: number, grow: number) { // a pot with a sprout; sways a little in both conditions
  const u = CH / 151; // (drawn at a 151-unit character; scaled to this one)
  const potW = 54 * u, potH = 44 * u, base = GROUND;
  const sway = Math.sin(t * Math.PI * 2 * 0.55) * 0.035;
  const stemH = (26 + grow * 92) * u, top = base - potH - stemH;
  ctx.save(); ctx.translate(x, base - potH + 2 * u); ctx.rotate(sway); ctx.translate(-x, -(base - potH + 2 * u));
  ctx.strokeStyle = "#5c9a3d"; ctx.lineWidth = 5 * u; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, base - potH + 4 * u); ctx.quadraticCurveTo(x - 6 * u, (base - potH + top) / 2, x, top); ctx.stroke();
  const leaf = (lx: number, ly: number, ang: number, s: number) => { if (s <= 0.01) return; ctx.save(); ctx.translate(lx, ly); ctx.rotate(ang); ctx.scale(s * u, s * u);
    ctx.fillStyle = "#79b84c"; ctx.beginPath(); ctx.ellipse(13, 0, 14, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(24, 0); ctx.stroke(); ctx.restore(); };
  leaf(x, top + 2 * u, -0.5, 1); leaf(x, top + 2 * u, Math.PI + 0.5, 1); // the sprout's two leaves (always)
  [0.3, 0.55, 0.8].forEach((n, j) => { const s = clamp((grow - n * 0.9) / 0.25, 0, 1); const ly = base - potH - 26 * u - n * 92 * u * 0.95 * clamp(grow / n, 0, 1);
    if (grow > n * 0.9) leaf(x, ly, j % 2 ? -0.35 : Math.PI + 0.35, s * (1.15 - n * 0.2)); }); // HIGH only (grow > 0)
  ctx.restore();
  ctx.fillStyle = "#c46a3f"; ctx.beginPath(); ctx.moveTo(x - potW / 2, base - potH); ctx.lineTo(x + potW / 2, base - potH); ctx.lineTo(x + potW * 0.38, base); ctx.lineTo(x - potW * 0.38, base); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#d77d50"; ctx.fillRect(x - potW / 2 - 3 * u, base - potH - 8 * u, potW + 6 * u, 10 * u);
  ctx.fillStyle = "#6e4b2e"; ctx.fillRect(x - potW / 2 + 2 * u, base - potH - 2 * u, potW - 4 * u, 3 * u);
}

const XL = SW * GEO.xl, XR = SW * GEO.xr, XC = SW * GEO.xc, XCHAR_C = SW * GEO.xchar, XPOT = SW * GEO.xpot;
const BLINK_AT = 0.7 + 3 * HOP; // Pair A HIGH: 3 hops, then the blink (0.2 s out, 0.2 s in)
export const STIMULI: Stimulus[] = [
  { pair: "A", cond: "LOW", name: "Teleport", id: "PAIR_A_LOW_MOVE",
    render(ctx, s, t) { // walks (hops) from left to right
      const x = XL + (XR - XL) * easeIO(seg(t, 0.7, 4.7));
      character(ctx, s, x, hopLift(t, 0.7, 6), hopSquash(t, 0.7, 6) || 1 - breathe(t), t > 0.7 && t < 4.7 ? 0.05 : 0); } },
  { pair: "A", cond: "HIGH", name: "Teleport", id: "PAIR_A_HIGH_TELEPORT",
    render(ctx, s, t) { // the same hops in place at the left, vanishes, appears at the right, hops on
      const T1 = BLINK_AT, x = t >= T1 + 0.2 ? XR : XL;
      const alpha = t < T1 ? 1 : t < T1 + 0.2 ? 1 - seg(t, T1, T1 + 0.2) : t < T1 + 0.4 ? seg(t, T1 + 0.2, T1 + 0.4) : 1;
      const lift = t < T1 ? hopLift(t, 0.7, 3) : hopLift(t, T1 + 0.4, 2);
      const sq = (t < T1 ? hopSquash(t, 0.7, 3) : hopSquash(t, T1 + 0.4, 2)) || 1 - breathe(t);
      character(ctx, s, x, lift, sq, 0, alpha); } },
  { pair: "B", cond: "LOW", name: "Fly", id: "PAIR_B_LOW_JUMP",
    render(ctx, s, t) { // crouch, one jump up, land (with the natural little rebound)
      const HJ = SH * GEO.hj; let lift = 0, sq = 1 - breathe(t);
      if (t >= 1.6 && t < 1.9) sq = 0.12 * Math.sin((seg(t, 1.6, 1.9) * Math.PI) / 2);
      else if (t >= 1.9 && t < 2.9) { const p = seg(t, 1.9, 2.9); lift = HJ * 4 * p * (1 - p); sq = -0.05; }
      else if (t >= 2.9 && t < 3.2) sq = 0.1 * (1 - seg(t, 2.9, 3.2));
      else if (t >= 3.2 && t < 3.2 + 2 * 0.42) { const p = ((t - 3.2) / 0.42) % 1; lift = Math.sin(p * Math.PI) * SH * P.settleB_low * (t < 3.62 ? 1 : 0.55); }
      character(ctx, s, XC, lift, sq); } },
  { pair: "B", cond: "HIGH", name: "Fly", id: "PAIR_B_HIGH_FLY",
    render(ctx, s, t) { // the same crouch, rises to the same height, hovers, comes down, lands
      const HJ = SH * GEO.hj; let lift = 0, sq = 1 - breathe(t);
      if (t >= 1.6 && t < 1.9) sq = 0.12 * Math.sin((seg(t, 1.6, 1.9) * Math.PI) / 2);
      else if (t >= 1.9 && t < 2.7) { lift = HJ * easeOut(seg(t, 1.9, 2.7)); sq = -0.03; }
      else if (t >= 2.7 && t < 3.9) lift = HJ + SH * P.hoverB * Math.sin((t - 2.7) * Math.PI * 2 * 0.85);
      else if (t >= 3.9 && t < 4.55) lift = (HJ + SH * P.hoverB * Math.sin(1.2 * Math.PI * 2 * 0.85)) * (1 - easeIO(seg(t, 3.9, 4.55)));
      else if (t >= 4.55 && t < 4.85) sq = 0.1 * (1 - seg(t, 4.55, 4.85));
      character(ctx, s, XC, lift, sq); } },
  { pair: "C", cond: "LOW", name: "Grow plants", id: "PAIR_C_LOW_PLANT_CONTROL",
    render(ctx, s, t) { // two hops and a wiggle beside the pot; the plant stays as it is
      plant(ctx, XPOT, t, 0);
      const wig = t > 2.33 && t < 2.9 ? Math.sin(seg(t, 2.33, 2.9) * Math.PI * 4) * 0.08 : 0;
      character(ctx, s, XCHAR_C, hopLift(t, 1.0, 2), hopSquash(t, 1.0, 2) || 1 - breathe(t), wig); } },
  { pair: "C", cond: "HIGH", name: "Grow plants", id: "PAIR_C_HIGH_GROW_PLANT",
    render(ctx, s, t) { // the same two hops and wiggle — then the plant grows
      plant(ctx, XPOT, t, easeOut(seg(t, 2.9, 4.5)));
      const wig = t > 2.33 && t < 2.9 ? Math.sin(seg(t, 2.33, 2.9) * Math.PI * 4) * 0.08 : 0;
      character(ctx, s, XCHAR_C, hopLift(t, 1.0, 2), hopSquash(t, 1.0, 2) || 1 - breathe(t), wig); } },
];
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
  character(ctx, sprite, x, Math.abs(Math.sin((s / 0.48) * Math.PI)) * SH * 0.025, 0, s > 0.2 ? 0.06 : 0);
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
    if (!(id === "PAIR_A_HIGH_TELEPORT" && t >= BLINK_AT + 0.15 && t < BLINK_AT + 0.25)) visible++;
  }
  return { id, motion: +motion.toFixed(2), moving: +(movingFrames / 30).toFixed(2), visible: +((visible / (F + 1)) * DURATION).toFixed(2), lum: +(lum / (F + 1)).toFixed(1), sat: +(sat / (F + 1)).toFixed(1) };
}

// the kiosk scene is drawn `cover` (background-size: cover; centred): the canvas uses the same fit so the
// stage's ground line lands on the painted podium at any window size
export function coverTransform(w: number, h: number) {
  const k = Math.max(w / SW, h / SH);
  return { k, ox: (w - SW * k) / 2, oy: (h - SH * k) / 2 };
}
