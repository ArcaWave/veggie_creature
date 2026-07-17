import { useEffect, useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Build } from "./screens/Build";
import { Quest } from "./screens/Quest";
import { PhotoBooth } from "./screens/PhotoBooth";
import { Certificate } from "./screens/Certificate";
import { Staff } from "./screens/Staff";
import { TopBar } from "./components/TopBar";
import { clearProfile, ensureProfile } from "./lib/profile";
import { track } from "./lib/analytics";
import type { Monster } from "./types";

type Stage = "welcome" | "build" | "quest" | "booth" | "certificate";

export default function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [monster, setMonster] = useState<Monster | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<string | null>(null);
  const [boothPhoto, setBoothPhoto] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [staffOpen, setStaffOpen] = useState(false);

  useEffect(() => {
    track("app_open");
  }, []);

  function reset(reason: string) {
    track("session_reset", { reason });
    clearProfile(); // next family starts with a fresh profile
    setMonster(null);
    setVideo(null);
    setOriginalPhoto(null);
    setBoothPhoto(null);
    setStars(0);
    setStaffOpen(false);
    setStage("welcome");
  }

  return (
    <div className="app">
      <TopBar onStaff={() => setStaffOpen(true)} />
      {staffOpen && <Staff onClose={() => setStaffOpen(false)} onReset={() => reset("staff")} />}

      {stage === "welcome" && (
        <Welcome
          onStart={() => {
            ensureProfile(); // silent session profile; details arrive at "Email me!"
            track("build_start");
            setStage("build");
          }}
        />
      )}

      {stage === "build" && (
        <Build
          onDone={(m, v, original) => {
            setMonster(m);
            setVideo(v);
            setOriginalPhoto(original || null);
            setStage("quest");
          }}
        />
      )}

      {stage === "quest" && monster && (
        <Quest
          monster={monster}
          video={video}
          onClear={(s) => {
            setStars(s);
            setStage("booth");
          }}
        />
      )}

      {stage === "booth" && monster && (
        <PhotoBooth
          monster={monster}
          onDone={(photo) => {
            setBoothPhoto(photo);
            setStage("certificate");
          }}
        />
      )}

      {stage === "certificate" && monster && (
        <Certificate
          monster={monster}
          video={video}
          originalPhoto={originalPhoto}
          profilePhoto={boothPhoto}
          stars={stars}
          onRestart={() => reset("done")}
        />
      )}
    </div>
  );
}
