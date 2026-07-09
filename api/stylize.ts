import type { VercelRequest, VercelResponse } from "@vercel/node";
import { stylize } from "./_gemini";
import { checkLimit, limitKey } from "./_ratelimit";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("stylize", key)) return res.status(429).json({ error: "rate_limited" });
  const { image, prompt } = (req.body ?? {}) as { image?: string; prompt?: string };
  const { status, body } = await stylize(image ?? "", prompt);
  res.status(status).json(body);
}
