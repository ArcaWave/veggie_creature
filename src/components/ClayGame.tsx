import { useRef, useState } from "react";
import { pop, sparkle } from "../lib/sfx";

// Clay-kneading mini-game, played WHILE the photo->clay AI runs in the background.
// The child squishes the photo itself — poking and rubbing leave finger dents and
// the photo gradually turns soft and clay-like. The AI progress bar sits on top.
const SQUISHES_NEEDED = 10;

type Dent = { x: number; y: number; id: number };

export function ClayGame({
  photo,
  progress, // background AI progress (0-100) shown in the top bar
  onDone,
}: {
  photo: string;
  progress: number;
  onDone: () => void;
}) {
  const [squishes, setSquishes] = useState(0);
  const [dents, setDents] = useState<Dent[]>([]);
  const [wob, setWob] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dist = useRef(0);
  const done = squishes >= SQUISHES_NEEDED;

  function squishAt(clientX: number, clientY: number) {
    if (done || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 100;
    const y = ((clientY - r.top) / r.height) * 100;
    setDents((d) => [...d.slice(-24), { x, y, id: Date.now() + Math.random() }]);
    setWob((w) => w + 1);
    setSquishes((s) => {
      const n = Math.min(s + 1, SQUISHES_NEEDED);
      if (n === SQUISHES_NEEDED) {
        sparkle();
        setTimeout(onDone, 600);
      } else {
        pop();
      }
      return n;
    });
  }

  const p = squishes / SQUISHES_NEEDED;

  return (
    <div className="clay-game">
      <div className="clay-bar">
        <div className="clay-bar-fill" style={{ width: `${progress}%` }} />
        <span>✨ Clay magic…</span>
      </div>

      <p className="potion-title">
        {done ? "✨ So squishy!" : `👆 Tap tap! Squish it into clay! (${squishes}/${SQUISHES_NEEDED})`}
      </p>

      <div
        ref={stageRef}
        className="clay-stage"
        onPointerDown={(e) => {
          down.current = true;
          last.current = { x: e.clientX, y: e.clientY };
          dist.current = 0;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          squishAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!down.current || !last.current) return;
          dist.current += Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y);
          last.current = { x: e.clientX, y: e.clientY };
          if (dist.current > 90) {
            dist.current = 0;
            squishAt(e.clientX, e.clientY); // rubbing counts too
          }
        }}
        onPointerUp={() => {
          down.current = false;
          last.current = null;
        }}
      >
        <div key={wob} className={`clay-wobble ${wob ? "wob" : ""}`}>
          <img
            src={photo}
            alt=""
            className="clay-img"
            draggable={false}
            style={{
              filter: `saturate(${1 + p * 0.5}) contrast(${1 + p * 0.08}) blur(${p * 1.4}px)`,
              borderRadius: `${12 + p * 28}px`,
            }}
          />
        </div>
        {dents.map((d) => (
          <span key={d.id} className="dent" style={{ left: `${d.x}%`, top: `${d.y}%` }} />
        ))}
        {squishes === 0 && (
          <div className="tap-guide" aria-hidden="true">
            <span className="tap-ring" />
            👆
          </div>
        )}
      </div>
    </div>
  );
}
