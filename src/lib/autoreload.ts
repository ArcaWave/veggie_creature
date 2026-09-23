// ?autoreload: a page left running all day picks up a new deploy by itself. Every minute it asks
// the server whether its own HTML changed (ETag); when it has, it reloads at the next QUIET moment
// the caller vouches for (the station: the welcome screen with nobody in front of it). Needs a
// kiosk Chrome started with --autoplay-policy=no-user-gesture-required, or the voice / music would
// wait for a click again after the reload.
const ON = new URLSearchParams(location.search).has("autoreload");
let first: string | null = null, changed = false;
async function check(path: string) {
  try {
    const r = await fetch(path, { method: "HEAD", cache: "no-store" });
    const tag = r.headers.get("etag") || r.headers.get("last-modified");
    if (!tag) return;
    if (first === null) first = tag;
    else if (tag !== first) changed = true;
  } catch { /* offline blip */ }
}
export function startAutoReload(path = "/") {
  if (!ON) return;
  void check(path);
  window.setInterval(() => void check(path), 60000);
}
// call when it is a good moment to reload; it does so only if a new version is waiting
export function reloadIfUpdated() {
  if (ON && changed) location.reload();
}
