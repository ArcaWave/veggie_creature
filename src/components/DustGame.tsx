import { useRef, useState } from "react";
import { pop, sparkle } from "../lib/sfx";

// "Magic dust" mini-game, played WHILE the wake video generates.
// Ingredients float scattered around the pot — tap the ones you like and they
// FLY into the pot. Then tap-tap-tap the pot to grind, and SPRINKLE to give life.
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
const GRIND_TAPS = 8;

export function DustGame({ onSprinkle }: { onSprinkle: (traits: string[]) => void }) {
  const [phase, setPhase] = useState<"pick" | "grind" | "sprinkle">("pick");
  const [picked, setPicked] = useState<Ingredient[]>([]);
  const [flying, setFlying] = useState<Record<string, { dx: number; dy: number }>>({});
  const [grinds, setGrinds] = useState(0);
  const [wob, setWob] = useState(0);
  const potRef = useRef<HTMLDivElement>(null);

  const inFlight = Object.keys(flying).length;
  const chosen = picked.length + inFlight;

  // tap an ingredient -> it flies into the pot
  function tapIngredient(ing: Ingredient, e: React.MouseEvent<HTMLButtonElement>) {
    if (phase !== "pick" || flying[ing.id] || picked.some((p) => p.id === ing.id)) return;
    if (chosen >= PICK_COUNT || !potRef.current) return;
    const ir = e.currentTarget.getBoundingClientRect();
    const pr = potRef.current.getBoundingClientRect();
    const dx = pr.left + pr.width / 2 - (ir.left + ir.width / 2);
    const dy = pr.top + pr.height * 0.3 - (ir.top + ir.height / 2);
    setFlying((f) => ({ ...f, [ing.id]: { dx, dy } }));
    pop();
    setTimeout(() => {
      setFlying((f) => {
        const { [ing.id]: _gone, ...rest } = f;
        return rest;
      });
      setPicked((p) => {
        const next = [...p, ing];
        if (next.length === PICK_COUNT) setTimeout(() => setPhase("grind"), 450);
        return next;
      });
      setWob((w) => w + 1); // pot gulps
    }, 560);
  }

  // tap-tap-tap the pot to grind
  function tapPot() {
    if (phase !== "grind") return;
    setWob((w) => w + 1);
    setGrinds((g) => {
      const n = Math.min(g + 1, GRIND_TAPS);
      if (n === GRIND_TAPS) {
        setPhase("sprinkle");
        sparkle();
      } else {
        pop();
      }
      return n;
    });
  }

  const title =
    phase === "pick"
      ? `✨ Tap your favorites into the pot! (${chosen}/${PICK_COUNT})`
      : phase === "grind"
        ? `🥣 Tap tap tap! Grind it! (${grinds}/${GRIND_TAPS})`
        : "✨ The magic dust is ready!";

  return (
    <div className="potion">
      <p className="potion-title">{title}</p>

      <div className="dust-area">
        {INGREDIENTS.map((ing, i) => {
          if (picked.some((p) => p.id === ing.id)) return null;
          const fly = flying[ing.id];
          return (
            <button
              key={ing.id}
              className={`ing-float f${i + 1} ${fly ? "fly" : ""} ${phase !== "pick" ? "dim" : ""}`}
              style={fly ? ({ "--fx": `${fly.dx}px`, "--fy": `${fly.dy}px` } as React.CSSProperties) : undefined}
              onClick={(e) => tapIngredient(ing, e)}
            >
              <span className="ing-emoji">{ing.emoji}</span>
              <span>{ing.name}</span>
            </button>
          );
        })}

        <div key={wob} className={`bowl pot-bottom ${wob ? "wob" : ""}`} ref={potRef} onPointerDown={tapPot}>
          <div className="bowl-contents">
            {phase === "pick" && <span className="bowl-ings">{picked.map((p) => p.emoji).join(" ")}</span>}
            {phase === "grind" && (
              <>
                <span className="bowl-ings" style={{ opacity: 1 - grinds / GRIND_TAPS }}>
                  {picked.map((p) => p.emoji).join(" ")}
                </span>
                <span className="bowl-dust">{"✨".repeat(Math.min(grinds, 5))}</span>
              </>
            )}
            {phase === "sprinkle" && <span className="bowl-dust glow">✨✨✨✨✨</span>}
          </div>
        </div>
      </div>

      {phase === "sprinkle" && (
        <button className="btn-primary" onClick={() => { sparkle(); onSprinkle(picked.map((p) => p.trait)); }}>
          ✨ Sprinkle the magic dust!
        </button>
      )}
    </div>
  );
}
