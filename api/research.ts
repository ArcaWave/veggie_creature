import type { VercelRequest, VercelResponse } from "@vercel/node";
import { researchRequest, supabaseStore } from "./_researchstore.js";
import { clientIp } from "./_ratelimit.js";

export const maxDuration = 15;

// The suggestiveness experiment inside the kiosk (docs/RESEARCH.md). The kiosk (the plain domain) writes its
// sessions without a key; the console reads and adds notes with RESEARCH_KEY (x-research-key). Supabase tables
// research_state / research_sessions.
//   GET            -> { live, now }               the session in progress (the console polls it)
//   GET ?sessions  -> { sessions } (&csv: a CSV)  every session so far
//   POST { op, … } -> kStart (a photo was taken: ID + assignment), kEvent (a step), kEnd, kOffline (kiosk);
//                     note, reveal (console)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const key = String(req.headers["x-research-key"] ?? "") || undefined;
  const caller = { origin: String(req.headers.origin ?? "") || undefined, host: String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "") || undefined, ip: clientIp(req.headers["x-forwarded-for"], req.socket?.remoteAddress) };
  const out = await researchRequest(supabaseStore(), req.method ?? "GET", (req.query ?? {}) as Record<string, unknown>, req.body, key, process.env.RESEARCH_KEY, false, caller);
  if (out.type) { res.setHeader("Content-Type", out.type); res.setHeader("Content-Disposition", 'attachment; filename="research_sessions.csv"'); return res.status(out.status).send(out.body as string); }
  res.status(out.status).json(out.body);
}
