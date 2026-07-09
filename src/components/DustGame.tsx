import { useRef, useState } from "react";
import { speak } from "../lib/tts";

// "Magic dust" mini-game, played WHILE the wake video generates.
// gather 3 ingredients -> grind them into dust (circular motion) -> SPRINKLE to give life.
// The reveal is held until the sprinkle — the dust is what "causes" the magic.
type Ingredient = { id: string; emoji: string; name: string; trait: string };

const INGREDIENTS: Ingredient[] = [
  { id: "bubbles", emoji: "🫧", name: "Giggle Bubbles", trait: "Giggly" },
  { id: "sun", emoji: "☀️", name: "Sunshine Drop", trait: "Sunny" },
  { id: "spark", emoji: "⚡", name: "Zoomy Spark", trait: "Zoomy" },
  { id: "moon", emoji: "🌙", name: "Moon Dust", trait: "Dreamy" },
  { id: "berry", emoji: "🍓", name: "Berry Boom", trait: "Sweet" },
  { id: "wind", emoji: "🌪️", name: "Whirly Wind", trait: "Wiggly" },
];

const PICK_COUNT = 3;
const GRINDS_NEEDED = 5;

export function DustGame({ onSprinkle }: { onSprinkle: (traits: string[]) => void }) {
  const [phase, setPhase] = useState<"pick" | "grind" | "sprinkle">("pick");
  const [picked, setPicked] = useState<Ingredient[]>([]);
  const [grinds, setGrinds] = useState(0);

  const bowlRef = useRef<HTMLDivElement>(null);
  const lastAngle = useRef<number | null>(null);
  const accum = useRef(0);
  const grinding = useRef(false);

  function toggle(ing: Ingredient) {
    const has = picked.some((p) => p.id === ing.id);
    if (has) {
      setPicked(picked.filter((p) => p.id !== ing.id));
      return;
    }
    if (picked.length >= PICK_COUNT) return;
    const next = [...picked, ing];
    setPicked(next);
    speak(ing.name + "!");
    if (next.length === PICK_COUNT) {
      setTimeout(() => {
        setPhase("grind");
        speak("Now grind them into magic dust! Draw circles!");
      }, 500);
    }
  }

  function angleAt(e: React.PointerEvent): number | null {
    const el = bowlRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  function onBowlMove(e: React.PointerEvent) {
    if (!grinding.current || phase !== "grind") return;
    const a = angleAt(e);
    if (a === null) return;
    if (lastAngle.current !== null) {
      let d = a - lastAngle.current;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      accum.current += Math.abs(d);
      if (accum.current >= Math.PI * 2) {
        accum.current -= Math.PI * 2;
        setGrinds((g) => {
          const n = Math.min(g + 1, GRINDS_NEEDED);
          if (n === GRINDS_NEEDED) {
            setPhase("sprinkle");
            speak("The magic dust is ready! Sprinkle it!");
          } else {
            speak("Grind!");
          }
          return n;
        });
      }
    }
    lastAngle.current = a;
  }

  return (
    <div className="potion">
      {phase === "pick" && (
        <>
          <p className="potion-title">✨ Gather {PICK_COUNT} things for the magic dust!</p>
          <div className="ing-grid">
            {INGREDIENTS.map((ing) => {
              const on = picked.some((p) => p.id === ing.id);
              return (
                <button key={ing.id} className={`ing ${on ? "on" : ""}`} onClick={() => toggle(ing)}>
                  <span className="ing-emoji">{ing.emoji}</span>
                  <span>{ing.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {phase !== "pick" && (
        <>
          <p className="potion-title">
            {phase === "grind" ? `🥣 Grind into dust! Draw circles! (${grinds}/${GRINDS_NEEDED})` : "✨ The magic dust is ready!"}
          </p>
          <div
            ref={bowlRef}
            className="bowl"
            onPointerDown={(e) => {
              grinding.current = true;
              lastAngle.current = angleAt(e);
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={onBowlMove}
            onPointerUp={() => {
              grinding.current = false;
              lastAngle.current = null;
            }}
          >
            <div className="bowl-contents">
              {grinds < GRINDS_NEEDED ? (
                <>
                  <span className="bowl-ings" style={{ opacity: 1 - grinds / GRINDS_NEEDED }}>
                    {picked.map((p) => p.emoji).join(" ")}
                  </span>
                  <span className="bowl-dust">{"✨".repeat(grinds)}</span>
                </>
              ) : (
                <span className="bowl-dust glow">✨✨✨✨✨</span>
              )}
            </div>
          </div>
          {phase === "sprinkle" && (
            <button className="btn-primary" onClick={() => onSprinkle(picked.map((p) => p.trait))}>
              ✨ Sprinkle the magic dust!
            </button>
          )}
        </>
      )}
    </div>
  );
}
