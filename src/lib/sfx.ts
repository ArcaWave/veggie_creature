// Tiny synthesized sound effects (Web Audio) — no audio files needed.
// pop()     : a cute "뿅" blip for taps / selections / captures
// sparkle() : a rising 3-note twinkle for reveals / wins
// To swap in real recorded sounds later: keep calling pop()/sparkle(), but
// replace the bodies with `new Audio('/sfx/pop.mp3').play()`.
const KEY = "mk.sfx.v1";
let enabled = localStorage.getItem(KEY) !== "off";
let ctx: AudioContext | null = null;

export const sfxEnabled = () => enabled;

export function setSfx(on: boolean) {
  enabled = on;
  localStorage.setItem(KEY, on ? "on" : "off");
}

function ac(): AudioContext | null {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(a: AudioContext, at: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.8);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// "뿅" — quick rising blip
export function pop() {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  blip(a, a.currentTime, 440, 900, 0.16, 0.22, "sine");
}

// rising twinkle for happy reveals
export function sparkle() {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  [660, 880, 1174].forEach((f, i) => blip(a, t + i * 0.09, f, f * 1.05, 0.22, 0.18, "triangle"));
}
