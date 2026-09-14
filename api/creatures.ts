import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";
import { listCreatures, uploadCreature } from "./_creaturestore.js";

export const maxDuration = 30;

// GET  -> newest living creatures [{id, variant, at}] (polled by world.html)
// POST {variant} -> the scan station announces a new arrival
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ creatures: await listCreatures() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("save", key)) return res.status(429).json({ error: "rate_limited" });

  const { variant } = (req.body ?? {}) as { variant?: string };
  const entry = await uploadCreature(String(variant ?? ""));
  res.status(200).json({ uploaded: !!entry, entry });
}
