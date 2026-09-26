// The second way to start a photo: something is HELD UP to the camera — a child's creation on its
// paper, even when the camera can't make out a person (the paper hides the child's body, the child
// is very small, an adult holds it up at arm's length from outside the frame). The pose gate
// (lib/gate.ts) needs a person; this one needs only the booth to change and hold still:
//   • it keeps a picture of the EMPTY booth (a tiny 48x36 colour thumbnail), which slowly follows
//     the lighting, and never learns what a person in front of it looks like;
//   • "something shown" = a big part of the middle of the picture differs from the empty booth,
//     AND the picture has held still for a moment (a creation held up to be seen — not a child
//     running past, not a parent walking behind), AND it does not fill the whole frame (lights
//     switched, a hand over the lens);
//   • a person who is close with their arms hanging down is just standing there — not showing.
// Whether it really IS a creation is the matcher's call: a photo it finds nothing in goes back to
// the mirror quietly, and whatever was in front becomes part of the "empty booth" until it moves.
// Pure logic on pixel arrays, tested with synthetic frames (tools/showobject.test.ts).
export const GRID_W = 48, GRID_H = 36;

export type ObjectReport = {
  center: number;  // share of the middle of the frame that differs from the empty booth (0~1)
  whole: number;   // …of the whole frame
  still: boolean;
  dwell: number;   // ms it has been shown and still
  ready: boolean;
  box: { x0: number; y0: number; x1: number; y1: number } | null; // where it is (0~1, un-mirrored)
};

const FG_T = 75;          // summed |RGB - empty booth| above this = "something there"
const CENTER_MIN = 0.16;  // this much of the middle must be something
const WHOLE_MAX = 0.8;    // …but not (nearly) everything
const CHANGED_T = 20;     // a cell whose colour moved more than this (per channel) since the last frame "moved"
const STILL_FRAC = 0.03;  // still = fewer than this share of the middle moved, AND…
const DRIFT_MAX = 0.025;  // …the shown thing's centre drifted less than this (0~1) over the last 0.6 s
const CLEAR_MAX = 0.08;   // the middle is (nearly) empty booth — nobody and nothing in front
const HOLD_MS = 1500;
const GRACE_MS = 400;
const RELEARN_MS = 3000;  // the whole picture changed and stayed so (lights) → that is the new empty booth
const C_X0 = 0.18, C_X1 = 0.82, C_Y0 = 0.08, C_Y1 = 0.96;

class SceneModel {
  bg: Float32Array | null = null;       // the empty booth
  prev: Uint8ClampedArray | null = null;
  absorbNext = false;                   // relearn the empty booth from the next frame (the lights changed)
  ignoreNext = false;                   // the matcher found no creation: remember what is in front…
  ignore: Uint8ClampedArray | null = null; // …and don't fire on it again until it goes away or changes
  ignoreMask: Uint8Array | null = null;     // (the cells where it was: what "gone" is measured on)
  misses = 0;                           // photos in a row that held no creation, the booth never clear in between
}
// one model for the whole page: it outlives the welcome screen, so the booth it has learnt is still
// known when the next child steps up during the send-off
const model = new SceneModel();
// the matcher found nothing in a photo this gate took: don't fire again on whatever is in front,
// until it goes away or changes (the empty booth itself stays as it was learnt)
export function absorbShownObject() { model.ignoreNext = true; model.misses++; }
// Someone lingering in front with nothing to show (a parent reading the screen, a child who left their
// creation at the table) changes enough of the picture by just moving to wear the "not a creation" memory
// off, and was photographed again every ~20 s. After TWO such photos in a row this gate waits for the
// booth to be clear before it fires again. (The pose gate still sees a child who holds a creation up.)
export const MAX_SHOWN_MISSES = 2;
export const shownMisses = () => model.misses;
// forget the learnt booth (tests; a camera that was moved)
export function resetSceneModel() { model.bg = null; model.prev = null; model.ignore = null; model.ignoreMask = null; model.absorbNext = false; model.ignoreNext = false; model.misses = 0; }

export class ObjectGate {
  private dwell = 0;
  private miss = 0;
  private lastT = -1;
  private wholeSince = -1;
  private centres: { t: number; x: number; y: number }[] = [];
  private goneSince = -1;

