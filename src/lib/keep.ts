import { getProfile } from "./profile";

// Fire-and-forget archiving of raw session materials for a FUTURE GALLERY.
// OFF unless the kiosk URL carries ?keep: the staff-less flow has no consent
// gate, so children's photos must not be stored by default — and one upload
// per child is also storage/quota the exhibition does not need to spend.
// Types in use: "original" (the veggie photo), "wake-video" (the alive mp4),
// "cutout" (background-removed character PNG).
const KEEP_ON = new URLSearchParams(location.search).has("keep");

export function keepAsset(type: string, data: string | null | undefined) {
  if (!KEEP_ON) return;
  const p = getProfile();
  if (!p || !data || !data.startsWith("data:")) return;
  if (data.length > 4_200_000) return; // over the request limit — skip quietly
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mk-profile": p.id },
    body: JSON.stringify({ kind: "asset", asset: { profileId: p.id, type, data } }),
  }).catch(() => {});
}
