// The experiment's server logic (api/_researchcore.ts) on an in-memory store.   run: npx tsx tools/research.test.ts
import { makeAllocation, memoryStore, handle, getLive, toCsv, type Store } from "../api/_researchcore.ts";
import { researchRequest } from "../api/_researchstore.ts";
let fails = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); if (!ok) fails++; };

// 1) the allocation
{
  const list = makeAllocation(600);
  const blocks = new Map<number, typeof list>(); for (const c of list) blocks.set(c.block, [...(blocks.get(c.block) ?? []), c]);
  let balanced = true; const sizes = new Set<number>();
  for (const [, cells] of blocks) {
    if (cells.length !== cells[0].blockSize) continue;
    sizes.add(cells.length);
    const per = new Map<string, number>(); for (const c of cells) per.set(c.pair + c.condition, (per.get(c.pair + c.condition) ?? 0) + 1);
    if (per.size !== 6 || [...per.values()].some((v) => v !== cells.length / 6)) balanced = false;
  }
  check("every complete block holds each of the 6 cells equally", balanced);
  check("block sizes are mixed (6 and 12)", sizes.has(6) && sizes.has(12));
  const firstN = (n: number) => { const per: Record<string, number> = {}; for (const c of list.slice(0, n)) per[c.condition] = (per[c.condition] ?? 0) + 1; return per; };
  check("HIGH/LOW stay close at any point (first 60)", Math.abs((firstN(60).HIGH ?? 0) - (firstN(60).LOW ?? 0)) <= 6, JSON.stringify(firstN(60)));
  check("two draws differ (crypto RNG, no fixed seed)", JSON.stringify(makeAllocation(60)) !== JSON.stringify(makeAllocation(60)));
}

const T0 = Date.parse("2026-10-05T02:00:00Z");
const k = (store: Store, op: string, extra: Record<string, unknown> = {}, at?: number) => handle(store, { op, by: "kiosk", ...(at ? { at } : {}), ...extra });

// 2) a whole kiosk session
{
  const store = memoryStore();
  const st = await k(store, "kStart", { source: "held" }, T0);
  check("a photo starts a participant: an ID and a cell", st.ok && st.pid === "MK_0001" && !!st.assigned?.animationId, `${st.pid} ${JSON.stringify(st.assigned)}`);
  const pid = st.pid!;
  const steps: [string, number, Record<string, unknown>?][] = [
    ["matched", 4, { variant: "corn", parts: { body: "corn", hat: "straw", arms: "twig", legs: "carrot" }, matched: true }],
    ["dance_start", 5], ["ladle_start", 20], ["ladle_end", 30], ["reveal", 30], ["animation_start", 32.8], ["animation_end", 38.4], ["observation_end", 44.4], ["walk_off", 44.5],
    ["motion", 52, { motion_energy: 101.5 }],
  ];
  const rs = []; for (const [ev, s, data] of steps) rs.push(await k(store, "kEvent", { pid, ev, data }, T0 + s * 1000));
  check("every step is taken", rs.every((r) => r.ok), rs.filter((r) => !r.ok).map((r) => r.error).join(","));
  const bad = await k(store, "kEvent", { pid, ev: "hack" });
  check("an unknown step is refused", !bad.ok);
  let live = await getLive(store);
  check("the live state follows the session (for the console)", live.pid === pid && live.stage === "walk", live.stage);
  const end = await k(store, "kEnd", { pid, completed: true }, T0 + 58000);
  live = await getLive(store);
  check("the session ends: completed, and nothing of the child left in the live state", end.ok && live.pid === null && live.assigned === null);
  const [s] = await store.listSessions();
  const need = ["session_start_time", "match_time", "dance_start_time", "ladle_start_time", "ladle_end_time", "reveal_time", "animation_start_time", "animation_end_time", "observation_end_time", "walk_off_time", "session_end_time"];
  check("every step time is kept", need.every((x) => !!s.times[x]), need.filter((x) => !s.times[x]).join(","));
  const dur = (a: string, b: string) => (Date.parse(s.times[b]) - Date.parse(s.times[a])) / 1000;
  check("the kiosk's clock is kept (clip 5.6 s, observation 6 s)", dur("animation_start_time", "animation_end_time") === 5.6 && dur("animation_end_time", "observation_end_time") === 6, `${dur("animation_start_time", "animation_end_time")} / ${dur("animation_end_time", "observation_end_time")}`);
  check("the creature and the covariate are recorded", s.variant === "corn" && s.parts?.hat === "straw" && s.matched === true && s.motion_energy === 101.5);
  check("completed, reached the end", s.completed && s.stage_reached === "done" && !s.flags.session_aborted);
  const again = await k(store, "kEnd", { pid, completed: false, reason: "x" });
  check("an end is said once (a later stop doesn't undo a completed session)", again.ok && (await store.listSessions())[0].completed);

  // 3) the researchers' notes, blinding
  const n1 = await handle(store, { op: "note", by: "console", pid, age: 6, q1: "걸어요", verbal: { observed: true, text: "날아간다!" }, flags: { parent_interruption: true, session_aborted: true }, note: "엄마 한마디" });
  const peek = await handle(store, { op: "reveal", by: "console", pid });
  let s1 = (await store.listSessions())[0];
  check("notes saved (age, Q1, the remark, a flag, the note)", n1.ok && s1.age === 6 && s1.q1_answer === "걸어요" && s1.spontaneous_verbalization === true && s1.spontaneous_verbalization_text === "날아간다!" && s1.flags.parent_interruption && s1.researcher_note === "엄마 한마디");
  check("the console can't mark a session aborted (only the kiosk ends sessions)", s1.flags.session_aborted === false);
  check("a look at the condition before Q2 is logged", peek.ok && s1.condition_revealed_early === true);
  await handle(store, { op: "note", by: "console", pid, q2: "우주에 가요, \"정말\"", q2Done: true });
  s1 = (await store.listSessions())[0];
  check("Q2 and its 'done' saved", s1.q2_answer.includes("우주") && s1.q2_done);

  // 4) a session that stops early; a reload mid-session (superseded); the next IDs
  const b = await k(store, "kStart", { source: "person" }, T0 + 70000);
  await k(store, "kEvent", { pid: b.pid, ev: "matched", data: { variant: "tomato" } }, T0 + 74000);
  await k(store, "kEnd", { pid: b.pid, completed: false, reason: "nothing_shown" }, T0 + 80000);
  const c = await k(store, "kStart", { source: "person" }, T0 + 90000);
  await k(store, "kEvent", { pid: c.pid, ev: "dance_start" }, T0 + 95000);
  const d = await k(store, "kStart", { source: "person" }, T0 + 100000); // (the page was reloaded: the next photo)
  const all = await store.listSessions();
  const sb = all.find((x) => x.participant_id === b.pid)!, sc = all.find((x) => x.participant_id === c.pid)!;
  check("stopped early: flagged, how far it got and why", sb.flags.session_aborted && sb.stage_reached === "match" && sb.end_reason === "nothing_shown" && !sb.completed);
  check("a session left behind by a reload is closed as superseded", sc.end_reason === "superseded" && sc.flags.session_aborted && sc.stage_reached === "dance");
  check("IDs keep counting; a stopped child's cell is not handed on", b.pid === "MK_0002" && c.pid === "MK_0003" && d.pid === "MK_0004");

  // 5) a session run offline on the kiosk, handed over later
  const off = await k(store, "kOffline", { session: { participant_id: "OFF-abc-1234", condition: "HIGH", animation_pair: "B", animation_id: "PAIR_B_HIGH_FLY", source: "held", times: { session_start_time: "2026-10-05T03:00:00.000Z", animation_start_time: "2026-10-05T03:00:30.000Z" }, completed: true, stage_reached: "done", motion_energy: 88 } });
  const twice = await k(store, "kOffline", { session: { participant_id: "OFF-abc-1234", condition: "HIGH", animation_pair: "B" } });
  const so = (await store.listSessions()).find((x) => x.participant_id === "OFF-abc-1234")!;
  check("an offline session is kept, flagged offline, sent twice = once", off.ok && twice.ok && so.offline && so.completed && so.motion_energy === 88 && so.block === null);

  // 6) the CSV
  const csv = toCsv(await store.listSessions()), lines = csv.split("\n");
  check("CSV: a header and one row per session", lines.length === 6 && lines[0].startsWith("participant_id,seq,offline,age,condition"), `${lines.length} lines`);
  check("CSV: text with commas / quotes is quoted", csv.includes('"우주에 가요, ""정말"""'));
  check("CSV: the parts are their own columns", lines[0].includes(",hat,arms,legs,") && lines[1].includes(",straw,twig,carrot,"));
}

