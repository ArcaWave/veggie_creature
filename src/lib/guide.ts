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
// voices load async in Chrome — warm the cache when they arrive
try {
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => { koVoice = null; pickVoice(); });
} catch { /* no speech support */ }

export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = "ko-KR";
    u.rate = 0.95;
    u.pitch = 1.1;
    synth.speak(u);
  } catch { /* stay silent */ }
}
