/**
 * Route prefetch helpers, isolated from App.tsx so that
 * CartContext/CartSidebar (called from many places) don't have to pull the
 * entire App module just to warm up the Checkout chunk.
 *
 * Previously this was exported from App.tsx, which made CartContext do
 * `import("@/App")` — a circular dependency that defeated Vite's
 * code-splitting (App was both the static root AND a lazy chunk).
 */
export const prefetchCheckout = (): void => {
  // Fire-and-forget dynamic import — vite hashes the chunk; subsequent
  // navigations to /checkout are instant.
  void import("@/pages/Checkout");
};
