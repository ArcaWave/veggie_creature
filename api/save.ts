import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkLimit, limitKey } from "./_ratelimit.js";
import { saveJson, saveDataUrl } from "./_store.js";

export const maxDuration = 30;

// Durable saves (consented at the profile gate):
//  {kind:"profile", profile:{...}}                — parent email + consents
//  {kind:"monster", monster:{... image: dataUrl}} — the child's creation (meta + clay)
//  {kind:"asset", asset:{profileId,type,data}}    — gallery raw material
//     (type: original | wake-video | cutout — collected for the future gallery)
// Child selfies (booth photos) are deliberately NOT accepted here.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
  if (!checkLimit("save", key)) return res.status(429).json({ error: "rate_limited" });

  const body = (req.body ?? {}) as {
    kind?: string;
    profile?: Record<string, unknown>;
    monster?: Record<string, unknown>;
    asset?: { profileId?: string | null; type?: string; data?: string };
  };

  try {
    if (body.kind === "profile" && body.profile && typeof body.profile.id === "string") {
      const saved = await saveJson(`profiles/${body.profile.id}.json`, { ...body.profile, savedAt: Date.now() });
      return res.status(200).json({ saved });
    }

    if (body.kind === "monster" && body.monster) {
      const m = body.monster;
      const image = typeof m.image === "string" ? m.image : "";
      if (image.length > 4_000_000) return res.status(413).json({ error: "image_too_large" });
      const stamp = `${m.profileId ?? "anon"}-${Date.now()}`;
      const imageUrl = image ? await saveDataUrl(`monsters/${stamp}.png`, image) : null;
      const saved = await saveJson(`monsters/${stamp}.json`, {
        profileId: m.profileId ?? null,
        name: m.name ?? "",
        traits: m.traits ?? [],
        eyes: m.eyes ?? [],
        stars: m.stars ?? 0,
        imageUrl,
        savedAt: Date.now(),
      });
      return res.status(200).json({ saved, imageSaved: !!imageUrl });
    }

    if (body.kind === "asset" && body.asset) {
      const a = body.asset;
      const data = typeof a.data === "string" ? a.data : "";
      const type = String(a.type ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "asset";
      if (!data.startsWith("data:")) return res.status(400).json({ error: "bad_data" });
      if (data.length > 4_200_000) return res.status(413).json({ error: "asset_too_large" });
      const ext = data.startsWith("data:video") ? "mp4" : data.startsWith("data:image/jpeg") ? "jpg" : "png";
      const url = await saveDataUrl(`gallery/${a.profileId ?? "anon"}-${type}-${Date.now()}.${ext}`, data);
      return res.status(200).json({ saved: !!url });
    }

    return res.status(400).json({ error: "bad_kind" });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String((e as Error)?.message ?? e) });
  }
}
