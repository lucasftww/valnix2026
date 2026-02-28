// Bootstrap scripts (token strip, UTM detection, FB Pixel, UTMify loader)
// Deferred to avoid blocking FCP — URL params are captured async
const loadBootstrap = () => import("./bootstrap");
if ('requestIdleCallback' in window) {
  requestIdleCallback(loadBootstrap);
} else {
  setTimeout(loadBootstrap, 50);
}

// Pre-warm handled by inline <script> in index.html (starts before JS bundle parses).
// These calls reuse the global __API_PREFETCH_* promises — zero extra network requests.
// They also seed React Query cache so useQuery gets instant data.
import { fetchFeaturedProductsFallback, fetchCategoriesFallback } from "@/lib/firestoreFallback";
fetchFeaturedProductsFallback();
fetchCategoriesFallback();

import { createRoot } from "react-dom/client";

// Defer ALL fonts to prevent CLS (font-display:swap causes layout shift)
// System font renders immediately; Poppins loads in background for next paint
const loadFonts = () => {
  import("@fontsource/poppins/400.css");
  import("@fontsource/poppins/500.css");
  import("@fontsource/poppins/600.css");
  import("@fontsource/poppins/700.css");
};
if ('requestIdleCallback' in window) {
  requestIdleCallback(loadFonts);
} else {
  setTimeout(loadFonts, 100);
}

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
