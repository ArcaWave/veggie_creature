// The relay between the SCAN PC and the DISPLAY PC: a tiny rolling list of the
// latest creatures ({id, variant, at, parts}). The art itself ships with the
// site (public/parts/), so nothing heavy ever travels.
//
// Sized for the exhibition (200+ children a day, the wall polling all day):
//  0. Supabase (Postgres over REST) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//     are set: one tiny row per arrival, one SELECT per poll. The free plan has
//     no request quota, only storage/egress this data never approaches.
//     PREFERRED. One-time setup — SQL editor:
//       create table creatures (id text primary key, variant text not null,
//         at bigint not null, parts jsonb, created_at timestamptz default now());
//       alter table creatures enable row level security;  -- no policies: only
//       the service key (server-side, never shipped to the browser) can touch it
//  1. Redis over REST (Upstash — the Vercel Marketplace "Redis/KV" integration
//     injects KV_REST_API_URL + KV_REST_API_TOKEN): one command per poll, two
//     per arrival. ~8k commands/day.
//  2. Vercel Blob, frugally: one put per arrival, and the list is refreshed at
//     most every BLOB_REFRESH_MS per function instance (polls are answered
//     from memory in between) — never a list per poll, which is what burned
//     the Blob quota before.
//  3. No cloud store at all: the dev / kiosk server keeps the list itself
//     (vite.config.ts), which is all a single-venue LAN setup needs.
import { put, list } from "@vercel/blob";

export type CreatureParts = { body: string; hat: string; arms: string; legs: string };
export type CreatureEntry = { id: string; variant: string; at: number; parts?: CreatureParts };

const KEEP = 60;                 // the wall only ever shows the latest arrivals
const REDIS_KEY = "vc:creatures";
const BLOB_REFRESH_MS = 20_000;

const redisEnv = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
};
const supaEnv = () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  // accept the bare project URL or the "Data API" form the dashboard also shows (…/rest/v1/)
  return url && key ? { url: url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, ""), key: key.trim() } : null;
};
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const storeKind = (): "supabase" | "redis" | "blob" | "none" =>
  supaEnv() ? "supabase" : redisEnv() ? "redis" : hasBlob() ? "blob" : "none";

// why the last upload / listing failed — surfaced by the API so a broken relay
// (missing store, exhausted quota, suspended store…) is never silent
export const relayStatus: { store: string; uploadError: string | null; listError: string | null } = {
  store: "none", uploadError: null, listError: null,
};
const brief = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
const clean = (v: unknown) => String(v ?? "").replace(/[^\w-]/g, "").slice(0, 40);

export function makeEntry(variant: unknown, parts?: Partial<CreatureParts> | null): CreatureEntry | null {
  const safe = clean(variant);
  if (!safe) return null;
  const at = Date.now();
  const entry: CreatureEntry = { id: `${at}-${safe}`, variant: safe, at };
  if (parts && clean(parts.hat) && clean(parts.arms) && clean(parts.legs)) {
    entry.parts = { body: safe, hat: clean(parts.hat), arms: clean(parts.arms), legs: clean(parts.legs) };
  }
  return entry;
}

