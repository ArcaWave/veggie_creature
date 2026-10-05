// The suggestiveness experiment, inside the ordinary kiosk (docs/RESEARCH.md). Every child's session is a
// participant: when the photo is taken the kiosk asks for an ID and the next cell of a concealed, pre-generated,
// balanced sequence (pair A/B/C x HIGH/LOW); it then reports each step with its own clock, and the "살아났다!"
// scene plays that cell's clip. The researchers' console adds what only people see (age, the answers to Q1–Q6,
// a spontaneous remark, exclusions) to any session, at any time. Pure logic over a small store, so the same code
// runs on Vercel (Supabase), in `npm run dev` (a JSON file) and in the tests (memory).
import { randomInt } from "node:crypto";

export type Condition = "HIGH" | "LOW";
export type Pair = "A" | "B" | "C";
export const ANIMATION_ID: Record<Pair, Record<Condition, string>> = {
  A: { LOW: "PAIR_A_LOW_MOVE", HIGH: "PAIR_A_HIGH_TELEPORT" },
  B: { LOW: "PAIR_B_LOW_JUMP", HIGH: "PAIR_B_HIGH_FLY" },
  C: { LOW: "PAIR_C_LOW_PLANT_CONTROL", HIGH: "PAIR_C_HIGH_GROW_PLANT" },
};
// the kiosk's steps, in order — each sets a time (and how far the session got)
export const EVENTS = {
  matched: { time: "match_time", stage: "match" },
  dance_start: { time: "dance_start_time", stage: "dance" },
  ladle_start: { time: "ladle_start_time", stage: "ladle" },
  ladle_end: { time: "ladle_end_time", stage: "ladle" },
  reveal: { time: "reveal_time", stage: "reveal" },
  animation_start: { time: "animation_start_time", stage: "animation" },
  animation_end: { time: "animation_end_time", stage: "observe" },
  observation_end: { time: "observation_end_time", stage: "observed" },
  walk_off: { time: "walk_off_time", stage: "walk" },
  motion: { time: null, stage: null }, // (the covariate, measured on the kiosk once the character is known)
  stimulus_skipped: { time: null, stage: null }, // (the character couldn't be drawn: the plain scene played — a technical error)
} as const;
export type EventName = keyof typeof EVENTS;
const STAGE_ORDER = ["photo", "match", "dance", "ladle", "reveal", "animation", "observe", "observed", "walk", "done"];

export type Cell = { condition: Condition; pair: Pair; block: number; pos: number; blockSize: number };
export type Allocation = { createdAt: string; method: string; next: number; list: Cell[] };
export type Assigned = { condition: Condition; pair: Pair; animationId: string };
export type Live = { pid: string | null; stage: string; assigned: Assigned | null; times: Record<string, string> };
export type Flags = {
  technical_error: boolean; animation_interrupted: boolean; researcher_interruption: boolean;
  parent_interruption: boolean; child_did_not_watch: boolean; session_aborted: boolean;
};
export const FLAG_KEYS: (keyof Flags)[] = ["technical_error", "animation_interrupted", "researcher_interruption", "parent_interruption", "child_did_not_watch", "session_aborted"];
export type Session = {
  participant_id: string; seq: number; offline: boolean;
  condition: Condition; animation_pair: Pair; animation_id: string; stimulus_version?: string; block: number | null; block_pos: number | null; block_size: number | null;
  source: string; variant: string | null; parts: Record<string, string> | null; matched: boolean | null;
  times: Record<string, string>; stage_reached: string; completed: boolean; end_reason: string;
  motion_energy: number | null;
  age: number | null; q1_answer: string; q2_answer: string; q3_6_answers: string;
  spontaneous_verbalization: boolean | null; spontaneous_verbalization_text: string;
  flags: Flags; researcher_note: string; q2_done: boolean; condition_revealed_early: boolean;
  events: { at: string; op: string; by: string }[];
};

