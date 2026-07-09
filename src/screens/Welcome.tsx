import { useEffect } from "react";
import { speak } from "../lib/tts";

export function Welcome({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    speak("Welcome to Veggie Monster! Ready to play?");
  }, []);

  return (
    <div className="screen welcome">
      <div className="welcome-left">
        <div className="welcome-hero">
          <div className="welcome-emoji">🥦</div>
          <h1>Veggie Monster</h1>
          <p className="welcome-strap">a Monggle Kids experience</p>
          <p className="welcome-tag">Your veggie creation comes to life!</p>
        </div>
        <button className="btn-primary big" onClick={onStart}>Start ▶</button>
      </div>

      <ol className="welcome-steps">
        <li><span className="ws-ico">📷</span> Snap it</li>
        <li><span className="ws-ico">✨</span> Wake it up</li>
        <li><span className="ws-ico">🧩</span> Go questing</li>
        <li><span className="ws-ico">🏅</span> Get your badge</li>
      </ol>
    </div>
  );
}
