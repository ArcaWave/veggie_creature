import { getProfile } from "../lib/profile";

export type StylizeResult = {
  stylized: string | null; // clay data URL; null on failure/no key
  reason?: "no_key" | "no_image_returned";
  error?: string;
};

// Server proxy call. The profile header keys the per-visitor rate limit
// (booth tablets share one IP, so IP limits alone would collide).
export async function stylizePhoto(image: string): Promise<StylizeResult> {
  try {
    const r = await fetch("/api/stylize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mk-profile": getProfile()?.id ?? "",
      },
      body: JSON.stringify({ image }),
    });
    return (await r.json()) as StylizeResult;
  } catch (e) {
    return { stylized: null, error: String(e) };
  }
}
