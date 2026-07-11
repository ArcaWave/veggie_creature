export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen welcome">
      <div className="welcome-left">
        <div className="welcome-hero">
          <img src="/veggie-creature-logo.png" className="welcome-logo" alt="Veggie Creature" />
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