// ---- Supabase (PostgREST) -----------------------------------------------------
async function supa(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
  const env = supaEnv()!;
  const r = await fetch(`${env.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!r.ok) throw new Error(`supabase_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || init.prefer === "return=minimal" ? null : r.json();
}

// ---- Redis (REST) -----------------------------------------------------------
async function redis(commands: (string | number)[][]): Promise<any[]> {
  const env = redisEnv()!;
  const r = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`redis_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = (await r.json()) as { result?: unknown; error?: string }[];
  const bad = out.find((o) => o.error);
  if (bad) throw new Error(`redis: ${bad.error}`);
  return out.map((o) => o.result);
}

// ---- Blob (frugal) ------------------------------------------------------------
// blob name: creatures/<ts>-<body>.<hat>.<arms>.<legs>.json (parts optional) —
// everything lives in the NAME so a listing needs no downloads
export function creatureBlobName(entry: CreatureEntry) {
  const p = entry.parts;
  return `creatures/${entry.id}${p ? `.${clean(p.hat)}.${clean(p.arms)}.${clean(p.legs)}` : ""}.json`;
}
const mem: { list: CreatureEntry[]; refreshedAt: number } = { list: [], refreshedAt: 0 };
const remember = (entries: CreatureEntry[]) => {
  const byId = new Map(mem.list.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  mem.list = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, KEEP);
};

// ---- API ------------------------------------------------------------------------
export async function uploadCreature(variant: unknown, parts?: Partial<CreatureParts> | null): Promise<CreatureEntry | null> {
  const store = (relayStatus.store = storeKind());
  if (store === "none") { relayStatus.uploadError = "no_store"; return null; }
  const entry = makeEntry(variant, parts);
  if (!entry) { relayStatus.uploadError = "bad_variant"; return null; }
  try {
    if (store === "supabase") {
      await supa("creatures", { method: "POST", prefer: "return=minimal", body: { id: entry.id, variant: entry.variant, at: entry.at, parts: entry.parts ?? null } });
    } else if (store === "redis") {
      await redis([["LPUSH", REDIS_KEY, JSON.stringify(entry)], ["LTRIM", REDIS_KEY, 0, KEEP - 1]]);
    } else {
      await put(creatureBlobName(entry), JSON.stringify(entry), {
        access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
      });
      remember([entry]); // the same instance answers the wall at once
    }
    relayStatus.uploadError = null;
    return entry;
  } catch (e) {
    relayStatus.uploadError = `${store}_put_failed: ${brief(e)}`;
    console.error("[creatures] upload failed:", e);
    return null;
  }
}

// newest first, capped
export async function listCreatures(): Promise<CreatureEntry[]> {
  const store = (relayStatus.store = storeKind());
  if (store === "none") { relayStatus.listError = "no_store"; return []; }
  try {
    if (store === "supabase") {
      const rows = (await supa(`creatures?select=id,variant,at,parts&order=at.desc&limit=${KEEP}`)) as any[];
      relayStatus.listError = null;
      return rows.map((r) => ({ id: String(r.id), variant: String(r.variant), at: Number(r.at), ...(r.parts ? { parts: r.parts as CreatureParts } : {}) }));
    }
    if (store === "redis") {
      const [rows] = await redis([["LRANGE", REDIS_KEY, 0, KEEP - 1]]);
      relayStatus.listError = null;
      return ((rows as string[]) ?? []).map((s) => { try { return JSON.parse(s) as CreatureEntry; } catch { return null; } })
        .filter((e): e is CreatureEntry => !!e && typeof e.id === "string");
    }
    if (Date.now() - mem.refreshedAt > BLOB_REFRESH_MS) {
      mem.refreshedAt = Date.now();
      const { blobs } = await list({ prefix: "creatures/", limit: 1000 });
      const out: CreatureEntry[] = [];
      for (const b of blobs) {
        const m = /creatures\/(\d+)-([\w-]+?)(?:\.(\w+)\.(\w+)\.(\w+))?\.json$/.exec(b.pathname);
        if (!m) continue;
        const entry: CreatureEntry = { id: `${m[1]}-${m[2]}`, variant: m[2], at: Number(m[1]) };
        if (m[3]) entry.parts = { body: m[2], hat: m[3], arms: m[4], legs: m[5] };
        out.push(entry);
      }
      remember(out);
    }
    relayStatus.listError = null;
    return mem.list;
  } catch (e) {
    relayStatus.listError = `${store}_list_failed: ${brief(e)}`;
    console.error("[creatures] list failed:", e);
    return mem.list;
  }
}

// ---- the event in numbers (for the report / promo: "N children made a veggie friend") ----------
// Every arrival stays in the store (the wall only reads the latest), so the whole event can be
// counted: in total, per day and hour (Korean time), per vegetable and per sticker.
export type CreatureStats = {
  total: number; first: number | null; last: number | null; source: string;
  byDay: Record<string, number>; byHour: Record<string, number>;
  byVariant: Record<string, number>; byHat: Record<string, number>; byArms: Record<string, number>; byLegs: Record<string, number>;
};
export function summarize(entries: { variant: string; at: number; parts?: CreatureParts | null }[], source: string): CreatureStats {
  const s: CreatureStats = { total: 0, first: null, last: null, source, byDay: {}, byHour: {}, byVariant: {}, byHat: {}, byArms: {}, byLegs: {} };
  const inc = (o: Record<string, number>, k: string | undefined) => { if (k) o[k] = (o[k] ?? 0) + 1; };
  for (const e of entries) {
    const kst = new Date(e.at + 9 * 3600_000).toISOString(); // YYYY-MM-DDTHH… in Korean time
    s.total++;
    s.first = s.first === null ? e.at : Math.min(s.first, e.at);
    s.last = s.last === null ? e.at : Math.max(s.last, e.at);
    inc(s.byDay, kst.slice(0, 10)); inc(s.byHour, kst.slice(11, 13));
    inc(s.byVariant, e.variant); inc(s.byHat, e.parts?.hat); inc(s.byArms, e.parts?.arms); inc(s.byLegs, e.parts?.legs);
  }
  return s;
}
export async function creatureStats(since = 0): Promise<CreatureStats> {
  if (storeKind() === "supabase") {
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) { // (the Data API hands out at most 1000 rows a request)
      const page = (await supa(`creatures?select=variant,at,parts&at=gte.${Math.floor(since)}&order=at.asc&limit=1000&offset=${off}`)) as any[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return summarize(rows.map((r) => ({ variant: String(r.variant), at: Number(r.at), parts: r.parts })), "supabase (all arrivals)");
  }
  return summarize((await listCreatures()).filter((e) => e.at >= since), `${storeKind()} (latest ${KEEP} only)`);
}
