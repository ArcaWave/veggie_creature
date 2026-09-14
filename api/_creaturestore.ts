// Cloud relay between the SCAN PC and the DISPLAY PC (no shared network needed):
// the scan station uploads each living creature's clips to Vercel Blob, and the
// display wall lists them back. Requires BLOB_READ_WRITE_TOKEN (a connected
// Blob store); without it everything returns empty/false and the scan flow is
// unaffected.
import { put, list } from "@vercel/blob";

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type CreatureEntry = { id: string; greet?: string; smile?: string; at: number };

export async function uploadCreatureClip(id: string, kind: "greet" | "smile", dataUrl: string): Promise<boolean> {
  if (!hasBlob()) return false;
  const m = /^data:image\/gif;base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return false;
  const safeId = id.replace(/[^\w-]/g, "").slice(0, 40) || "creature";
  try {
    await put(`creatures/${safeId}-${kind}.gif`, Buffer.from(m[1], "base64"), {
      access: "public",
      contentType: "image/gif",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return true;
  } catch {
    return false;
  }
}

// newest first, capped — the wall only ever shows the latest arrivals anyway
export async function listCreatures(): Promise<CreatureEntry[]> {
  if (!hasBlob()) return [];
  try {
    const { blobs } = await list({ prefix: "creatures/", limit: 1000 });
    const byId = new Map<string, CreatureEntry>();
    for (const b of blobs) {
      const m = /creatures\/(.+)-(greet|smile)\.gif$/.exec(b.pathname);
      if (!m) continue;
      const e = byId.get(m[1]) ?? { id: m[1], at: 0 };
      e[m[2] as "greet" | "smile"] = b.url;
      e.at = Math.max(e.at, +new Date(b.uploadedAt));
      byId.set(m[1], e);
    }
    return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, 60);
  } catch {
    return [];
  }
}
