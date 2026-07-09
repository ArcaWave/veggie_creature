import { useRef, useState } from "react";
import { setTts, ttsEnabled } from "../lib/tts";

// Persistent overlay bar: brand placeholder (left) + sound toggle (right).
// Staff access: tap the logo 5 times quickly.
export function TopBar({ onStaff }: { onStaff: () => void }) {
  const [sound, setSound] = useState(ttsEnabled());
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
      <button className="brand" onClick={brandTap} aria-label="Monggle Kids">
        {/* LOGO PLACEHOLDER — replace the box below with the real logo image */}
        <span className="brand-logo">LOGO</span>
        <span className="brand-name">Monggle Kids</span>
      </button>
      <button
        className="sound-toggle"
        onClick={() => {
          setTts(!sound);
          setSound(!sound);
        }}
        aria-label="Toggle sound"
      >
        {sound ? "🔊" : "🔇"}
      </button>
    </>
  );
}
