// Bootstrap scripts (token strip, UTM detection, FB Pixel, UTMify loader)
// Must run before React to capture URL params early — lightweight sync ops
import "./bootstrap";

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { fetchFeaturedProductsFallback, fetchCategoriesFallback } from "@/lib/publicData";
import { queryClient } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/constants";
import { buildFeaturedProductCards, buildCategoriesList } from "@/hooks/useApiData";

// Defer ALL fonts to prevent CLS (font-display:swap causes layout shift)
const loadFonts = () => {
  import("@fontsource/poppins/400.css");
  import("@fontsource/poppins/500.css");
  import("@fontsource/poppins/600.css");
  import("@fontsource/poppins/700.css");
};
if ("requestIdleCallback" in window) {
  requestIdleCallback(loadFonts);
} else {
  setTimeout(loadFonts, 100);
}

// Auto-reload on chunk load failures (stale cache after deploy)
const handleChunkError = (msg: string) => {
  if (
    msg?.includes("Failed to fetch dynamically imported module") ||
    msg?.includes("Importing a module script failed")
  ) {
    const reloaded = sessionStorage.getItem("chunk-reload");
    if (!reloaded) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
  }
};
window.addEventListener("error", (e) => handleChunkError(e.message));
window.addEventListener("unhandledrejection", (e) => handleChunkError(e.reason?.message || String(e.reason)));

/** Max wait for featured + categories cache before first paint (cold network). */
const HYDRATE_BUDGET_MS = 480;

async function boot() {
  const hydrate = Promise.all([
    fetchFeaturedProductsFallback().then((featured) => {
      queryClient.setQueryData([QUERY_KEYS.BEST_SELLING], buildFeaturedProductCards(featured));
    }),
    fetchCategoriesFallback().then((categories) => {
      queryClient.setQueryData([QUERY_KEYS.CATEGORIES], buildCategoriesList(categories));
    }),
  ]).catch(() => {});

  await Promise.race([
    hydrate,
    new Promise<void>((resolve) => setTimeout(resolve, HYDRATE_BUDGET_MS)),
  ]);

  createRoot(document.getElementById("root")!).render(<App />);
}

void boot();
