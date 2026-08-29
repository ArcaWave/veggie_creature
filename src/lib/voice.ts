import { getProfile } from "./profile";

// Character voice for the greeting. Primary: Typecast TTS via the server proxy
// (/api/speak -> mp3 data URL). Fallback: browser speech synthesis, so the
// captions always have SOME voice even with no key / offline.
// Lines are cached (and can be prefetched during the hello phase) so playback
// starts instantly when the dialogue begins.
// `seed` picks which catalog voice the creature speaks with — it defaults to the
// session profile id, so every family's creature sounds different while staying
// consistent within one visit. Lines are cached per (voice, text) pair.
const cache = new Map<string, Promise<string | null>>();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultSeed = () => getProfile()?.id ?? "creature";

// Typecast rate-limits concurrent requests (429), so each line retries with
// backoff, and prefetching runs the lines one at a time (see below).
function fetchLine(text: string, seed = defaultSeed()): Promise<string | null> {
  const k = `${seed}|${text}`;
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch("/api/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-mk-profile": getProfile()?.id ?? "" },
            body: JSON.stringify({ text, seed }),
          });
          const j = await r.json();
          if (typeof j.audio === "string") return j.audio;
          if (j.reason === "no_key" || j.reason === "no_voice") return null; // retrying won't help
        } catch {
          /* network hiccup — retry below */
        }
        await wait(900 * (attempt + 1));
      }
      return null;
    })();
    // a failed line shouldn't poison the cache — let a later call try again
    p.then((a) => {
      if (!a) cache.delete(k);
    });
    cache.set(k, p);
  }
  return p;
}

// Warm the cache while the child is still waving (network time is free there).
// Sequential on purpose: parallel requests trip Typecast's rate limit.
let prefetchChain: Promise<unknown> = Promise.resolve();
export function prefetchLines(lines: string[], seed = defaultSeed()) {
  for (const t of lines) {
    prefetchChain = prefetchChain.then(() => fetchLine(t, seed)).then(() => wait(350));
  }
}

let current: HTMLAudioElement | null = null;

// Speak one line: Typecast audio if available, else browser TTS. Any previous
// line is stopped first so overlapping timers never talk over each other.
export async function speakLine(text: string, seed = defaultSeed()) {
  stopSpeaking();
  const audio = await fetchLine(text, seed);
  if (audio) {
    try {
      const a = new Audio(audio);
      current = a;
      await a.play();
      return;
    } catch {
      /* autoplay hiccup -> browser TTS below */
    }
  }
  speakWithBrowser(text);
}

export function stopSpeaking() {
  try {
    current?.pause();
    current = null;
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

// Best-effort built-in fallback voice (English).
function speakWithBrowser(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1.25;
    const voice = synth.getVoices().find((v) => /^en([-_]|$)/i.test(v.lang));
    if (voice) u.voice = voice;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* captions cover it */
  }
}
