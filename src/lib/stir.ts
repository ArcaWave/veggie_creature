// Stirring detector for the third magic move: the child holds a (virtual)
// ladle and stirs the pot. A stir is a hand going ROUND — so the hand's path
// is watched over a short window, its angle around the middle of that path is
// followed, and the angle travelled in one consistent direction is what
// counts. Jitter (tiny path), waving (a flat back-and-forth path) and tracking
// glitches (impossible jumps) earn no rotation. Any honest movement still
// earns a little "effort" credit, so a child whose circles are more like
// scribbles gets there too. Pure logic, no DOM — tested with synthetic paths.
export type StirStep = {
  turned: number;   // rotation credited by this sample, in turns
  moved: number;    // distance travelled by this sample (frame heights)
  turning: boolean; // the hand is going round right now
};

const WINDOW = 1400;    // ms of path the circle's middle is estimated from
const MIN_SIZE = 0.07;  // path smaller than this (frame heights) = jitter, not a stir
const MIN_ROUND = 0.2;  // short side / long side of the path's box; flatter = waving
const MAX_STEP = 2.4;   // rad between samples; more is a tracking glitch
const MIN_SPIN = 0.05;  // rad/sample of steady direction before rotation counts
const MOVE_BAND: [number, number] = [0.012, 0.2]; // per-sample travel that counts as effort:
                                                  // below = landmark jitter, above = a tracking jump

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class StirDetector {
  turns = 0; // total credited rotation
  private pts: { t: number; x: number; y: number }[] = [];
  private lastAngle: number | null = null;
  private spin = 0; // smoothed signed step: which way the child is stirring

  reset() {
    this.turns = 0;
    this.lost();
  }

  // the hand went out of sight: drop the path so the next sample can't "jump"
  lost() {
    this.pts = [];
    this.lastAngle = null;
    this.spin = 0;
  }

  // x, y: hand position normalised to the video frame (0~1); aspect = w / h
  update(x: number, y: number, t: number, aspect = 16 / 9): StirStep {
    const X = x * aspect, Y = y;
    const prev = this.pts[this.pts.length - 1];
    this.pts.push({ t, x: X, y: Y });
    while (this.pts.length && this.pts[0].t < t - WINDOW) this.pts.shift();
    const step = prev ? Math.hypot(X - prev.x, Y - prev.y) : 0;
    const moved = step > MOVE_BAND[0] && step < MOVE_BAND[1] ? step : 0;

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of this.pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    const w = x1 - x0, h = y1 - y0, size = Math.max(w, h);
    if (this.pts.length < 4 || size < MIN_SIZE || Math.min(w, h) < size * MIN_ROUND) {
      this.lastAngle = null;
      this.spin *= 0.7;
      return { turned: 0, moved, turning: false };
    }

    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (Math.hypot(X - cx, Y - cy) < size * 0.12) { // crossing the middle: angle meaningless
      this.lastAngle = null;
      return { turned: 0, moved, turning: false };
    }
    const angle = Math.atan2(Y - cy, X - cx);
    const last = this.lastAngle;
    this.lastAngle = angle;
    if (last === null) return { turned: 0, moved, turning: false };

    const d = wrap(angle - last);
    if (Math.abs(d) > MAX_STEP) return { turned: 0, moved, turning: false };
    this.spin = 0.7 * this.spin + 0.3 * d;
    if (Math.abs(this.spin) < MIN_SPIN || Math.sign(d) !== Math.sign(this.spin)) {
      return { turned: 0, moved, turning: false };
    }
    const turned = Math.abs(d) / (2 * Math.PI);
    this.turns += turned;
    return { turned, moved, turning: true };
  }
}
