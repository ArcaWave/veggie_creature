import { useEffect, useRef, useState } from "react";
import { setSfx, sfxEnabled, pop } from "../lib/sfx";

// Persistent overlay bar: brand placeholder (left) + fullscreen & sound (right).
// Staff access: tap the logo 5 times quickly.
export function TopBar({ onStaff }: { onStaff: () => void }) {
  const [sound, setSound] = useState(sfxEnabled());
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

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
        <img src="/monggle-logo-kr.png" className="brand-logo" alt="Monglekids" />
      </button>
      <button
        className="sound-toggle"
        onClick={() => {
          const next = !sound;
          setSfx(next);
          setSound(next);
          if (next) pop();
        }}
        aria-label="소리 켜기/끄기"
      >
        {sound ? "🔊" : "🔇"}
      </button>
      {/* hidden once fullscreen (exit with ESC) so the kiosk screen stays clean */}
      {!fullscreen && (
        <button
          className="fs-toggle"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          aria-label="전체화면"
          title="전체화면"
        >
          ⛶
        </button>
      )}
    </>
  );
}
