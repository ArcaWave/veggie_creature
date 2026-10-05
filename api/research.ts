import type { VercelRequest, VercelResponse } from "@vercel/node";
import { researchRequest, supabaseStore } from "./_researchstore.js";

export const maxDuration = 15;

// The suggestiveness experiment inside the kiosk (docs/RESEARCH.md). Needs RESEARCH_KEY (sent as x-research-key)
// and the Supabase tables research_state / research_sessions.
//   GET            -> { live, now }               the session in progress (the console polls it)
//   GET ?sessions  -> { sessions } (&csv: a CSV)  every session so far
//   POST { op, … } -> kStart (a photo was taken: ID + assignment), kEvent (a step), kEnd, kOffline (kiosk);
//                     note, reveal (console)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const key = String(req.headers["x-research-key"] ?? "") || undefined;
  const out = await researchRequest(supabaseStore(), req.method ?? "GET", (req.query ?? {}) as Record<string, unknown>, req.body, key, process.env.RESEARCH_KEY);
  if (out.type) { res.setHeader("Content-Type", out.type); res.setHeader("Content-Disposition", 'attachment; filename="research_sessions.csv"'); return res.status(out.status).send(out.body as string); }
  res.status(out.status).json(out.body);
}
