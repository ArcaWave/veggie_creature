import confetti from "canvas-confetti";

// Magic-dust reveal burst (canvas-confetti). Fired at the moment a creature
// "comes to life": layered waves of gold stars, white glitter and leafy flecks
// swirl out from the reveal frame, then shimmer down like settling dust.
// Respects prefers-reduced-motion (the library skips itself entirely).
const GOLD = ["#ffd166", "#ffe29a", "#f9c74f"];
const SPARK = ["#ffffff", "#fdfff5", "#eaf6d9"];
const LEAF = ["#7cc242", "#b5e48c"];

// Where to erupt from: the centre of the given element (viewport-relative 0~1),
// falling back to just above screen-centre.
function originOf(el?: HTMLElement | null) {
  if (!el) return { x: 0.5, y: 0.42 };
  const r = el.getBoundingClientRect();
  return {
    x: (r.left + r.width / 2) / window.innerWidth,
    y: (r.top + r.height / 2) / window.innerHeight,
  };
}

const base = {
  disableForReducedMotion: true,
  zIndex: 60, // above cards, below the staff modal (backdrop z-index 100)
};

// The big "it's alive!" moment.
export function magicDustBurst(el?: HTMLElement | null) {
  const origin = originOf(el);

  // 1) gold star eruption
  confetti({
    ...base,
    origin,
    particleCount: 55,
    spread: 100,
    startVelocity: 38,
    gravity: 0.9,
    scalar: 1.25,
    ticks: 190,
    shapes: ["star"],
    colors: GOLD,
  });
  // 2) fine white glitter, all directions, drifting
  confetti({
    ...base,
    origin,
    particleCount: 70,
    spread: 360,
    startVelocity: 22,
    gravity: 0.55,
    scalar: 0.65,
    ticks: 240,
    drift: 0.6,
    shapes: ["circle"],
    colors: SPARK,
  });
  // 3) a beat later: leafy flecks ring out
  window.setTimeout(() => {
    confetti({
      ...base,
      origin,
      particleCount: 40,
      spread: 140,
      startVelocity: 28,
      gravity: 0.8,
      scalar: 0.9,
      ticks: 200,
      shapes: ["circle", "star"],
      colors: LEAF,
    });
  }, 260);
  // 4) settling shimmer from above the frame — dust falling around the creature
  window.setTimeout(() => {
    confetti({
      ...base,
      origin: { x: origin.x, y: Math.max(0, origin.y - 0.18) },
      particleCount: 45,
      spread: 70,
      startVelocity: 9,
      gravity: 0.35,
      scalar: 0.55,
      ticks: 320,
      drift: -0.4,
      shapes: ["circle"],
      colors: [...SPARK, ...GOLD],
    });
  }, 520);
}

// Smaller twinkle for secondary reveals (e.g. the clay ta-da).
export function sparkleBurst(el?: HTMLElement | null) {
  const origin = originOf(el);
  confetti({
    ...base,
    origin,
    particleCount: 35,
    spread: 90,
    startVelocity: 26,
    gravity: 0.8,
    scalar: 0.8,
    ticks: 170,
    shapes: ["star", "circle"],
    colors: [...GOLD, ...SPARK],
  });
}