  // rgba: GRID_W x GRID_H pixels; personStanding: a near person with arms down (not showing anything);
  // peopleInView: any person detected (the booth model never learns people)
  update(rgba: Uint8ClampedArray, t: number, personStanding: boolean, peopleInView: boolean): ObjectReport {
    const dt = this.lastT < 0 ? 0 : Math.min(200, t - this.lastT);
    this.lastT = t;
    const n = GRID_W * GRID_H;
    if (!model.bg || model.absorbNext) {
      model.bg = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) model.bg[i * 3 + c] = rgba[i * 4 + c];
      model.absorbNext = false;
      model.prev = rgba.slice();
      this.dwell = 0;
      return { center: 0, whole: 0, still: false, dwell: 0, ready: false, box: null };
    }
    if (model.ignoreNext) {
      model.ignore = rgba.slice(); model.ignoreNext = false; this.goneSince = -1;
      model.ignoreMask = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * 4, q = i * 3;
        if (Math.abs(rgba[p] - model.bg[q]) + Math.abs(rgba[p + 1] - model.bg[q + 1]) + Math.abs(rgba[p + 2] - model.bg[q + 2]) > FG_T) model.ignoreMask[i] = 1;
      }
    }
    const bg = model.bg, prev = model.prev ?? rgba, ign = model.ignore;
    let fgC = 0, nC = 0, fgAll = 0, moved = 0, nMotion = 0, sx = 0, sy = 0, notIgn = 0, nIgn = 0;
    let x0 = GRID_W, y0 = GRID_H, x1 = -1, y1 = -1;
    const fg = new Uint8Array(n);
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x, p = i * 4, q = i * 3;
      const d = Math.abs(rgba[p] - bg[q]) + Math.abs(rgba[p + 1] - bg[q + 1]) + Math.abs(rgba[p + 2] - bg[q + 2]);
      const inC = x >= GRID_W * C_X0 && x < GRID_W * C_X1 && y >= GRID_H * C_Y0 && y < GRID_H * C_Y1;
      if (d > FG_T) { fg[i] = 1; fgAll++; if (inC) { fgC++; sx += x; sy += y; } if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (inC) {
        nC++;
        if ((Math.abs(rgba[p] - prev[p]) + Math.abs(rgba[p + 1] - prev[p + 1]) + Math.abs(rgba[p + 2] - prev[p + 2])) / 3 > CHANGED_T) moved++;
        nMotion++;
      }
      if (ign && model.ignoreMask![i]) {
        nIgn++;
        if (Math.abs(rgba[p] - ign[p]) + Math.abs(rgba[p + 1] - ign[p + 1]) + Math.abs(rgba[p + 2] - ign[p + 2]) > FG_T) notIgn++;
      }
    }
    model.prev = rgba.slice();
    const center = fgC / nC, whole = fgAll / n;
    if (center < CLEAR_MAX) model.misses = 0; // the booth is clear: whoever was lingering has gone
    // still: little of the middle moved since the last frame, and the shown thing's centre isn't drifting
    // (a slowly waved paper changes only a thin edge each frame — its centre gives it away)
    if (fgC) this.centres.push({ t, x: sx / fgC / GRID_W, y: sy / fgC / GRID_H });
    while (this.centres.length && this.centres[0].t < t - 700) this.centres.shift();
    const old = this.centres.find((c) => c.t <= t - 550), cur = this.centres[this.centres.length - 1];
    const drift = old && cur ? Math.hypot(cur.x - old.x, cur.y - old.y) : 1;
    const still = moved / nMotion < STILL_FRAC && drift < DRIFT_MAX;
    // the remembered not-a-creation: still what is in front? (40 % of where it was looks different = it
    // went away or changed)
    let ignored = false;
    if (ign && !nIgn) model.ignore = null;
    else if (ign) {
      if (notIgn / nIgn < 0.4) { ignored = true; this.goneSince = -1; }
      else if (this.goneSince < 0) this.goneSince = t;
      else if (t - this.goneSince > 800) { model.ignore = null; this.goneSince = -1; }
      if (this.goneSince >= 0) ignored = true; // (until it has really gone)
    }

    // the empty booth follows the light: where nothing is, quickly; where something is, only when no
    // person is in view and very slowly (a sign left standing there becomes part of the booth in ~2 min)
    const aBg = 0.03, aFg = peopleInView ? 0 : 0.002;
    for (let i = 0; i < n; i++) {
      const a = fg[i] ? aFg : aBg;
      if (!a) continue;
      for (let c = 0; c < 3; c++) bg[i * 3 + c] += (rgba[i * 4 + c] - bg[i * 3 + c]) * a;
    }
    // the whole picture changed and stays so (store lights, the camera nudged): relearn the booth
    if (whole > WHOLE_MAX && still) {
      if (this.wholeSince < 0) this.wholeSince = t;
      else if (t - this.wholeSince > RELEARN_MS) { model.absorbNext = true; this.wholeSince = -1; }
    } else this.wholeSince = -1;

    const ok = center >= CENTER_MIN && whole <= WHOLE_MAX && still && !personStanding && !ignored;
    if (ok) { this.miss = 0; this.dwell += dt; }
    else { this.miss += dt; if (this.miss > GRACE_MS) this.dwell = 0; }
    const box = x1 >= 0 ? { x0: x0 / GRID_W, y0: y0 / GRID_H, x1: (x1 + 1) / GRID_W, y1: (y1 + 1) / GRID_H } : null;
    return { center, whole, still, dwell: this.dwell, ready: this.dwell >= HOLD_MS, box };
  }

  reset() { this.dwell = 0; this.miss = 0; this.centres = []; }
}
