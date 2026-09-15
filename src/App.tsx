import { useEffect, useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Build } from "./screens/Build";
import { Staff } from "./screens/Staff";
import { TopBar } from "./components/TopBar";
import { clearProfile, ensureProfile } from "./lib/profile";
import { track } from "./lib/analytics";

// Scan station: welcome -> scan -> the matched creature comes alive, walks off
// the right edge of the screen (into the Digital World / the display PC), and
// the station resets for the next child.
type Stage = "welcome" | "build";

export default function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [staffOpen, setStaffOpen] = useState(false);

  useEffect(() => {
    track("app_open");
  }, []);

  function reset(reason: string) {
    track("session_reset", { reason });
    clearProfile(); // next family starts with a fresh profile
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
            ensureProfile(); // silent session profile keys rate limits & saves
            // kiosk nicety: the start tap doubles as the fullscreen gesture
            document.documentElement.requestFullscreen?.().catch(() => {});
            track("build_start");
            setStage("build");
          }}
        />
      )}

      {stage === "build" && <Build onDone={() => reset("done")} />}
    </div>
  );
}
