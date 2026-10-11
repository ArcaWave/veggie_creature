// Where the experiment's state and sessions live, and the one request handler both the Vercel function
// (api/research.ts) and `npm run dev` (vite.config.ts) use. The kiosk writes its sessions here, the
// researchers' console reads them and adds notes.
//   Vercel: Supabase tables research_state / research_sessions (SQL in docs/RESEARCH.md), service key from env.
//   dev:    .data/research.json (one process, one machine).
// Who may do what: the kiosk at the site itself (no key — the experiment runs on the plain domain) may only WRITE its
// own sessions (start, steps, end, an offline hand-over), from a page of this site, at a kiosk's pace. Reading
// anything, and the researchers' notes, need the research key (env RESEARCH_KEY, sent as x-research-key by the
// console — given once in its address, ?key=…): children's answers live here.
// Every finished or annotated session is also copied to the researchers' Google Sheet when RESEARCH_SHEET_URL is
// set (api/_researchsheet.ts) — after the answer, through `defer` (Vercel's waitUntil), so nobody waits on Google.
// The field survey's tablets (/survey, api/_survey.ts) read and write their records here too, with the key.
import fs from "node:fs";
import path from "node:path";
import { handle, getLive, toCsv, pick, type Store, type Session } from "./_researchcore.js";
import { checkLimit } from "./_ratelimit.js";
import { toSheet, sheetUrl } from "./_researchsheet.js";
import { surveyRequest } from "./_survey.js";

