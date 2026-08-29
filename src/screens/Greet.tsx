import { useEffect, useState } from "react";
import { MonsterFace } from "../components/MonsterFace";
import { useWaveDetector } from "../lib/motion";
import { prefetchLines, speakLine, stopSpeaking } from "../lib/voice";
import { sparkle, pop } from "../lib/sfx";
import { track } from "../lib/analytics";
import type { Monster } from "../types";

// The greeting experience (replaces the old mission quest for special-needs sessions).
//  hello : the monster waves on a loop, the child is invited to wave back at the tablet.
//          A front-camera motion detector (or the facilitator button) advances the story.
//  talk  : the monster smiles on a loop and speaks a short, warm line sequence
//          (English voice + big captions), then says goodbye.
//  bye   : the monster gently drifts away, then we move on to the photo booth.
type Phase = "hello" | "talk" | "bye";

const LINE_MS = 2800; // how long each spoken line stays on screen

export function Greet({
  monster,
  greetVideo,
  smileVideo,
  onDone,
}: {
  monster: Monster;
  greetVideo: string | null;
  smileVideo: string | null;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("hello");
  const [line, setLine] = useState(0);

  const lines = [
    { text: "Hi! Hello!", emoji: "👋" },
    { text: "So nice to meet you!", emoji: "😊" },
    { text: "Thank you for making me!", emoji: "💛" },
    { text: "Now I'm off to the Digital World!", emoji: "🌏" },
    { text: "See you next time! Bye-bye!", emoji: "👋" },
  ];

  // start the story once the child waves back (motion) or the grown-up taps the button
  function greetBack(source: "wave" | "button") {
    if (phase !== "hello") return;
    track("greet_hello", { source });
    sparkle();
    setPhase("talk");
  }

  const { videoRef, status } = useWaveDetector(phase === "hello", () => greetBack("wave"));

  // warm the Typecast line cache while the child is still waving, and prime the
  // browser-TTS fallback on the first tap (tablet autoplay policies)
  useEffect(() => {
    prefetchLines(lines.map((l) => l.text)); // voice seed defaults to the session profile
    function prime() {
      try {
        window.speechSynthesis?.getVoices();
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointerdown", prime);
    }
    window.addEventListener("pointerdown", prime);
    return () => {
      window.removeEventListener("pointerdown", prime);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dialogue sequence: show + speak each line, then drift away
  useEffect(() => {
    if (phase !== "talk") return;
    let i = 0;
    setLine(0);
    speakLine(lines[0].text);
    const id = setInterval(() => {
      i += 1;
      if (i >= lines.length) {
        clearInterval(id);
        window.setTimeout(() => setPhase("bye"), 1500); // let the last line breathe
        return;
      }
      setLine(i);
      speakLine(lines[i].text);
    }, LINE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // after the goodbye drift, continue to the photo booth
  useEffect(() => {
    if (phase !== "bye") return;
    track("greet_bye");
    const id = window.setTimeout(onDone, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const heroClip = phase === "hello" ? greetVideo ?? smileVideo : smileVideo ?? greetVideo;

  return (
    <div className="screen center-screen greet-screen">
      <div className={`greet-hero ${phase === "bye" ? "leaving" : ""}`}>
        {heroClip ? (
          <div className="greet-frame">
            <video key={heroClip} src={heroClip} className="greet-media" autoPlay loop muted playsInline />
          </div>
        ) : (
          <MonsterFace monster={monster} size={220} interactive={false} />
        )}
      </div>

      {phase === "hello" && (
        <>
          <p className="greet-cue">👋 Wave hello to your new friend!</p>

          {/* small mirrored self-view so the child sees the camera is watching */}
          {status === "watching" && (
            <div className="greet-selfie">
              <video ref={videoRef} autoPlay playsInline muted />
              <span className="greet-selfie-dot" /> I can see you!
            </div>
          )}
          {(status === "denied" || status === "unsupported") && (
            <p className="greet-hint">Camera is off — tap the button when you wave 👇</p>
          )}

          <button
            className="btn-primary big"
            onClick={() => {
              pop();
              greetBack("button");
            }}
          >
            👋 I'm waving!
          </button>
        </>
      )}

      {phase === "talk" && (
        <div className="greet-bubble">
          <span className="greet-bubble-emoji">{lines[line].emoji}</span>
          <span className="greet-bubble-text">{lines[line].text}</span>
        </div>
      )}

      {phase === "bye" && <p className="greet-cue fade">Off to the Digital World! 🌏✨</p>}
    </div>
  );
}
