import { useEffect, useRef, useState } from "react";
import { pop, sparkle } from "../lib/sfx";
import { getLandmarker, FINGERTIPS } from "../lib/hands";

// "Magic dust" mini-game, played WHILE the wake video generates.
// CAMERA MODE (MediaPipe, primary): one continuous hand-tracked stage —
//   1) PICK    : ingredients float in the air; the child reaches out and GRABS
//                them (hold a hand over one, or pinch) — they fly into the pot.
//   2) GRIND   : stir circles over the pot (or squeeze a fist) to grind.
//   3) SPRINKLE: dust falls from the fingertips onto the creature until it glows.
// Every gesture is forgiving — dwell counts as a grab, any stirring or squeezing
// counts as grinding — so no precise motion is ever required.
// TAP MODE (fallback, no camera / model failure): the original tap game.
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
const HAND_INIT_TIMEOUT = 8000;

// `canFinish` paces the sprinkle against the Veo generation: while false the
// magic meter tops out at ~88% (keep sprinkling!), and the moment the video is
// ready it fills to 100 — so the reveal lands right on time, with no idle
// "please wait" screen in between.
export function DustGame({
  photo,
  canFinish = true,
  onSprinkle,
}: {
  photo: string;
  canFinish?: boolean;
  onSprinkle: (traits: string[]) => void;
}) {
  const [mode, setMode] = useState<"camera" | "tap">("camera");
  if (mode === "camera") {
    return <HandDustStage photo={photo} canFinish={canFinish} onUnavailable={() => setMode("tap")} onDone={onSprinkle} />;
  }
  return <TapDustGame onSprinkle={onSprinkle} />;
}

// ---- camera mode: one hand-tracked stage for pick -> grind -> sprinkle ------
type Phase = "init" | "pick" | "grind" | "sprinkle";
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number; hue: number };
type ItemState = Ingredient & { fx: number; fy: number; state: "float" | "fly" | "gone" };

// floating spots (fractions of the stage) — kept away from the pot at the bottom
const SPOTS = [
  { fx: 0.14, fy: 0.24 },
  { fx: 0.5, fy: 0.22 },
  { fx: 0.86, fy: 0.24 },
  { fx: 0.1, fy: 0.58 },
  { fx: 0.9, fy: 0.58 },
  { fx: 0.32, fy: 0.4 },
];
const POP_RADIUS = 62; // px — a fingertip inside this pops the floating item

