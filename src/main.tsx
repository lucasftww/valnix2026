// Bootstrap scripts (token strip, UTM detection, FB Pixel, UTMify loader)
// Must run before React to capture URL params early
import "./bootstrap";

// Pre-warm API data before React hydrates (saves ~500ms on LCP chain)
// This starts network requests immediately so data is ready when useQuery fires
import { fetchFeaturedProductsFallback, fetchCategoriesFallback } from "@/lib/firestoreFallback";
fetchFeaturedProductsFallback();
fetchCategoriesFallback();

import { createRoot } from "react-dom/client";

// Defer ALL font weights — use system font until loaded
// This eliminates render-blocking font CSS from the critical path
requestAnimationFrame(() => {
  import("@fontsource/poppins/400.css");
  import("@fontsource/poppins/600.css");
  import("@fontsource/poppins/700.css");
  setTimeout(() => import("@fontsource/poppins/500.css"), 200);
});

import App from "./App.tsx";
import "./index.css";

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
