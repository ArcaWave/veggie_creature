import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";

export const maxDuration = 90;

// Proxy to the self-hosted AnimatedDrawings render server (see animator/).
// ANIMATOR_URL must point at a server reachable from this deployment; without
// it (or when unreachable) the client falls back to the eyes flow.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("animate", key)) return res.status(429).json({ error: "rate_limited" });

  const url = process.env.ANIMATOR_URL;
  if (!url) return res.status(200).json({ error: "no_server", detail: "ANIMATOR_URL not set" });
  const { image } = (req.body ?? {}) as { image?: string };
  try {
    const r = await fetch(`${url}/animate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: image ?? "" }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(200).json({ error: "no_server", detail: String((e as Error)?.message ?? e) });
  }
}
