// Who does the welcome gate follow when several people are in frame? Synthetic BlazePose landmarks;
// run: npx tsx tools/gate_people.test.ts
import { ShowGate } from "../src/lib/gate";
type P = { x: number; y: number; z: number; visibility: number };
function person(w: number, cx: number, hands: "chest" | "down" | "up", jitter = 0, noseY = 0.30): P[] {
  const pts: P[] = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, z: 0, visibility: 1 }));
  const j = () => (Math.random() - 0.5) * jitter, dy = noseY - 0.30;
  pts[0] = { x: cx + j(), y: noseY + j(), z: 0, visibility: 1 };
  pts[11] = { x: cx - w / 2, y: 0.45 + dy, z: 0, visibility: 1 };
  pts[12] = { x: cx + w / 2, y: 0.45 + dy, z: 0, visibility: 1 };
  pts[23] = { x: cx - w / 3, y: 0.85 + dy, z: 0, visibility: 0.9 };
  pts[24] = { x: cx + w / 3, y: 0.85 + dy, z: 0, visibility: 0.9 };
  const hy = (hands === "chest" ? 0.58 : hands === "up" ? 0.15 : 0.95) + dy;
  const hx = hands === "chest" ? 0.06 : w;
  pts[15] = { x: cx - hx, y: hy, z: 0, visibility: 1 };
  pts[16] = { x: cx + hx, y: hy, z: 0, visibility: 1 };
  return pts;
}
const params = { near: 0.18, hold: 1500, hands: 1 as const };
function run(name: string, frames: (t: number) => P[][], want: "fires" | "never", who?: number, ms = 4000, step = 66) {
  const g = new ShowGate(params); let readyAt = -1, last: any = null, mainAtReady = -1;
  for (let t = 0; t <= ms; t += step) { last = g.update(frames(t), t); if (last.ready && readyAt < 0) { readyAt = t; mainAtReady = last.main; } }
  const pass = (want === "fires") === (readyAt >= 0) && (who === undefined || readyAt < 0 || mainAtReady === who);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${readyAt >= 0 ? `fires @${readyAt}ms, main = person ${mainAtReady}` : "never fires"}`);
  return pass;
}
const r: boolean[] = [];
// the exhibition's everyday scenes
r.push(run("child alone, holding, still", () => [person(0.24, 0.5, "chest")], "fires", 0));
r.push(run("PARENT BEHIND (bigger, hands down) + child holding", () => [person(0.30, 0.55, "down", 0, 0.18), person(0.22, 0.48, "chest", 0.01)], "fires", 1));
r.push(run("parent beside (bigger, hands down) + child holding", () => [person(0.28, 0.72, "down", 0, 0.2), person(0.21, 0.45, "chest", 0.01)], "fires", 1));
r.push(run("parent filming with a phone (hands at chest) + child holding", () => [person(0.30, 0.6, "chest", 0.01, 0.18), person(0.22, 0.45, "chest", 0.01)], "fires"));
r.push(run("two children, only the smaller one holds", () => [person(0.25, 0.6, "down"), person(0.20, 0.42, "chest", 0.01)], "fires", 1));
r.push(run("list order swapped every frame (detector reorders)", (t) => { const a = person(0.30, 0.55, "down", 0, 0.18), b = person(0.22, 0.48, "chest", 0.01); return Math.floor(t / 66) % 2 ? [a, b] : [b, a]; }, "fires"));
// and what must still NOT start a photo
r.push(run("nobody holds anything (parent + child, hands down)", () => [person(0.30, 0.55, "down"), person(0.22, 0.45, "down")], "never"));
r.push(run("holder is far away in the background, a bystander is close", () => [person(0.25, 0.5, "down"), person(0.09, 0.3, "chest")], "never"));
r.push(run("holder walks past behind a standing adult", (t) => [person(0.28, 0.5, "down"), person(0.2, (t / 4000) * 1.2 - 0.1, "chest")], "never"));
r.push(run("holder off to the side (edge of frame)", () => [person(0.28, 0.5, "down"), person(0.2, 0.1, "chest")], "never"));
console.log(r.every(Boolean) ? "ALL PASS" : `${r.filter((x) => !x).length} FAIL`);
