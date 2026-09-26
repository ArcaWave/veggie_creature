// The "something held up to the camera" gate on synthetic 48x36 frames.   run: npx tsx tools/showobject.test.ts
import { ObjectGate, GRID_W, GRID_H, absorbShownObject, resetSceneModel } from "../src/lib/showobject.ts";
type Frame = Uint8ClampedArray;
const booth = (shade = 0): Frame => { // an empty booth: a wall with a gentle gradient, a floor
  const f = new Uint8ClampedArray(GRID_W * GRID_H * 4);
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const i = (y * GRID_W + x) * 4, floor = y > GRID_H * 0.75;
    f[i] = (floor ? 150 : 205) + shade + x * 0.3; f[i + 1] = (floor ? 125 : 200) + shade; f[i + 2] = (floor ? 95 : 185) + shade; f[i + 3] = 255;
  }
  return f;
};
// a paper with a green / orange creation on it, cx, cy, w, h in 0~1 of the frame
const withPaper = (f: Frame, cx: number, cy: number, w: number, h: number, jitter = 0): Frame => {
  const g = f.slice();
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const u = x / GRID_W, v = y / GRID_H;
    if (Math.abs(u - cx) < w / 2 && Math.abs(v - cy) < h / 2) {
      const i = (y * GRID_W + x) * 4, j = (Math.random() - 0.5) * jitter;
      const creature = Math.hypot((u - cx) / w, (v - cy) / h) < 0.28;
      g[i] = (creature ? 90 : 250) + j; g[i + 1] = (creature ? 170 : 250) + j; g[i + 2] = (creature ? 60 : 245) + j;
    }
  }
  return g;
};
const noise = (f: Frame, a: number): Frame => { const g = f.slice(); for (let i = 0; i < g.length; i += 4) { const j = (Math.random() - 0.5) * a; g[i] += j; g[i + 1] += j; g[i + 2] += j; } return g; };

function run(name: string, frames: (t: number) => Frame, want: "fires" | "never", opts: { standing?: (t: number) => boolean; people?: (t: number) => boolean; ms?: number; warm?: number } = {}) {
  resetSceneModel(); // (each case starts from a freshly learnt empty booth)
  const g = new ObjectGate(); const ms = opts.ms ?? 5000, warm = opts.warm ?? 2000; let at = -1;
  for (let t = 0; t <= warm + ms; t += 66) {
    const f = t < warm ? noise(booth(), 3) : frames(t - warm);
    const r = g.update(f, t, opts.standing?.(t - warm) ?? false, opts.people?.(t - warm) ?? false);
    if (t >= warm && r.ready && at < 0) at = t - warm;
  }
  const pass = (want === "fires") === (at >= 0);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${at >= 0 ? `fires @${at}ms` : "never fires"}`);
  return pass;
}
const r: boolean[] = [];
r.push(run("empty booth (camera noise)", () => noise(booth(), 4), "never"));
r.push(run("a paper held up in the middle, still", () => noise(withPaper(booth(), 0.5, 0.5, 0.36, 0.5), 3), "fires"));
r.push(run("… held a little off-centre and small", () => noise(withPaper(booth(), 0.4, 0.55, 0.3, 0.42), 3), "fires"));
r.push(run("… with small hand tremor", (t) => noise(withPaper(booth(), 0.5 + Math.sin(t / 300) * 0.006, 0.5, 0.36, 0.5), 3), "fires"));
r.push(run("waved around (not held still)", (t) => noise(withPaper(booth(), 0.5 + Math.sin(t / 250) * 0.2, 0.5, 0.36, 0.5), 3), "never"));
r.push(run("someone walking past", (t) => noise(withPaper(booth(), -0.2 + (t / 5000) * 1.4, 0.55, 0.3, 0.8), 3), "never"));
r.push(run("a small thing far away (a child in the background)", () => noise(withPaper(booth(), 0.5, 0.5, 0.1, 0.18), 3), "never"));
r.push(run("the store lights change (whole picture brighter)", () => noise(booth(40), 3), "never", { ms: 9000 }));
r.push(run("a hand over the lens (everything changes)", () => noise(new Uint8ClampedArray(GRID_W * GRID_H * 4).fill(30), 2), "never"));
// with a person in view the stillness is looser (a child holding their creation sways) — but walking past or
// waving it about still never counts
r.push(run("a child holding it up, swaying ±4 cm (person seen)", (t) => noise(withPaper(booth(), 0.5 + Math.sin(t / 380) * 0.03 + (Math.random() - 0.5) * 0.004, 0.55, 0.4, 0.8), 3), "fires", { people: () => true }));
r.push(run("someone walking past (person seen)", (t) => noise(withPaper(booth(), -0.2 + (t / 5000) * 1.4, 0.55, 0.3, 0.8), 3), "never", { people: () => true }));
r.push(run("…walking past slowly (person seen)", (t) => noise(withPaper(booth(), -0.2 + (t / 9000) * 1.4, 0.55, 0.3, 0.8), 3), "never", { people: () => true, ms: 9000 }));
r.push(run("waved around (person seen)", (t) => noise(withPaper(booth(), 0.5 + Math.sin(t / 250) * 0.2, 0.5, 0.36, 0.5), 3), "never", { people: () => true }));
r.push(run("a person close with arms hanging down (just standing)", () => noise(withPaper(booth(), 0.5, 0.55, 0.4, 0.8), 3), "never", { standing: () => true, people: () => true }));
// after the matcher found nothing: the thing in front becomes the booth — until it changes
{
  resetSceneModel();
  const g = new ObjectGate(); let fired = 0, t = 0;
  const step = (f: Frame, n: number) => { for (let k = 0; k < n; k++, t += 66) if (g.update(f, t, false, false).ready) { fired++; return true; } return false; };
  step(noise(booth(), 3), 30);
  const paper = withPaper(booth(), 0.5, 0.5, 0.36, 0.5);
  const first = step(noise(paper, 3), 60);
  absorbShownObject(); g.reset();
  const again = step(noise(paper, 3), 90);
  const emptyAfter = step(noise(booth(), 3), 60);   // it is taken away: the empty booth must stay quiet
  const other = step(noise(withPaper(booth(), 0.45, 0.5, 0.34, 0.5), 3), 90); // then a child shows theirs
  const pass = first && !again && !emptyAfter && other;
  console.log(`${pass ? "PASS" : "FAIL"}  ${"matcher found nothing → not again; empty stays quiet; next one fires".padEnd(64)} first ${first}, again ${again}, empty ${emptyAfter}, next ${other}`);
  r.push(pass);
}
console.log(r.every(Boolean) ? `ALL PASS (${r.length})` : `${r.filter((x) => !x).length} FAIL`);
