import { useEffect, useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Build } from "./screens/Build";
import { Staff } from "./screens/Staff";
import { TopBar } from "./components/TopBar";
import { clearProfile, ensureProfile } from "./lib/profile";
import { track } from "./lib/analytics";
import { keepAsset } from "./lib/keep";

// Scan station: welcome -> scan -> the matched creature comes alive, walks off
// the right edge of the screen (into the Digital World / the display PC), and
// the station resets for the next child.
type Stage = "welcome" | "build";

export default function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [photo, setPhoto] = useState(""); // the welcome mirror's own snapshot, when it took one
  const [shownOnly, setShownOnly] = useState(false); // …taken of a creation held up with no person seen
  const [staffOpen, setStaffOpen] = useState(false);

  useEffect(() => {
    track("app_open");
  }, []);

  // the welcome screen sits on the painted key visual; every other screen
  // keeps the plain cream so the camera and results stay the focus (and gets
  // the full width of the 55" TV for the framed camera)
  useEffect(() => {
    document.body.classList.toggle("stage-welcome", stage === "welcome");
    document.body.classList.toggle("stage-build", stage === "build");
  }, [stage]);

  function reset(reason: string) {
    track("session_reset", { reason });
    clearProfile(); // next family starts with a fresh profile
    setStaffOpen(false);
    setPhoto("");
    setStage("welcome");
  }

  // the mirror saw a child showing their creation (photo) — or staff pressed
  // start without a usable camera (no photo: the photo step takes over)
  function begin(snap: string, source: "person" | "object" = "person") {
    ensureProfile(); // silent session profile keys rate limits & saves
    // kiosk nicety: a real tap doubles as the fullscreen gesture (an auto
    // start has no gesture — the ⛶ button covers that once per day)
    document.documentElement.requestFullscreen?.().catch(() => {});
    track("build_start", { auto: !!snap, source });
    if (snap) {
      track("photo_captured", { auto: true });
      keepAsset("original", snap);
    }
    setPhoto(snap);
    setShownOnly(source === "object");
    setStage("build");
  }

  return (
    <div className="app">
      <TopBar onStaff={() => setStaffOpen(true)} />
      {staffOpen && <Staff onClose={() => setStaffOpen(false)} onReset={() => reset("staff")} />}

      {stage === "welcome" && <Welcome onCaptured={begin} onStart={() => begin("")} />}

      {stage === "build" && <Build initialPhoto={photo} shownOnly={shownOnly} onDone={() => reset("done")} />}
    </div>
  );
}
