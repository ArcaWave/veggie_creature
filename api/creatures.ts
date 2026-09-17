import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";
import { listCreatures, uploadCreature, relayStatus, type CreatureParts } from "./_creaturestore.js";

export const maxDuration = 30;

// GET  -> newest living creatures [{id, variant, at, parts?}] (polled by world.html)
//         ?diag=1 adds the relay's health (which store, last list/upload error)
// POST {variant, parts?} -> the scan station announces a new arrival;
//         {uploaded:false, reason} says WHY when the store refused it
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    const creatures = await listCreatures();
    const diag = "diag" in (req.query ?? {}) ? { ...relayStatus, listed: creatures.length, now: Date.now() } : undefined;
    return res.status(200).json({ creatures, diag });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("save", key)) return res.status(429).json({ error: "rate_limited" });

  const { variant, parts } = (req.body ?? {}) as { variant?: string; parts?: Partial<CreatureParts> };
  const entry = await uploadCreature(variant, parts);
  res.status(200).json({ uploaded: !!entry, entry, reason: entry ? undefined : relayStatus.uploadError });
}