// ---- the store (compare-and-set by `rev`: a stale write is refused and retried) ------------------------
export interface Store {
  readState<T>(key: string): Promise<{ rev: number; data: T } | null>;
  writeState<T>(key: string, data: T, rev: number | null): Promise<boolean>; // rev null = create
  listState<T>(prefix: string): Promise<{ key: string; data: T }[]>; // (the field survey's records: "survey/<id>")
  readSession(pid: string): Promise<{ rev: number; data: Session } | null>;
  writeSession(pid: string, seq: number, data: Session, rev: number | null): Promise<boolean>;
  listSessions(): Promise<Session[]>;
}
export function memoryStore(): Store {
  const state = new Map<string, { rev: number; data: unknown }>(), sessions = new Map<string, { rev: number; data: Session }>();
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    async readState<T>(key: string) { const s = state.get(key); return s ? { rev: s.rev, data: clone(s.data) as T } : null; },
    async writeState(key, data, rev) { const s = state.get(key); if ((s?.rev ?? null) !== rev) return false; state.set(key, { rev: (rev ?? 0) + 1, data: clone(data) }); return true; },
    async listState<T>(prefix: string) { return [...state.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, s]) => ({ key, data: clone(s.data) as T })); },
    async readSession(pid) { const s = sessions.get(pid); return s ? { rev: s.rev, data: clone(s.data) } : null; },
    async writeSession(pid, _seq, data, rev) { const s = sessions.get(pid); if ((s?.rev ?? null) !== rev) return false; sessions.set(pid, { rev: (rev ?? 0) + 1, data: clone(data) }); return true; },
    async listSessions() { return [...sessions.values()].map((s) => clone(s.data)).sort((a, b) => a.seq - b.seq); },
  };
}

// ---- random assignment --------------------------------------------------------------------------------------
// Permuted blocks over the six cells (each once in a block of 6, twice in a block of 12), the block size itself
// random so the next assignment can't be guessed; drawn once with a cryptographic RNG and stored, so a reload
// never reshuffles it. A session that stops early keeps its cell (it is never handed to the next child).
const CELLS: { condition: Condition; pair: Pair }[] = (["A", "B", "C"] as Pair[]).flatMap((pair) => (["HIGH", "LOW"] as Condition[]).map((condition) => ({ condition, pair })));
export function makeAllocation(n: number, rand: (k: number) => number = (k) => randomInt(k), startBlock = 0): Cell[] {
  const out: Cell[] = [];
  for (let block = startBlock; out.length < n; block++) {
    const size = rand(2) ? 12 : 6;
    const cells = Array.from({ length: size }, (_, i) => CELLS[i % 6]);
    for (let i = cells.length - 1; i > 0; i--) { const j = rand(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; } // Fisher-Yates
    cells.forEach((c, pos) => out.push({ ...c, block, pos, blockSize: size }));
  }
  return out;
}
async function nextCell(store: Store): Promise<{ seq: number; cell: Cell }> {
  for (let tries = 0; tries < 8; tries++) {
    const cur = await store.readState<Allocation>("allocation");
    const a: Allocation = cur?.data ?? { createdAt: new Date().toISOString(), method: "permuted blocks of 6 or 12 over 6 cells (pair x condition), crypto RNG", next: 0, list: [] };
    if (a.next >= a.list.length) a.list.push(...makeAllocation(600, undefined, a.list.length ? a.list[a.list.length - 1].block + 1 : 0));
    const cell = a.list[a.next]; const seq = a.next + 1; a.next += 1;
    if (await store.writeState("allocation", a, cur?.rev ?? null)) return { seq, cell };
  }
  throw new Error("allocation_busy");
}

// ---- the steps ------------------------------------------------------------------------------------------------
export type Msg = { op: string; by?: string; [k: string]: unknown };
export type Reply = { ok: boolean; error?: string; pid?: string; assigned?: Assigned; live?: Live; superseded?: string };
const IDLE: Live = { pid: null, stage: "idle", assigned: null, times: {} };
const iso = (t: number) => new Date(t).toISOString();
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const ageOf = (v: unknown) => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) && n >= 2 && n <= 18 ? Math.round(n) : null; };
const later = (a: string, b: string) => (STAGE_ORDER.indexOf(b) > STAGE_ORDER.indexOf(a) ? b : a);
export const blankFlags = (): Flags => ({ technical_error: false, animation_interrupted: false, researcher_interruption: false, parent_interruption: false, child_did_not_watch: false, session_aborted: false });

export async function getLive(store: Store): Promise<Live> { return (await store.readState<Live>("live"))?.data ?? IDLE; }
async function setLive(store: Store, f: (l: Live) => Live | null) { // null = leave it
  for (let tries = 0; tries < 8; tries++) {
    const cur = await store.readState<Live>("live");
    const next = f(cur?.data ? JSON.parse(JSON.stringify(cur.data)) : { ...IDLE });
    if (!next) return;
    if (await store.writeState("live", next, cur?.rev ?? null)) return;
  }
}
async function editSession(store: Store, pid: string, f: (s: Session) => void): Promise<Session | null> {
  for (let tries = 0; tries < 8; tries++) {
    const cur = await store.readSession(pid);
    if (!cur) return null;
    f(cur.data);
    if (await store.writeSession(pid, cur.data.seq, cur.data, cur.rev)) return cur.data;
  }
  throw new Error("session_busy");
}