const supaEnv = () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  return url && key ? { url: url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, ""), key: key.trim() } : null;
};
async function supa(p: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const env = supaEnv()!;
  const r = await fetch(`${env.url}/rest/v1/${p}`, {
    method: init.method ?? "GET",
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (r.status === 409) return { conflict: true } as const;
  if (!r.ok) throw new Error(`supabase_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || init.prefer?.includes("return=minimal") ? null : r.json();
}
// (PostgREST answers at most 1000 rows to one request, whatever limit is asked: read on until a short page)
const PAGE = 1000;
async function supaAll<T>(p: string): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += PAGE) {
    const rows = (await supa(`${p}&limit=${PAGE}&offset=${o}`)) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
export function supabaseStore(): Store | null {
  if (!supaEnv()) return null;
  const enc = encodeURIComponent;
  return {
    async readState(key) { const rows = (await supa(`research_state?key=eq.${enc(key)}&select=rev,data`)) as { rev: number; data: any }[]; return rows[0] ?? null; },
    async writeState(key, data, rev) {
      if (rev === null) { const r = await supa("research_state", { method: "POST", body: { key, rev: 1, data }, prefer: "return=minimal" }); return !(r && "conflict" in r); }
      const rows = (await supa(`research_state?key=eq.${enc(key)}&rev=eq.${rev}`, { method: "PATCH", body: { rev: rev + 1, data, updated_at: new Date().toISOString() }, prefer: "return=representation" })) as unknown[];
      return rows.length === 1;
    },
    async listState(prefix) { return supaAll<{ key: string; data: any }>(`research_state?key=like.${enc(prefix)}*&select=key,data&order=key.asc`); },
    async readSession(pid) { const rows = (await supa(`research_sessions?participant_id=eq.${enc(pid)}&select=rev,data`)) as { rev: number; data: Session }[]; return rows[0] ?? null; },
    async writeSession(pid, seq, data, rev) {
      if (rev === null) { const r = await supa("research_sessions", { method: "POST", body: { participant_id: pid, seq, rev: 1, data }, prefer: "return=minimal" }); return !(r && "conflict" in r); }
      const rows = (await supa(`research_sessions?participant_id=eq.${enc(pid)}&rev=eq.${rev}`, { method: "PATCH", body: { rev: rev + 1, data, updated_at: new Date().toISOString() }, prefer: "return=representation" })) as unknown[];
      return rows.length === 1;
    },
    async listSessions(o = {}) {
      const ordered = "research_sessions?select=data&order=seq.asc,participant_id.asc";
      const rows = o.recent ? ((await supa(`research_sessions?select=data&order=created_at.desc&limit=${Math.min(o.recent, PAGE)}`)) as { data: Session }[])
        : o.limit ? ((await supa(`${ordered}&limit=${Math.min(o.limit, PAGE)}&offset=${o.offset ?? 0}`)) as { data: Session }[])
        : await supaAll<{ data: Session }>(ordered);
      return rows.map((r) => r.data);
    },
    async countSessions() { // (a count without the rows)
      const env = supaEnv()!;
      const r = await fetch(`${env.url}/rest/v1/research_sessions?select=participant_id`, { method: "HEAD", headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, Prefer: "count=exact", Range: "0-0" } });
      const m = /\/(\d+)$/.exec(r.headers.get("content-range") ?? "");
      if (!m) throw new Error(`supabase_count_${r.status}`);
      return Number(m[1]);
    },
  };
}
export function fileStore(file: string): Store {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { state: {}, sessions: {} }; } };
  const save = (db: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db, null, 1)); };
  return {
    async readState(key) { return load().state[key] ?? null; },
    async writeState(key, data, rev) { const db = load(); if ((db.state[key]?.rev ?? null) !== rev) return false; db.state[key] = { rev: (rev ?? 0) + 1, data }; save(db); return true; },
    async listState(prefix) { return Object.entries(load().state as Record<string, { data: any }>).filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, data: v.data })); },
    async readSession(pid) { return load().sessions[pid] ?? null; },
    async writeSession(pid, _seq, data, rev) { const db = load(); if ((db.sessions[pid]?.rev ?? null) !== rev) return false; db.sessions[pid] = { rev: (rev ?? 0) + 1, data }; save(db); return true; },
    async listSessions(o) { return pick((Object.values(load().sessions) as { data: Session }[]).map((s) => s.data), o); },
    async countSessions() { return Object.keys(load().sessions).length; },
  };
}

export type Out = { status: number; body: unknown; type?: string };
const KIOSK_OPS = new Set(["kStart", "kEvent", "kEnd", "kOffline"]);
// the sessions an op leaves worth copying to the sheet (not every step: the end carries them all)
function touched(body: any, r: any): string[] {
  switch (body?.op) {
    case "kStart": return r.superseded ? [r.superseded] : [];
    case "kEnd": case "note": case "reveal": return body.pid ? [String(body.pid)] : [];
    case "kOffline": return body.session?.participant_id ? [String(body.session.participant_id)] : [];
    default: return [];
  }
}
async function mirror(store: Store, pids: string[]) {
  const rows = (await Promise.all(pids.map((p) => store.readSession(p)))).filter((x) => !!x).map((x) => x!.data);
  const r = await toSheet(rows);
  if (!r.ok) console.warn("[research] sheet:", r.error, pids.join(","));
}
export type Defer = (p: Promise<unknown>) => void;
export type Caller = { origin?: string; host?: string; ip?: string };
const sameSite = (c: Caller) => { try { return !!c.origin && !!c.host && new URL(c.origin).host === c.host; } catch { return false; } };
export async function researchRequest(store: Store | null, method: string, query: Record<string, unknown>, body: any, key: string | undefined, requiredKey: string | undefined, open = false, caller: Caller = {}, defer: Defer = (p) => void p.catch(() => {})): Promise<Out> {
  if (!store) return { status: 503, body: { error: "research_store_missing", hint: "Supabase tables research_state / research_sessions — docs/RESEARCH.md" } };
  const keyOk = open || (!!requiredKey && key === requiredKey);
  const kioskWrite = method === "POST" && KIOSK_OPS.has(String(body?.op ?? ""));
  if (kioskWrite && !keyOk) {
    if (!sameSite(caller)) return { status: 403, body: { error: "not_from_this_site" } };
    if (!checkLimit("research-kiosk", caller.ip ?? "unknown")) return { status: 429, body: { error: "rate_limited" } };
  } else if (!keyOk) return { status: requiredKey ? 401 : 503, body: { error: requiredKey ? "research_key_wrong" : "research_not_configured" } };
  try {
    const sv = await surveyRequest(store, method, query, body, defer);
    if (sv) return sv;
    if (method === "GET") {
      if ("sessions" in query) { // &csv: every session as a CSV · &recent=N: the newest N (the console's table) · else every session
        if ("csv" in query) return { status: 200, body: "﻿" + toCsv(await store.listSessions()), type: "text/csv; charset=utf-8" };
        const recent = Math.floor(Number(query.recent));
        if (recent > 0) { const [sessions, total] = await Promise.all([store.listSessions({ recent: Math.min(recent, 500) }), store.countSessions()]); return { status: 200, body: { sessions, total } }; }
        const sessions = await store.listSessions();
        return { status: 200, body: { sessions, total: sessions.length } };
      }
      return { status: 200, body: { live: await getLive(store), now: Date.now(), sheet: !!sheetUrl() } };
    }
    if (method !== "POST") return { status: 405, body: { error: "GET or POST" } };
    if (body?.op === "sheetSync") { // the console: every session to the sheet again — one part per request ({ offset }),
      // the console asking for the next until `next` is null (thousands of sessions don't fit one request's time)
      if (!sheetUrl()) return { status: 409, body: { ok: false, error: "sheet_not_configured" } };
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0)), PART = 250;
      const [rows, total] = await Promise.all([store.listSessions({ offset, limit: PART }), store.countSessions()]);
      const r = await toSheet(rows, undefined, 45_000);
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error, offset, total } };
      return { status: 200, body: { ok: true, n: r.n ?? 0, total, next: offset + rows.length < total && rows.length ? offset + rows.length : null } };
    }
    const r = await handle(store, body ?? {});
    if (r.ok && sheetUrl()) { const pids = touched(body, r); if (pids.length) defer(mirror(store, pids).catch((e) => console.warn("[research] sheet:", e))); }
    delete r.superseded; // (the server's business)
    return { status: r.ok ? 200 : 409, body: r };
  } catch (e: any) {
    return { status: 500, body: { ok: false, error: "server_error", detail: String(e?.message || e).slice(0, 300) } };
  }
}
