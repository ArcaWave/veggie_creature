import { sfxEnabled } from "./sfx";

// Spoken guidance for the staff-less kiosk, via the browser's built-in Korean
// TTS (offline, free — unlike lib/voice.ts, which is the legacy Typecast
// character voice). Every call cancels the previous line so prompts never pile
// up; everything is best-effort — a device without Korean voices simply stays
// silent and the on-screen text carries the flow.
let koVoice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  if (koVoice) return koVoice;
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  koVoice =
    voices.find((v) => v.lang?.startsWith("ko") && /yuna|siri/i.test(v.name)) ||
    voices.find((v) => v.lang?.startsWith("ko")) ||
    null;
  return koVoice;
}
// voices load async in Chrome — warm the cache when they arrive, and flush
// any line that was requested before the list was ready
let pending: string | null = null;
try {
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    koVoice = null;
    if (pickVoice() && pending) {
      const t = pending;
      pending = null;
      speak(t);
    }
  });
} catch { /* no speech support */ }

export function speak(text: string) {
  try {
    if (!sfxEnabled()) return; // the 🔇 toggle silences guidance too
    const synth = window.speechSynthesis;
    if (!synth) return;
    const v = pickVoice();
    // WITHOUT a Korean voice, never speak: a default English voice skips the
    // Hangul and reads only the punctuation aloud ("exclamation point…").
    // Park the line instead — voiceschanged above delivers it if a Korean
    // voice shows up; otherwise the on-screen text carries the flow.
    if (!v) {
      pending = text;
      return;
    }
    pending = null;
    synth.cancel();
    // belt-and-braces: strip punctuation so no engine can ever read it aloud
    const u = new SpeechSynthesisUtterance(text.replace(/[!?~…]/g, ","));
    u.voice = v;
    u.lang = "ko-KR";
    u.rate = 0.95;
    u.pitch = 1.1;
    synth.speak(u);
  } catch { /* stay silent */ }
}
