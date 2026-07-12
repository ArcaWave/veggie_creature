// Durable storage via Vercel Blob (enabled by connecting a Blob store to the
// project in the Vercel dashboard — that injects BLOB_READ_WRITE_TOKEN).
// Without the token everything degrades gracefully to "not saved".
// Blob URLs are public-but-unguessable (random suffix); for stricter privacy
// later, swap this module for a real database — callers won't change.
import { put } from "@vercel/blob";

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export async function saveJson(path: string, obj: unknown): Promise<boolean> {
  if (!hasBlob()) return false;
  try {
    await put(path, JSON.stringify(obj), {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/json",
    });
    return true;
  } catch {
    return false;
  }
}

// stores a data URL image; returns the blob URL (or null)
export async function saveDataUrl(path: string, dataUrl: string): Promise<string | null> {
  if (!hasBlob()) return null;
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  try {
    const { url } = await put(path, Buffer.from(m[2], "base64"), {
      access: "public",
      addRandomSuffix: true,
      contentType: m[1],
    });
    return url;
  } catch {
    return null;
  }
}
