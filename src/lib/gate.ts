import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { NOSE, L_WRIST, R_WRIST, L_HIP, R_HIP, L_SHOULDER, R_SHOULDER } from "./pose";

// The "show me" gate: the welcome mirror starts the photo by itself when a
// child walks up CLOSE, stands in the MIDDLE, holds something in front of
// the chest and keeps STILL for a moment. Each condition alone is easy to
// trip by accident at a busy exhibition (kids run through the background all
// day); all four together, held for `hold` ms, is what a child showing a
// creation to a webcam looks like — and almost nothing else. Pure logic, no
// DOM, so it can be tuned and tested with synthetic landmarks.
export type GateParams = {
  near: number;   // shoulder width (fraction of frame width) that counts as "close"
  hold: number;   // ms every condition must hold before the countdown
  hands: 1 | 2;   // wrists required in front of the chest
};

export type Box = { x0: number; y0: number; x1: number; y1: number };

export type GateReport = {
  main: number;        // index of the nearest person, -1 when nobody is tracked
  boxes: Box[];        // body boxes of everyone tracked (for the overlay)
  width: number;       // main person's shoulder width
  near: boolean;
  centered: boolean;
  holding: boolean;
  still: boolean;
  dwell: number;       // ms all four have held
  ready: boolean;      // dwell reached `hold`
  zone: Box | null;    // where the hands should be (drawn as the "creature spot")
};

const VIS = 0.4;              // landmark visibility below this = not seen
const CENTER: [number, number] = [0.22, 0.78];
const STILL_MOVE = 0.05;      // nose drift (frame fraction) allowed over the window
const STILL_WINDOW = 600;     // ms of history the drift is measured over
const GRACE = 400;            // ms a condition may flicker off without losing progress

const vis = (p: NormalizedLandmark) => (p.visibility ?? 1) >= VIS;

export class ShowGate {
  private dwell = 0;
  private miss = 0;
  private lastT = -1;
  private nose: { t: number; x: number; y: number }[] = [];

  constructor(public params: GateParams) {}

  reset() {
    this.dwell = 0;
    this.miss = 0;
    this.lastT = -1;
    this.nose = [];
  }

  update(poses: NormalizedLandmark[][], t: number): GateReport {
    const dt = this.lastT < 0 ? 0 : Math.min(200, t - this.lastT);
    this.lastT = t;

    // the nearest person = the widest pair of shoulders in frame
    let main = -1, width = 0;
    const boxes: Box[] = poses.map((lm, i) => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of lm) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER];
      if (vis(ls) && vis(rs)) {
        const w = Math.abs(ls.x - rs.x);
        if (w > width) { width = w; main = i; }
      }
      return { x0, y0, x1, y1 };
    });

    const off = (): GateReport => {
      this.tick(false, dt);
      return { main, boxes, width, near: false, centered: false, holding: false, still: false, dwell: this.dwell, ready: false, zone: null };
    };
    // (the nose history is kept across a lost frame — the stillness window
    // must not restart just because the detector blinked)
    if (main < 0) return off();

    const lm = poses[main];
    const nose = lm[NOSE], ls = lm[L_SHOULDER], rs = lm[R_SHOULDER];
    const shoulderY = (ls.y + rs.y) / 2;
    const near = width >= this.params.near;
    const centered = nose.x >= CENTER[0] && nose.x <= CENTER[1];

    // hands in front of the chest: between the face and the hips, within the
    // torso's width (plus a margin) — not raised, not spread out
    const hips = [lm[L_HIP], lm[R_HIP]].filter(vis);
    const hipY = hips.length ? hips.reduce((s, p) => s + p.y, 0) / hips.length : shoulderY + width * 1.6;
    const zone: Box = {
      x0: Math.min(ls.x, rs.x) - width * 0.45,
      x1: Math.max(ls.x, rs.x) + width * 0.45,
      y0: nose.y - 0.05,
      y1: hipY + 0.05,
    };
    const inZone = (p: NormalizedLandmark) => vis(p) && p.x >= zone.x0 && p.x <= zone.x1 && p.y >= zone.y0 && p.y <= zone.y1;
    const handsIn = (inZone(lm[L_WRIST]) ? 1 : 0) + (inZone(lm[R_WRIST]) ? 1 : 0);
    const holding = handsIn >= this.params.hands;

    // still: the nose hasn't drifted much over the last STILL_WINDOW ms
    this.nose.push({ t, x: nose.x, y: nose.y });
    while (this.nose.length && this.nose[0].t < t - STILL_WINDOW - 200) this.nose.shift();
    const old = this.nose.filter((s) => s.t <= t - STILL_WINDOW);
    const still = old.length > 0 && old.every((s) => Math.hypot(s.x - nose.x, s.y - nose.y) <= STILL_MOVE);

    const ok = near && centered && holding && still;
    this.tick(ok, dt);
    return { main, boxes, width, near, centered, holding, still, dwell: this.dwell, ready: this.dwell >= this.params.hold, zone };
  }

  private tick(ok: boolean, dt: number) {
    if (ok) {
      this.miss = 0;
      this.dwell += dt;
    } else {
      this.miss += dt;
      if (this.miss > GRACE) this.dwell = 0;
    }
  }
}

// kiosk URL tuning: ?near=0.18&hold=1500&hands=2 (and ?posedebug for the HUD)
export function gateParamsFromUrl(search = location.search): GateParams {
  const q = new URLSearchParams(search);
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { near: num("near", 0.18), hold: num("hold", 1500), hands: q.get("hands") === "2" ? 2 : 1 };
}
