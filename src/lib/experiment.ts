// The suggestiveness experiment inside the kiosk (docs/RESEARCH.md): every session is a participant. When the
// photo is taken the kiosk asks the server (api/research.ts) for an ID and the next cell of the concealed,
// balanced sequence; the "살아났다!" scene then plays that cell's clip, and each step is reported with this
// machine's clock. The kiosk never waits for any of it: without an answer in 2.5 s the cell is drawn here, the
// session is kept on this device and handed over at a later session ("OFF-…", flagged offline).
// ?exp=0 turns the experiment off on this screen (the plain "살아났다!" scene). The kiosk needs no key: it runs on
// the plain domain and may write its own sessions; the researchers' console reads them with the research key
// (given once in its address, ?key=…, and remembered on that device).
import type { StimulusId } from "../research/stimuli";

export type Assigned = { condition: "HIGH" | "LOW"; pair: "A" | "B" | "C"; animationId: StimulusId };
export const EXPERIMENT_ON = new URLSearchParams(location.search).get("exp") !== "0";

const KEY_STORE = "vc-research-key", OUTBOX = "vc-exp-outbox";
export function researchKey(): string {
  const fromUrl = new URLSearchParams(location.search).get("key");
  try {
    if (fromUrl) { localStorage.setItem(KEY_STORE, fromUrl); return fromUrl; }
    return localStorage.getItem(KEY_STORE) ?? "";
  } catch { return fromUrl ?? ""; }
}
export function setResearchKey(k: string) { try { localStorage.setItem(KEY_STORE, k); } catch { /* private window */ } }

async function post(body: Record<string, unknown>, timeoutMs = 8000) {
  const r = await fetch("/api/research", {
    method: "POST", headers: { "Content-Type": "application/json", "x-research-key": researchKey() },
    body: JSON.stringify({ by: "kiosk", ...body }), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `http_${r.status}`);
  return j;
}

const CELLS: Assigned[] = [
  { condition: "HIGH", pair: "A", animationId: "PAIR_A_HIGH_TELEPORT" }, { condition: "LOW", pair: "A", animationId: "PAIR_A_LOW_MOVE" },
  { condition: "HIGH", pair: "B", animationId: "PAIR_B_HIGH_FLY" }, { condition: "LOW", pair: "B", animationId: "PAIR_B_LOW_JUMP" },
  { condition: "HIGH", pair: "C", animationId: "PAIR_C_HIGH_GROW_PLANT" }, { condition: "LOW", pair: "C", animationId: "PAIR_C_LOW_PLANT_CONTROL" },
];
// the steps' times (the same names the server keeps), for a session kept on this device
const TIME_OF: Record<string, string> = {
  matched: "match_time", dance_start: "dance_start_time", ladle_start: "ladle_start_time", ladle_end: "ladle_end_time", reveal: "reveal_time",
  animation_start: "animation_start_time", animation_end: "animation_end_time", observation_end: "observation_end_time", walk_off: "walk_off_time",
};
const STAGE_OF: Record<string, string> = {
  matched: "match", dance_start: "dance", ladle_start: "ladle", ladle_end: "ladle", reveal: "reveal",
  animation_start: "animation", animation_end: "observe", observation_end: "observed", walk_off: "walk",
};
type Offline = Record<string, any> & { participant_id: string; times: Record<string, string> };
type Current = { pid: string | null; assigned: Promise<Assigned>; offline: Offline | null; queue: Promise<void>; ended: boolean };
let current: Current | null = null;
const iso = (t: number) => new Date(t).toISOString();

export function startSession(source: string) {
  if (!EXPERIMENT_ON) return;
  if (current && !current.ended) endSession(false, "superseded");
  const at = Date.now();
  let resolve!: (a: Assigned) => void;
  const c: Current = { pid: null, assigned: new Promise<Assigned>((r) => (resolve = r)), offline: null, queue: Promise.resolve(), ended: false };
  current = c;
  post({ op: "kStart", source, at }, 2500)
    .then((j) => { c.pid = j.pid; resolve(j.assigned); flushOutbox(); })
    .catch(() => { // no server answer: draw the cell here and keep the session on this device
      const a = CELLS[Math.floor(Math.random() * CELLS.length)];
      c.offline = { participant_id: `OFF-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, condition: a.condition, animation_pair: a.pair,
        animation_id: a.animationId, source, times: { session_start_time: iso(at) }, stage_reached: "photo", completed: false, end_reason: "" };
      resolve(a);
    });
}
// this session's cell (null = no experiment on this screen / no session)
export function assignment(): Promise<Assigned> | null { return EXPERIMENT_ON && current && !current.ended ? current.assigned : null; }

export function mark(ev: string, data?: Record<string, unknown>) {
  const c = current;
  if (!c || c.ended) return;
  const at = Date.now();
  c.queue = c.queue.then(async () => {
    await c.assigned;
    if (c.offline) {
      const k = TIME_OF[ev]; if (k && !c.offline.times[k]) c.offline.times[k] = iso(at);
      if (ev === "matched") Object.assign(c.offline, { variant: data?.variant, parts: data?.parts, matched: data?.matched });
      if (ev === "motion") c.offline.motion_energy = data?.motion_energy;
      if (STAGE_OF[ev]) c.offline.stage_reached = STAGE_OF[ev];
      if (ev === "stimulus_skipped") c.offline.technical_error = true;
      return;
    }
    for (let n = 1; n <= 3; n++) {
      try { await post({ op: "kEvent", pid: c.pid, ev, at, data }); return; }
      catch { await new Promise((r) => setTimeout(r, 700 * n)); }
    }
  });
}

export function endSession(completed: boolean, reason = completed ? "done" : "stopped") {
  const c = current;
  if (!c || c.ended) return;
  c.ended = true;
  const at = Date.now();
  c.queue = c.queue.then(async () => {
    await c.assigned;
    if (c.offline) {
      Object.assign(c.offline, { completed, end_reason: reason }); c.offline.times.session_end_time = iso(at);
      if (completed) c.offline.stage_reached = "done";
      try { const box = JSON.parse(localStorage.getItem(OUTBOX) || "[]"); box.push(c.offline); localStorage.setItem(OUTBOX, JSON.stringify(box.slice(-2000))); } catch { /* storage full */ }
      return;
    }
    for (let n = 1; n <= 3; n++) {
      try { await post({ op: "kEnd", pid: c.pid, completed, reason, at }); return; }
      catch { await new Promise((r) => setTimeout(r, 700 * n)); }
    }
  });
}

// sessions kept on this device while the server was out of reach: hand them over now
async function flushOutbox() {
  let box: Offline[] = [];
  try { box = JSON.parse(localStorage.getItem(OUTBOX) || "[]"); } catch { return; }
  if (!box.length) return;
  const left: Offline[] = [];
  for (const s of box) { try { await post({ op: "kOffline", session: s }); } catch { left.push(s); } }
  try { localStorage.setItem(OUTBOX, JSON.stringify(left)); } catch { /* */ }
}
