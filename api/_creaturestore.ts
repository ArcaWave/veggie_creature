// Cloud relay between the SCAN PC and the DISPLAY PC (no shared network needed).
// The clips themselves are PRE-MADE and shipped with the deployed site
// (public/variants/), so only a tiny metadata record travels through Vercel
// Blob per creature: which variant came alive, and when. Requires
// BLOB_READ_WRITE_TOKEN; without it everything degrades to empty/false.
import { put, list } from "@vercel/blob";

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type CreatureEntry = { id: string; variant: string; at: number };

export async function uploadCreature(variant: string): Promise<CreatureEntry | null> {
  if (!hasBlob()) return null;
  const safe = variant.replace(/[^\w-]/g, "").slice(0, 40);
  if (!safe) return null;
  const entry: CreatureEntry = { id: `${Date.now()}-${safe}`, variant: safe, at: Date.now() };
  try {
    await put(`creatures/${entry.id}.json`, JSON.stringify(entry), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return entry;
  } catch {
    return null;
  }
}

// newest first, capped — the wall only ever shows the latest arrivals anyway
export async function listCreatures(): Promise<CreatureEntry[]> {
  if (!hasBlob()) return [];
  try {
    const { blobs } = await list({ prefix: "creatures/", limit: 1000 });
    const out: CreatureEntry[] = [];
    for (const b of blobs) {
      const m = /creatures\/(\d+)-([\w-]+)\.json$/.exec(b.pathname);
      if (m) out.push({ id: `${m[1]}-${m[2]}`, variant: m[2], at: Number(m[1]) });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 60);
  } catch {
    return [];
  }
}
