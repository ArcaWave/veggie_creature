// Cloud relay between the SCAN PC and the DISPLAY PC (no shared network needed).
// The character art is PRE-MADE and shipped with the deployed site
// (public/parts/), so only a tiny metadata record travels through Vercel Blob
// per creature: which body and sticker parts came alive, and when — all of it
// encoded in the blob's NAME so listing needs no downloads. Requires
// BLOB_READ_WRITE_TOKEN; without it everything degrades to empty/false.
import { put, list } from "@vercel/blob";

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type CreatureParts = { body: string; hat: string; arms: string; legs: string };
export type CreatureEntry = { id: string; variant: string; at: number; parts?: CreatureParts };

const clean = (v: unknown) => String(v ?? "").replace(/[^\w-]/g, "").slice(0, 40);

// blob name: creatures/<ts>-<body>.<hat>.<arms>.<legs>.json (parts optional)
export function creatureBlobName(entry: CreatureEntry) {
  const p = entry.parts;
  return `creatures/${entry.id}${p ? `.${clean(p.hat)}.${clean(p.arms)}.${clean(p.legs)}` : ""}.json`;
}

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

// why the last upload / listing failed — surfaced by the API so a broken relay
// (missing token, exhausted Blob quota, suspended store…) is never silent
export const relayStatus: { hasToken: boolean; uploadError: string | null; listError: string | null } = {
  hasToken: false, uploadError: null, listError: null,
};
const brief = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

export async function uploadCreature(variant: unknown, parts?: Partial<CreatureParts> | null): Promise<CreatureEntry | null> {
  relayStatus.hasToken = hasBlob();
  if (!hasBlob()) { relayStatus.uploadError = "no_blob_token"; return null; }
  const entry = makeEntry(variant, parts);
  if (!entry) { relayStatus.uploadError = "bad_variant"; return null; }
  try {
    await put(creatureBlobName(entry), JSON.stringify(entry), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    relayStatus.uploadError = null;
    return entry;
  } catch (e) {
    relayStatus.uploadError = `put_failed: ${brief(e)}`;
    console.error("[creatures] put failed:", e);
    return null;
  }
}

// newest first, capped — the wall only ever shows the latest arrivals anyway
export async function listCreatures(): Promise<CreatureEntry[]> {
  relayStatus.hasToken = hasBlob();
  if (!hasBlob()) { relayStatus.listError = "no_blob_token"; return []; }
  try {
    const { blobs } = await list({ prefix: "creatures/", limit: 1000 });
    const out: CreatureEntry[] = [];
    for (const b of blobs) {
      const m = /creatures\/(\d+)-([\w-]+?)(?:\.(\w+)\.(\w+)\.(\w+))?\.json$/.exec(b.pathname);
      if (!m) continue;
      const entry: CreatureEntry = { id: `${m[1]}-${m[2]}`, variant: m[2], at: Number(m[1]) };
      if (m[3]) entry.parts = { body: m[2], hat: m[3], arms: m[4], legs: m[5] };
      out.push(entry);
    }
    relayStatus.listError = null;
    return out.sort((a, b) => b.at - a.at).slice(0, 60);
  } catch (e) {
    relayStatus.listError = `list_failed: ${brief(e)}`;
    console.error("[creatures] list failed:", e);
    return [];
  }
}
