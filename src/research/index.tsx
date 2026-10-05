// The suggestiveness experiment's extra screens (docs/RESEARCH.md), loaded only with ?research — the experiment
// itself runs inside the ordinary kiosk (lib/experiment.ts, the "살아났다!" scene in screens/Build.tsx).
//   /?research=console   the researchers' console
//   /?research=demo      the stimulus check (the six clips + the matching table)
import "./research.css";
import { Console } from "./Console";
import { Demo } from "./Demo";

export default function Research() {
  return new URLSearchParams(location.search).get("research") === "demo" ? <Demo /> : <Console />;
}
