import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";
import { sendKeepsakes } from "./_email.js";

export const maxDuration = 30;

// Emails the session keepsakes (certificate / clay / live clip) to the parent
// address collected at the profile gate.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("email", key)) return res.status(429).json({ error: "rate_limited" });

  const body = (req.body ?? {}) as {
    to?: string;
    monsterName?: string;
    attachments?: { filename?: string; dataUrl?: string }[];
  };
  const to = String(body.to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "bad_email" });

  const list = (body.attachments ?? [])
    .filter((a) => typeof a?.dataUrl === "string" && typeof a?.filename === "string")
    .slice(0, 4) as { filename: string; dataUrl: string }[];
  const totalSize = list.reduce((n, a) => n + a.dataUrl.length, 0);
  if (totalSize > 3_800_000) return res.status(413).json({ error: "attachments_too_large" });

  const result = await sendKeepsakes(to, String(body.monsterName ?? "Your creature"), list);
  res.status(200).json(result);
}
