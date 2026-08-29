import type { VercelRequest, VercelResponse } from "@vercel/node";
import { speak } from "./_typecast.js";
import { checkLimit, limitKey } from "./_ratelimit.js";

export const maxDuration = 30;

// Character voice line (Typecast TTS) -> mp3 data URL. The client falls back to
// browser speech synthesis when this returns no audio.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("speak", key)) return res.status(429).json({ error: "rate_limited" });
  const { text, seed } = (req.body ?? {}) as { text?: string; seed?: string };
  const { status, body } = await speak(text ?? "", seed);
  res.status(status).json(body);
}