export async function handle(store: Store, msg: Msg, now = Date.now()): Promise<Reply> {
  const by = str(msg.by, 20) || "kiosk", op = msg.op;
  const at = iso(Number.isFinite(Number(msg.at)) && Number(msg.at) > 0 ? Number(msg.at) : now); // (the kiosk's own clock: steps keep their spacing through a queue)
  const pid = str(msg.pid, 40);

  if (op === "kStart") { // a photo was taken: a new participant
    const prev = await getLive(store);
    if (prev.pid) await editSession(store, prev.pid, (s) => { if (!s.completed && !s.end_reason) { s.end_reason = "superseded"; s.flags.session_aborted = true; s.times.session_end_time = at; s.events.push({ at, op: "superseded", by: "server" }); } });
    const { seq, cell } = await nextCell(store);
    const p = `MK_${String(seq).padStart(4, "0")}`;
    const assigned: Assigned = { condition: cell.condition, pair: cell.pair, animationId: ANIMATION_ID[cell.pair][cell.condition] };
    const s: Session = {
      participant_id: p, seq, offline: false, condition: cell.condition, animation_pair: cell.pair, animation_id: assigned.animationId, stimulus_version: str(msg.sv, 40),
      block: cell.block, block_pos: cell.pos, block_size: cell.blockSize, source: str(msg.source, 20), variant: null, parts: null, matched: null,
      times: { session_start_time: at }, stage_reached: "photo", completed: false, end_reason: "", motion_energy: null,
      age: null, q1_answer: "", q2_answer: "", q3_6_answers: "", spontaneous_verbalization: null, spontaneous_verbalization_text: "",
      flags: blankFlags(), researcher_note: "", q2_done: false, condition_revealed_early: false, events: [{ at, op, by }],
    };
    if (!(await store.writeSession(p, seq, s, null))) return { ok: false, error: "session_exists" };
    await setLive(store, () => ({ pid: p, stage: "photo", assigned, times: { session_start_time: at } }));
    return { ok: true, pid: p, assigned, ...(prev.pid ? { superseded: prev.pid } : {}) };
  }

  if (op === "kEvent") { // a step of the kiosk session
    const ev = str(msg.ev, 30) as EventName;
    if (!(ev in EVENTS)) return { ok: false, error: `unknown_event:${ev}` };
    const spec = EVENTS[ev], data = (msg.data ?? {}) as Record<string, unknown>;
    const s = await editSession(store, pid, (x) => {
      if (spec.time && !x.times[spec.time]) x.times[spec.time] = at;
      if (spec.stage) x.stage_reached = later(x.stage_reached, spec.stage);
      if (ev === "matched") { x.variant = str(data.variant, 30) || null; x.matched = typeof data.matched === "boolean" ? data.matched : null;
        if (data.parts && typeof data.parts === "object") x.parts = Object.fromEntries(Object.entries(data.parts as Record<string, unknown>).map(([k, v]) => [k, str(v, 30)])); }
      if (ev === "motion" && Number.isFinite(Number(data.motion_energy))) x.motion_energy = Number(data.motion_energy);
      if (ev === "stimulus_skipped") { x.flags.technical_error = true; x.researcher_note = [x.researcher_note, `[kiosk] 자극 재생 못 함: ${str(data.why, 200)}`].filter(Boolean).join("\n"); }
      x.events.push({ at, op: ev, by });
    });
    if (!s) return { ok: false, error: "no_such_session" };
    await setLive(store, (l) => (l.pid !== pid ? null : { ...l, stage: spec.stage ? later(l.stage, spec.stage) : l.stage, times: spec.time ? { ...l.times, [spec.time]: l.times[spec.time] ?? at } : l.times }));
    return { ok: true };
  }

  if (op === "kEnd") { // the session is over: the creature reached the wall (completed), or it stopped early
    const completed = msg.completed === true, reason = str(msg.reason, 60) || (completed ? "done" : "stopped");
    const s = await editSession(store, pid, (x) => {
      if (x.completed || x.end_reason) return; // (said once)
      x.times.session_end_time = at; x.completed = completed; x.end_reason = reason;
      if (completed) x.stage_reached = "done"; else x.flags.session_aborted = true;
      x.events.push({ at, op: completed ? "end" : `stop:${reason}`, by });
    });
    if (!s) return { ok: false, error: "no_such_session" };
    await setLive(store, (l) => (l.pid !== pid ? null : { ...IDLE }));
    return { ok: true };
  }

  if (op === "kOffline") { // a session the kiosk ran while the server was out of reach (its cell drawn locally)
    const x = (msg.session ?? {}) as Partial<Session>;
    const id = str(x.participant_id, 40);
    if (!/^OFF-[\w-]+$/.test(id) || !x.condition || !x.animation_pair) return { ok: false, error: "bad_offline_session" };
    if (await store.readSession(id)) return { ok: true }; // (sent before)
    const s: Session = {
      participant_id: id, seq: 1_000_000 + Math.floor(now / 1000) % 1_000_000, offline: true,
      condition: x.condition === "HIGH" ? "HIGH" : "LOW", animation_pair: (["A", "B", "C"].includes(x.animation_pair) ? x.animation_pair : "A") as Pair,
      animation_id: str(x.animation_id, 40), stimulus_version: str(x.stimulus_version, 40), block: null, block_pos: null, block_size: null, source: str(x.source, 20),
      variant: str(x.variant, 30) || null, parts: x.parts ?? null, matched: typeof x.matched === "boolean" ? x.matched : null,
      times: Object.fromEntries(Object.entries(x.times ?? {}).map(([k, v]) => [str(k, 40), str(v, 40)])), stage_reached: str(x.stage_reached, 20) || "photo",
      completed: x.completed === true, end_reason: str(x.end_reason, 60), motion_energy: Number.isFinite(Number(x.motion_energy)) ? Number(x.motion_energy) : null,
      age: null, q1_answer: "", q2_answer: "", q3_6_answers: "", spontaneous_verbalization: null, spontaneous_verbalization_text: "",
      flags: { ...blankFlags(), session_aborted: x.completed !== true }, researcher_note: "", q2_done: false, condition_revealed_early: false,
      events: [{ at: iso(now), op: "offline_upload", by }],
    };
    await store.writeSession(id, s.seq, s, null);
    return { ok: true };
  }

  if (op === "note") { // the researchers' additions, any time
    const s = await editSession(store, pid, (x) => {
      if ("age" in msg) x.age = ageOf(msg.age);
      if (typeof msg.q1 === "string") x.q1_answer = str(msg.q1);
      if (typeof msg.q2 === "string") x.q2_answer = str(msg.q2);
      if (typeof msg.q36 === "string") x.q3_6_answers = str(msg.q36);
      if (msg.verbal && typeof msg.verbal === "object") { const v = msg.verbal as { observed?: unknown; text?: unknown };
        x.spontaneous_verbalization = v.observed === true ? true : v.observed === false ? false : null; x.spontaneous_verbalization_text = str(v.text); }
      if (msg.flags && typeof msg.flags === "object") for (const k of FLAG_KEYS) { const v = (msg.flags as Record<string, unknown>)[k]; if (typeof v === "boolean" && k !== "session_aborted") x.flags[k] = v; }
      if (typeof msg.note === "string") x.researcher_note = str(msg.note);
      if (msg.q2Done === true) x.q2_done = true;
      x.events.push({ at: iso(now), op: "note", by: "console" });
    });
    return s ? { ok: true } : { ok: false, error: "no_such_session" };
  }
  if (op === "reveal") { // a look at the condition before Q2 is recorded
    const s = await editSession(store, pid, (x) => { if (!x.q2_done) x.condition_revealed_early = true; x.events.push({ at: iso(now), op: "reveal", by: "console" }); });
    return s ? { ok: true } : { ok: false, error: "no_such_session" };
  }
  return { ok: false, error: `unknown_op:${op}` };
}

