import { useEffect, useState } from "react";

// Loading celebration overlay — PLACEHOLDER visuals.
// Floating sparkles + a rotating message. Swap the emoji/art and copy freely;
// keep the absolute-overlay position (it covers the image/video frame it sits in).
export function SparkleLoading({ messages, sub }: { messages: string[]; sub?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % messages.length), 2400);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <div className="sparkle-overlay">
      {["✨", "⭐", "✨", "🌟", "✨", "💫"].map((s, k) => (
        <span key={k} className="sparkle" style={{ left: `${10 + k * 15}%`, animationDelay: `${k * 0.45}s` }}>
          {s}
        </span>
      ))}
      <span className="spin" />
      <span className="sparkle-msg">{messages[i]}</span>
      {sub && <span className="sparkle-sub">{sub}</span>}
    </div>
  );
}
