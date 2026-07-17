import { useState } from "react";

// Scattered-polaroid collage on the right. Drop the real photos into
// public/welcome/ as step1.jpg .. step4.jpg — until then a pastel emoji
// placeholder shows. Photos drop in one by one from the top; each caption is a
// handwritten doodle whose pig-tail arrow points AT its photo.
type Dir = "ur" | "ul" | "dr" | "dl"; // arrow tip direction: up/down + right/left

const STEPS: { img: string; emoji: string; caption: string; dir: Dir; svgFirst: boolean }[] = [
  // s1: caption above the photo → arrow points down-right into it
  { img: "/welcome/step1.jpg", emoji: "📷", caption: "Snap it!", dir: "dr", svgFirst: false },
  // s2: caption below the photo, arrow on the left end → points up-right into it
  { img: "/welcome/step2.jpg", emoji: "✨", caption: "Wake it up!", dir: "ur", svgFirst: true },
  // s3: caption below the photo → up-right into it
  { img: "/welcome/step3.jpg", emoji: "🧩", caption: "Quest together!", dir: "ur", svgFirst: true },
  // s4: caption below the photo, arrow on the right end → points up-left into it
  { img: "/welcome/step4.jpg", emoji: "🏅", caption: "Win your badge!", dir: "ul", svgFirst: false },
];

export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen welcome">
      <div className="welcome-left">
        <div className="welcome-hero">
          <img src="/veggie-creature-logo.png" className="welcome-logo" alt="Veggie Creature" />
          <p className="welcome-strap">a Monglekids experience</p>
          <p className="welcome-tag">Your veggie creation comes to life!</p>
        </div>
        <button className="btn-primary big" onClick={onStart}>Start ▶</button>
      </div>

      <div className="collage">
        {STEPS.map((s, i) => (
          <div key={i} className={`snapshot s${i + 1}`} style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
            <div className="polaroid">
              <Photo src={s.img} emoji={s.emoji} />
            </div>
            <div className="doodle">
              {s.svgFirst && <PigTail dir={s.dir} />}
              <span>{s.caption}</span>
              {!s.svgFirst && <PigTail dir={s.dir} />}
            </div>
          </div>
        ))}
        <p className="collage-tagline">Snap, Wake, Quest &amp; Win!</p>
      </div>
    </div>
  );
}

function Photo({ src, emoji }: { src: string; emoji: string }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img src={src} alt="" className="photo" onError={() => setOk(false)} />
  ) : (
    <div className="photo photo-ph">{emoji}</div>
  );
}

// curly pig-tail squiggle; base art points up-right, `dir` mirrors it
function PigTail({ dir }: { dir: Dir }) {
  return (
    <svg viewBox="0 0 64 40" className={`pigtail ${dir}`} aria-hidden="true">
      <path
        d="M6 34 C 14 32, 20 22, 28 20 C 38 17, 43 25, 36 28 C 29 31, 27 20, 37 14 L 50 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M50 8 l-7 -0.5 M50 8 l-2.5 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
