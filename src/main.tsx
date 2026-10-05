import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startAutoReload } from "./lib/autoreload";

// ?research: the experiment's console and stimulus check (src/research) — loaded only then. (The experiment
// itself runs inside the kiosk.)
const Research = lazy(() => import("./research"));
const research = new URLSearchParams(location.search).has("research");

if (!research) startAutoReload("/"); // ?autoreload: pick up a new deploy (at an empty booth)

// (no StrictMode: its dev-only double run of every effect asked the matcher twice per photo and made the
// local test kiosk behave differently from the exhibition one — dev and production now run the same flow)
createRoot(document.getElementById("root")!).render(research ? <Suspense fallback={null}><Research /></Suspense> : <App />);
