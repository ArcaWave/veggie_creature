import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, clientIp } from "./_ratelimit.js";

export const maxDuration = 10;

// Analytics sink. Events land in the Vercel function logs (`vercel logs`, or the
// dashboard). Each device also keeps a full local copy (staff panel -> Export).
// TODO for durable cloud storage: forward `req.body` to Vercel KV / a DB / a
// Google Sheets webhook here.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ip = clientIp(req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("track", ip)) return res.status(429).json({ error: "rate_limited" });
  console.log("[mk-event]", JSON.stringify(req.body ?? {}));
  res.status(200).json({ ok: true });
}
