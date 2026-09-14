import type { VercelRequest, VercelResponse } from "@vercel/node";
import { matchVariant } from "./_gemini.js";
import { checkLimit, limitKey } from "./_ratelimit.js";

export const maxDuration = 30;

// Scan photo in -> best-matching pre-made variant id out.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("stylize", key)) return res.status(429).json({ error: "rate_limited" });
  const { image } = (req.body ?? {}) as { image?: string };
  const { status, body } = await matchVariant(image ?? "");
  res.status(status).json(body);
}
