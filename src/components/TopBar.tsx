import { useRef, useState } from "react";
import { setSfx, sfxEnabled, pop } from "../lib/sfx";

// Persistent overlay bar: brand placeholder (left) + sound toggle (right).
// Staff access: tap the logo 5 times quickly.
export function TopBar({ onStaff }: { onStaff: () => void }) {
  const [sound, setSound] = useState(sfxEnabled());
  const taps = useRef<number[]>([]);

  function brandTap() {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      onStaff();
    }
  }

  return (
    <>
      <button className="brand" onClick={brandTap} aria-label="Monglekids">
        <img src="/monggle-logo.png" className="brand-logo" alt="Monglekids" />
      </button>
      <button
        className="sound-toggle"
        onClick={() => {
          const next = !sound;
          setSfx(next);
          setSound(next);
          if (next) pop();
        }}
        aria-label="Toggle sound"
      >
        {sound ? "🔊" : "🔇"}
      </button>
    </>
  );
}
