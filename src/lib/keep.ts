import { getProfile } from "./profile";

// Fire-and-forget archiving of raw session materials for the FUTURE GALLERY
// (consented at the profile gate). Never blocks or breaks the play flow.
// Types in use: "original" (the veggie photo), "wake-video" (the alive mp4),
// "cutout" (background-removed character PNG).
export function keepAsset(type: string, data: string | null | undefined) {
  const p = getProfile();
  if (!p || !data || !data.startsWith("data:")) return;
  if (data.length > 4_200_000) return; // over the request limit — skip quietly
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mk-profile": p.id },
    body: JSON.stringify({ kind: "asset", asset: { profileId: p.id, type, data } }),
  }).catch(() => {});
}
