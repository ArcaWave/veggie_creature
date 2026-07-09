// Basic TTS via the Web Speech API.
// To replace with real recorded voices later: keep calling speak(text) the same way,
// but swap the implementation to look up an audio file by the text (or add a key param)
// and play it with new Audio(url).
const KEY = "mk.tts.v1";
let enabled = localStorage.getItem(KEY) !== "off";

export const ttsEnabled = () => enabled;

export function setTts(on: boolean) {
  enabled = on;
  localStorage.setItem(KEY, on ? "on" : "off");
  if (!on) stop();
}

export function speak(text: string) {
  if (!enabled) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1.15;
    speechSynthesis.speak(u);
  } catch {
    /* no speech support — silent */
  }
}

export function stop() {
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
