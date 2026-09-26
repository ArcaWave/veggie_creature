import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startAutoReload } from "./lib/autoreload";

startAutoReload("/"); // ?autoreload: pick up a new deploy (at an empty booth)

// (no StrictMode: its dev-only double run of every effect asked the matcher twice per photo and made the
// local test kiosk behave differently from the exhibition one — dev and production now run the same flow)
createRoot(document.getElementById("root")!).render(<App />);