// 7) compare-and-set: a write that lost the race is retried, not lost
{
  const base = memoryStore(); let failNext = true;
  const flaky: Store = { ...base, async writeSession(p, q, d, r) { if (failNext && r !== null) { failNext = false; return false; } return base.writeSession(p, q, d, r); } };
  const st = await k(flaky, "kStart", { source: "x" });
  const ev = await k(flaky, "kEvent", { pid: st.pid, ev: "dance_start" });
  check("a refused write (someone else wrote first) is re-read and retried", ev.ok && !!(await flaky.listSessions())[0].times.dance_start_time);
}
// 8) who may do what: the kiosk on the plain domain writes its sessions without the key; reading and notes need it
{
  const store = memoryStore(), KEY = "secret", site = { origin: "https://veggie-creature.vercel.app", host: "veggie-creature.vercel.app", ip: "1.2.3.4" };
  const kiosk = await researchRequest(store, "POST", {}, { op: "kStart", source: "held" }, undefined, KEY, false, site);
  check("the kiosk starts a session with no key, from the site itself", kiosk.status === 200 && (kiosk.body as any).pid === "MK_0001", `${kiosk.status}`);
  const pid = (kiosk.body as any).pid;
  const step = await researchRequest(store, "POST", {}, { op: "kEvent", pid, ev: "dance_start" }, undefined, KEY, false, site);
  check("…and reports its steps", step.status === 200);
  const elsewhere = await researchRequest(store, "POST", {}, { op: "kStart" }, undefined, KEY, false, { origin: "https://evil.example", host: "veggie-creature.vercel.app", ip: "9.9.9.9" });
  const noOrigin = await researchRequest(store, "POST", {}, { op: "kStart" }, undefined, KEY, false, { host: "veggie-creature.vercel.app", ip: "9.9.9.9" });
  check("…but not from another site, nor from outside a browser", elsewhere.status === 403 && noOrigin.status === 403);
  const read = await researchRequest(store, "GET", { sessions: "" }, undefined, undefined, KEY, false, site);
  const note = await researchRequest(store, "POST", {}, { op: "note", pid, q1: "x" }, undefined, KEY, false, site);
  check("reading the sessions or adding notes needs the key", read.status === 401 && note.status === 401);
  const readOk = await researchRequest(store, "GET", { sessions: "" }, undefined, KEY, KEY, false, site);
  check("…and works with it", readOk.status === 200 && (readOk.body as any).sessions.length === 1);
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
