// Bootstrap scripts (token strip, UTM detection, FB Pixel, UTMify loader)
// Must run before React to capture URL params early
import "./bootstrap";

import { createRoot } from "react-dom/client";

// Critical font weight only — others loaded after paint
import "@fontsource/poppins/400.css";

import App from "./App.tsx";
import "./index.css";

// Defer non-critical font weights after first paint
requestAnimationFrame(() => {
  import("@fontsource/poppins/600.css");
  import("@fontsource/poppins/700.css");
  setTimeout(() => import("@fontsource/poppins/500.css"), 100);
});

// Auto-reload on chunk load failures (stale cache after deploy)
window.addEventListener("error", (e) => {
  if (
    e.message?.includes("Failed to fetch dynamically imported module") ||
    e.message?.includes("Importing a module script failed")
  ) {
    const reloaded = sessionStorage.getItem("chunk-reload");
    if (!reloaded) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || String(e.reason);
  if (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed")
  ) {
    const reloaded = sessionStorage.getItem("chunk-reload");
    if (!reloaded) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
  }
});

createRoot(document.getElementById("root")!).render(<App />);
