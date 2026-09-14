import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";
import { listCreatures, uploadCreatureClip } from "./_creaturestore.js";

export const maxDuration = 30;

// GET  -> newest living creatures (polled by the display wall, world.html)
// POST {id, kind, clip} -> the scan station uploads one clip (gif data URL)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ creatures: await listCreatures() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("save", key)) return res.status(429).json({ error: "rate_limited" });

  const { id, kind, clip } = (req.body ?? {}) as { id?: string; kind?: string; clip?: string };
  if (kind !== "greet" && kind !== "smile") return res.status(400).json({ error: "bad_kind" });
  if (typeof clip !== "string" || clip.length > 4_200_000) return res.status(413).json({ error: "clip_too_large" });
  const uploaded = await uploadCreatureClip(String(id ?? ""), kind, clip);
  res.status(200).json({ uploaded });
}