// the sessions as flat rows (CSV / analysis) — one column per field, times in ISO (UTC)
const TIME_COLS = ["session_start_time", "match_time", "dance_start_time", "ladle_start_time", "ladle_end_time", "reveal_time", "animation_start_time", "animation_end_time", "observation_end_time", "walk_off_time", "session_end_time"];
export const CSV_COLUMNS = [
  "participant_id", "seq", "offline", "age", "condition", "animation_pair", "animation_id", "stimulus_version", "block", "block_pos", "block_size",
  "source", "variant", "hat", "arms", "legs", "matched", ...TIME_COLS,
  "spontaneous_verbalization", "spontaneous_verbalization_text", "q1_answer", "q2_answer", "q3_6_answers", "q2_done",
  ...FLAG_KEYS, "researcher_note", "motion_energy", "condition_revealed_early", "completed", "stage_reached", "end_reason",
];
export function flat(s: Session): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const c of CSV_COLUMNS) {
    if (TIME_COLS.includes(c)) r[c] = s.times[c] ?? "";
    else if ((FLAG_KEYS as string[]).includes(c)) r[c] = s.flags[c as keyof Flags];
    else if (c === "hat" || c === "arms" || c === "legs") r[c] = s.parts?.[c] ?? "";
    else r[c] = (s as unknown as Record<string, unknown>)[c] ?? "";
  }
  return r;
}
export function toCsv(rows: Session[]): string {
  const q = (v: unknown) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [CSV_COLUMNS.join(","), ...rows.map((s) => { const r = flat(s); return CSV_COLUMNS.map((c) => q(r[c])).join(","); })].join("\n");
}
