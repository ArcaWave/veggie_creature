import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startAutoReload } from "./lib/autoreload";

startAutoReload("/"); // ?autoreload: pick up a new deploy (at an empty booth)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
