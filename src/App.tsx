import { useEffect, useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Build } from "./screens/Build";
import { Greet } from "./screens/Greet";
import { PhotoBooth } from "./screens/PhotoBooth";
import { Certificate } from "./screens/Certificate";
import { Staff } from "./screens/Staff";
import { TopBar } from "./components/TopBar";
import { clearProfile, ensureProfile } from "./lib/profile";
import { track } from "./lib/analytics";
import type { Monster, MonsterVideos } from "./types";

type Stage = "welcome" | "build" | "greet" | "booth" | "certificate";

export default function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [monster, setMonster] = useState<Monster | null>(null);
  const [videos, setVideos] = useState<MonsterVideos>({ greet: null, smile: null });
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
    setVideos({ greet: null, smile: null });
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
            setVideos(v);
            setOriginalPhoto(original || null);
            setStage("greet");
          }}
        />
      )}

      {stage === "greet" && monster && (
        <Greet
          monster={monster}
          greetVideo={videos.greet}
          smileVideo={videos.smile}
          onDone={() => {
            setStars(3);
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
          video={videos.smile ?? videos.greet}
          originalPhoto={originalPhoto}
          profilePhoto={boothPhoto}
          stars={stars}
          onRestart={() => reset("done")}
        />
      )}
    </div>
  );
}
