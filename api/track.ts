import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, clientIp } from "./_ratelimit.js";

export const maxDuration = 10;

// Analytics sink. Events go to the function logs, and each device keeps the
// full local copy (staff panel -> Export). They are deliberately NOT written to
// Blob any more: one file per event meant ~15 storage writes per child, which
// alone exhausts a Blob quota within a day of an exhibition.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ip = clientIp(req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("track", ip)) return res.status(429).json({ error: "rate_limited" });
  const e = (req.body ?? {}) as Record<string, unknown>;
  console.log("[mk-event]", JSON.stringify(e));
  res.status(200).json({ ok: true });
}
