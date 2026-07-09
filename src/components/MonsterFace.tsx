import { useState } from "react";
import type { Monster } from "../types";

// Monster face.
// - If a "wake" video is given, it loops inside the round frame (truly alive).
// - Otherwise the photo + procedural motion (breathe / blink / eyes) + tap-to-hop.
export function MonsterFace({
  monster,
  size = 120,
  interactive = true,
  video,
}: {
  monster: Pick<Monster, "photo" | "eyes">;
  size?: number;
  interactive?: boolean;
  video?: string;
}) {
  const [hop, setHop] = useState(false);

  return (
    <div
      className={`face-wrap${hop ? " hop" : ""}`}
      style={{ width: size, height: size }}
      onClick={interactive ? () => setHop(true) : undefined}
      onAnimationEnd={() => setHop(false)}
    >
      <div className="face" style={{ width: size, height: size }}>
        {video ? (
          <video src={video} className="face-photo" autoPlay loop muted playsInline />
        ) : monster.photo ? (
          <img src={monster.photo} alt="" className="face-photo" />
        ) : (
          <div className="face-placeholder">🌱</div>
        )}
        {!video &&
          monster.eyes.map((e, i) => (
            <span
              key={i}
              className="mface-eye"
              style={{
                left: `${e.x * 100}%`,
                top: `${e.y * 100}%`,
                width: size * 0.24,
                height: size * 0.24,
              }}
            >
              <span className="mface-ball" style={{ animationDelay: `${i * 0.15}s` }}>
                <span className="mface-pupil" />
              </span>
            </span>
          ))}
      </div>
    </div>
  );
}
