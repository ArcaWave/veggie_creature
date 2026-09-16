import { useEffect, useState } from "react";
import { Build } from "./screens/Build";
import { Staff } from "./screens/Staff";
import { TopBar } from "./components/TopBar";
import { clearProfile } from "./lib/profile";
import { track } from "./lib/analytics";

// Scan station — an always-on "magic mirror": the live camera sits in the
// middle of a cinematic courtyard, a child stepping up with their creation
// starts the show by itself (no buttons), the matched creature comes alive,
// walks off into the Digital World (the display PC), and the mirror is
// ready for the next child. Build stays mounted the whole day so the camera
// never restarts between visitors.
export default function App() {
  const [staffOpen, setStaffOpen] = useState(false);

  useEffect(() => {
    track("app_open");
  }, []);

  return (
    <div className="app">
      <TopBar onStaff={() => setStaffOpen(true)} />
      {staffOpen && <Staff onClose={() => setStaffOpen(false)} onReset={() => { track("session_reset", { reason: "staff" }); clearProfile(); setStaffOpen(false); }} />}
      <Build
        onDone={() => {
          track("session_reset", { reason: "done" });
          clearProfile(); // next family starts with a fresh profile
        }}
      />
    </div>
  );
}