function HandDustStage({
  photo,
  canFinish,
  onUnavailable,
  onDone,
}: {
  photo: string;
  canFinish: boolean;
  onUnavailable: () => void;
  onDone: (traits: string[]) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("init");
  const [items, setItems] = useState<ItemState[]>(INGREDIENTS.map((ing, i) => ({ ...ing, ...SPOTS[i], state: "float" })));
  const [grinds, setGrinds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [handSeen, setHandSeen] = useState(false);
  const [wob, setWob] = useState(0);

  const phaseRef = useRef<Phase>("init");
  phaseRef.current = phase;
  const canFinishRef = useRef(canFinish);
  canFinishRef.current = canFinish;
  const pickedRef = useRef<Ingredient[]>([]);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let particles: Particle[] = [];
    const itemsLive: ItemState[] = INGREDIENTS.map((ing, i) => ({ ...ing, ...SPOTS[i], state: "float" }));
    let lastTs = performance.now();
    let lastSeen = 0;
    let lastPos: { x: number; y: number } | null = null;
    let pokeInside = false; // fingertip currently touching the pot (grind pokes)
    let grindCount = 0;
    let prog = 0;
    let lastPush = 0;

    const bail = window.setTimeout(() => {
      if (!cancelled) cleanup(), onUnavailable();
    }, HAND_INIT_TIMEOUT);

    (async () => {
      try {
        const [landmarker, s] = await Promise.all([
          getLandmarker(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 640 } }, audio: false }),
        ]);
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        window.clearTimeout(bail);
        setPhase("pick");

        const loop = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(loop);
          const stage = stageRef.current;
          const canvas = canvasRef.current;
          if (!stage || !canvas || v.readyState < 2) return;
          const W = (canvas.width = stage.clientWidth);
          const H = (canvas.height = stage.clientHeight);
          const ctx = canvas.getContext("2d")!;
          ctx.clearRect(0, 0, W, H);
          const now = performance.now();
          const dt = Math.min(50, now - lastTs);
          lastTs = now;
          const ph = phaseRef.current;

          const res = landmarker.detectForVideo(v, now);
          const hands = res.landmarks ?? [];
          if (hands.length) lastSeen = now;
          setHandSeen(now - lastSeen < 700);

          // primary hand: palm center + fingertips, mirrored to the preview
          let palm: { x: number; y: number } | null = null;
          let tips: { x: number; y: number }[] = [];
          let speed = 0;
          if (hands.length) {
            const lm = hands[0];
            const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
            const cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
            palm = { x: (1 - cx) * W, y: cy * H };
            tips = FINGERTIPS.map((i) => ({ x: (1 - lm[i].x) * W, y: lm[i].y * H }));
            if (lastPos) speed = Math.hypot(palm.x - lastPos.x, palm.y - lastPos.y) / Math.max(1, dt);
            lastPos = palm;
          } else {
            lastPos = null;
          }

          // hand halo + fingertip dots so the child sees exactly where they touch
          if (palm) {
            ctx.beginPath();
            ctx.arc(palm.x, palm.y, 30, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 214, 102, 0.22)";
            ctx.fill();
            for (const t of tips) {
              ctx.beginPath();
              ctx.arc(t.x, t.y, 7, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(255, 214, 102, 0.9)";
              ctx.fill();
            }
          }

          // ---------- PICK: pop a floating ingredient with a fingertip ----------
          if (ph === "pick" && tips.length) {
            for (const it of itemsLive) {
              if (it.state !== "float") continue;
              const ix = it.fx * W, iy = it.fy * H;
              const touched = tips.some((t) => Math.hypot(t.x - ix, t.y - iy) < POP_RADIUS);
              if (touched) {
                it.state = "fly";
                pickedRef.current = [...pickedRef.current, it];
                pop();
                // pop burst at the item, like a bubble bursting
                for (let k = 0; k < 14; k++) {
                  const a = (Math.PI * 2 * k) / 14;
                  particles.push({
                    x: ix, y: iy,
                    vx: Math.cos(a) * (1.5 + Math.random() * 2), vy: Math.sin(a) * (1.5 + Math.random() * 2) - 0.6,
                    life: 0.8, size: 2.5 + Math.random() * 3, hue: Math.random() < 0.6 ? 48 : 100,
                  });
                }
                setItems(itemsLive.map((x) => ({ ...x })));
                setWob((w) => w + 1);
                window.setTimeout(() => {
                  it.state = "gone";
                  if (!cancelled) setItems(itemsLive.map((x) => ({ ...x })));
                }, 620);
                if (pickedRef.current.length >= PICK_COUNT) {
                  window.setTimeout(() => {
                    if (!cancelled) {
                      sparkle();
                      setPhase("grind");
                    }
                  }, 900);
                }
              }
            }
          }

          // ---------- GRIND: poke-poke the pot with a fingertip ----------
          if (ph === "grind" && tips.length) {
            // pot sits bottom-center (see .hs-pot); generous hit circle for little hands
            const px = W / 2, py = H - 75, R = 130;
            const inside = tips.some((t) => Math.hypot(t.x - px, t.y - py) < R);
            if (inside && !pokeInside && grindCount < GRIND_TAPS) {
              grindCount += 1;
              pop();
              setGrinds(grindCount);
              setWob((w) => w + 1);
              // a little grind puff out of the pot with every poke
              for (let k = 0; k < 10; k++) {
                particles.push({
                  x: px + (Math.random() - 0.5) * 90, y: py - 40,
                  vx: (Math.random() - 0.5) * 2.2, vy: -1.2 - Math.random() * 1.6,
                  life: 0.7, size: 2.5 + Math.random() * 3, hue: Math.random() < 0.7 ? 48 : 100,
                });
              }
              if (grindCount >= GRIND_TAPS) {
                sparkle();
                window.setTimeout(() => !cancelled && setPhase("sprinkle"), 700);
              }
            }
            pokeInside = inside; // must pull the finger out and poke again
          }

          // ---------- SPRINKLE: dust streams from the fingertips onto the creature ----------
          // (the magic-dust moment right before the animation reveal — always flowing
          // while a hand is visible, pouring when it moves)
          if (ph === "sprinkle" && tips.length) {
            const rate = speed > 0.1 ? 4 : 1.4;
            for (const t of tips) {
              if (Math.random() < rate / FINGERTIPS.length) {
                particles.push({
                  x: t.x, y: t.y,
                  vx: (Math.random() - 0.5) * 1.6, vy: 0.5 + Math.random() * 1.3,
                  life: 1, size: 3 + Math.random() * 4,
                  hue: Math.random() < 0.7 ? 48 : 100,
                });
              }
            }
          }

          // ---------- shared particle pass ----------
          // while the Veo clips are still cooking, the meter holds just short of
          // full — the child keeps sprinkling until the magic is truly ready
          const cap = canFinishRef.current ? 100 : 88;
          if (ph === "sprinkle" && canFinishRef.current && prog >= 87) {
            prog = Math.min(100, prog + 0.4); // video ready: the last stretch fills itself
          }
          const ccx = W / 2, ccy = H / 2, R = Math.min(W, H) * 0.26;
          particles = particles.filter((p) => {
            p.vy += 0.05;
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.008;
            if (ph === "sprinkle" && !doneRef.current && Math.hypot(p.x - ccx, p.y - ccy) < R) {
              prog = Math.min(cap, prog + 0.55);
              return false;
            }
            if (p.life <= 0 || p.y > H + 20) return false;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = `hsl(${p.hue} 95% 65%)`;
            ctx.shadowColor = `hsl(${p.hue} 95% 75%)`;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            return true;
          });
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;

          if (now - lastPush > 100) {
            lastPush = now;
            setProgress(prog);
          }
          if (prog >= 100 && !doneRef.current) {
            doneRef.current = true;
            sparkle();
            window.setTimeout(() => !cancelled && onDone(pickedRef.current.map((p) => p.trait)), 700);
          }
        };
        raf = requestAnimationFrame(loop);
      } catch {
        if (!cancelled) {
          window.clearTimeout(bail);
          cleanup();
          onUnavailable();
        }
      }
    })();

    function cleanup() {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) v.srcObject = null;
    }

    return () => {
      cancelled = true;
      window.clearTimeout(bail);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked = items.filter((i) => i.state !== "float");
  const title =
    phase === "init"
      ? "✨ Getting the magic ready…"
      : phase === "pick"
        ? `👉 Pop your favorites with a finger! (${picked.length}/${PICK_COUNT})`
        : phase === "grind"
          ? `🥣 Poke poke! Grind it! (${grinds}/${GRIND_TAPS})`
          : !canFinish && progress >= 80
            ? "✨ Keep sprinkling… the magic is almost ready!"
            : "✨ Sprinkle the dust on your creature!";

  const glow = progress / 100;
  return (
    <div className="potion">
      <p className="potion-title">{title}</p>
      <div className="hs-wrap">
        <div className="hs-stage" ref={stageRef}>
          <video ref={videoRef} className="hs-cam" autoPlay playsInline muted />

          {/* floating ingredients (pick) — grabbed ones dive into the pot */}
          {phase === "pick" &&
            items.map((it) =>
              it.state === "gone" ? null : (
                <div
                  key={it.id}
                  className={`hs-item ${it.state === "fly" ? "hs-item-fly" : ""}`}
                  style={{ left: `${it.fx * 100}%`, top: `${it.fy * 100}%` }}
                >
                  <span className="ing-emoji">{it.emoji}</span>
                  <span>{it.name}</span>
                </div>
              )
            )}

          {/* the pot (pick + grind) */}
          {(phase === "pick" || phase === "grind") && (
            <div key={wob} className={`bowl pot-bottom hs-pot ${wob ? "wob" : ""}`}>
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
              </div>
            </div>
          )}

          {/* the creature being brought to life (sprinkle) */}
          {phase === "sprinkle" && (
            <div
              className="hs-creature"
              style={{
                filter: `saturate(${0.55 + glow * 0.65}) brightness(${1 + glow * 0.45})`,
                boxShadow: `0 0 ${8 + glow * 60}px ${glow * 26}px rgba(255, 214, 102, ${0.12 + glow * 0.55})`,
              }}
            >
              <img src={photo} alt="" />
            </div>
          )}

          <canvas ref={canvasRef} className="hs-canvas" />

          {phase !== "init" && !handSeen && <p className="hs-hint">✋ Show your hand to the camera!</p>}
        </div>

        {phase === "sprinkle" && (
          <div className="dust">
            <span className="dust-label">✨ Magic</span>
            <div className="dust-bar"><div className="dust-fill" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- tap mode: the original touch game (fallback when the camera can't run) ----
function TapDustGame({ onSprinkle }: { onSprinkle: (traits: string[]) => void }) {
  const [phase, setPhase] = useState<"pick" | "grind" | "sprinkle">("pick");
  const [picked, setPicked] = useState<Ingredient[]>([]);
  const [flying, setFlying] = useState<Record<string, { dx: number; dy: number }>>({});
  const [grinds, setGrinds] = useState(0);
  const [wob, setWob] = useState(0);
  const potRef = useRef<HTMLDivElement>(null);

  const inFlight = Object.keys(flying).length;
  const chosen = picked.length + inFlight;

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
      setWob((w) => w + 1);
    }, 560);
  }

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
