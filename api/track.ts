import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, clientIp } from "./_ratelimit.js";
import { saveJson } from "./_store.js";

export const maxDuration = 10;

// Analytics sink. Events go to (1) the function logs, (2) Vercel Blob when a
// store is connected (events/YYYY-MM-DD/...), and each device also keeps a full
// local copy (staff panel -> Export).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ip = clientIp(req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("track", ip)) return res.status(429).json({ error: "rate_limited" });
  const e = (req.body ?? {}) as Record<string, unknown>;
  console.log("[mk-event]", JSON.stringify(e));
  const day = new Date().toISOString().slice(0, 10);
  await saveJson(`events/${day}/${Date.now()}-${String(e.event ?? "e")}.json`, e);
  res.status(200).json({ ok: true });
}
