import { useState } from "react";
import { MISSIONS, type Mission, type SolutionPath } from "../data/missions";
import { MonsterFace } from "../components/MonsterFace";
import { pop, sparkle } from "../lib/sfx";
import { track } from "../lib/analytics";
import type { Monster } from "../types";

export function Quest({
  monster,
  video,
  onClear,
}: {
  monster: Monster;
  video: string | null;
  onClear: (stars: number) => void;
}) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [win, setWin] = useState<SolutionPath | null>(null);

  // 1) pick a quest (the child chooses — self-direction)
  if (!mission) {
    return (
      <div className="screen">
        <header className="topbar">
          <h1>🧩 Pick your quest!</h1>
        </header>
        <div className="quest-pick">
          {MISSIONS.map((m) => (
            <button
              key={m.id}
              className="quest-card"
              onClick={() => {
                pop();
                track("quest_pick", { mission: m.id });
                setMission(m);
              }}
            >
              <span className="quest-emoji">{m.emoji}</span>
              <span className="quest-title">{m.title}</span>
              <span className="quest-tag">{m.tagline}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const story = (s: string) => s.split("{name}").join(monster.name);

  // 3) win
  if (win) {
    return (
      <div className="screen center-screen">
        <div className="win">
          <MonsterFace monster={monster} video={video ?? undefined} size={150} />
          <h2>You did it!</h2>
          <p className="win-story">{story(win.success)}</p>
          <div className="win-stars">⭐⭐⭐</div>
          <button
            className="btn-primary big"
            onClick={() => {
              track("quest_win", { mission: mission.id, path: win.id });
              onClear(3);
            }}
          >
            📸 Photo time! →
          </button>
        </div>
      </div>
    );
  }

  // 2) choose an idea (all ideas work — divergent thinking)
  return (
    <div className="screen">
      <header className="topbar">
        <h1>{mission.emoji} {mission.title}</h1>
      </header>

      <div className="with-monster">
        <MonsterFace monster={monster} video={video ?? undefined} size={64} interactive={false} />
        <div>
          <strong>{monster.name}</strong>
          <div className="muted ready">is ready to help!</div>
        </div>
      </div>

      <div className="prompt-box">{mission.prompt}</div>

      <div className="paths">
        {mission.paths.map((p) => (
          <button
            key={p.id}
            className="path"
            onClick={() => {
              sparkle();
              setWin(p);
            }}
          >
            <span className="path-emoji">{p.emoji}</span>
            <span className="path-body">
              <span className="path-label">{p.label}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="retry-note">Every idea works — pick YOUR favorite! 🌱</p>
    </div>
  );
}
