// Where the experiment's state and sessions live, and the one request handler both the Vercel function
// (api/research.ts) and `npm run dev` (vite.config.ts) use. The kiosk writes its sessions here, the
// researchers' console reads them and adds notes.
//   Vercel: Supabase tables research_state / research_sessions (SQL in docs/RESEARCH.md), service key from env.
//   dev:    .data/research.json (one process, one machine).
// Who may do what: the kiosk at the site itself (no key — the experiment runs on the plain domain) may only WRITE its
// own sessions (start, steps, end, an offline hand-over), from a page of this site, at a kiosk's pace. Reading
// anything, and the researchers' notes, need the research key (env RESEARCH_KEY, sent as x-research-key by the
// console — given once in its address, ?key=…): children's answers live here.
import fs from "node:fs";
import path from "node:path";
import { handle, getLive, toCsv, type Store, type Session } from "./_researchcore.js";
import { checkLimit } from "./_ratelimit.js";

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
    async readSession(pid) { const rows = (await supa(`research_sessions?participant_id=eq.${enc(pid)}&select=rev,data`)) as { rev: number; data: Session }[]; return rows[0] ?? null; },
    async writeSession(pid, seq, data, rev) {
      if (rev === null) { const r = await supa("research_sessions", { method: "POST", body: { participant_id: pid, seq, rev: 1, data }, prefer: "return=minimal" }); return !(r && "conflict" in r); }
      const rows = (await supa(`research_sessions?participant_id=eq.${enc(pid)}&rev=eq.${rev}`, { method: "PATCH", body: { rev: rev + 1, data, updated_at: new Date().toISOString() }, prefer: "return=representation" })) as unknown[];
      return rows.length === 1;
    },
    async listSessions() { const rows = (await supa("research_sessions?select=data&order=seq.asc&limit=5000")) as { data: Session }[]; return rows.map((r) => r.data); },
  };
}
export function fileStore(file: string): Store {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { state: {}, sessions: {} }; } };
  const save = (db: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db, null, 1)); };
  return {
    async readState(key) { return load().state[key] ?? null; },
    async writeState(key, data, rev) { const db = load(); if ((db.state[key]?.rev ?? null) !== rev) return false; db.state[key] = { rev: (rev ?? 0) + 1, data }; save(db); return true; },
    async readSession(pid) { return load().sessions[pid] ?? null; },
    async writeSession(pid, _seq, data, rev) { const db = load(); if ((db.sessions[pid]?.rev ?? null) !== rev) return false; db.sessions[pid] = { rev: (rev ?? 0) + 1, data }; save(db); return true; },
    async listSessions() { return (Object.values(load().sessions) as { data: Session }[]).map((s) => s.data).sort((a, b) => a.seq - b.seq); },
  };
}

export type Out = { status: number; body: unknown; type?: string };
const KIOSK_OPS = new Set(["kStart", "kEvent", "kEnd", "kOffline"]);
export type Caller = { origin?: string; host?: string; ip?: string };
const sameSite = (c: Caller) => { try { return !!c.origin && !!c.host && new URL(c.origin).host === c.host; } catch { return false; } };
export async function researchRequest(store: Store | null, method: string, query: Record<string, unknown>, body: any, key: string | undefined, requiredKey: string | undefined, open = false, caller: Caller = {}): Promise<Out> {
  if (!store) return { status: 503, body: { error: "research_store_missing", hint: "Supabase tables research_state / research_sessions — docs/RESEARCH.md" } };
  const keyOk = open || (!!requiredKey && key === requiredKey);
  const kioskWrite = method === "POST" && KIOSK_OPS.has(String(body?.op ?? ""));
  if (kioskWrite && !keyOk) {
    if (!sameSite(caller)) return { status: 403, body: { error: "not_from_this_site" } };
    if (!checkLimit("research-kiosk", caller.ip ?? "unknown")) return { status: 429, body: { error: "rate_limited" } };
  } else if (!keyOk) return { status: requiredKey ? 401 : 503, body: { error: requiredKey ? "research_key_wrong" : "research_not_configured" } };
  try {
    if (method === "GET") {
      if ("sessions" in query) {
        const rows = await store.listSessions();
        return "csv" in query ? { status: 200, body: "﻿" + toCsv(rows), type: "text/csv; charset=utf-8" } : { status: 200, body: { sessions: rows } };
      }
      return { status: 200, body: { live: await getLive(store), now: Date.now() } };
    }
    if (method !== "POST") return { status: 405, body: { error: "GET or POST" } };
    const r = await handle(store, body ?? {});
    return { status: r.ok ? 200 : 409, body: r };
  } catch (e: any) {
    return { status: 500, body: { ok: false, error: "server_error", detail: String(e?.message || e).slice(0, 300) } };
  }
}
