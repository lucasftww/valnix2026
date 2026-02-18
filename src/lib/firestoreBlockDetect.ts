/**
 * Centralized helper to detect ad-blocker / network-level Firestore blocks.
 * Sets a global flag that AdBlockDetector reads passively.
 *
 * Only marks as "blocked" for errors that look like network interference:
 *   - code "unavailable" (common with DNS/adblock interception)
 *   - code "deadline-exceeded" (network timeout)
 *   - TypeError with fetch/network message (XHR blocked by extension)
 *
 * Does NOT mark for:
 *   - "permission-denied" (Firestore rules / RLS)
 *   - "resource-exhausted" (rate limit)
 *   - "failed-precondition" (offline persistence issue)
 */
export function markFirestorePossiblyBlocked(err: unknown): void {
  const code = (err as any)?.code ?? (err as any)?.name ?? "";

  const networkish = code === "unavailable" || code === "deadline-exceeded";

  const typeErrorNetwork =
    err instanceof TypeError &&
    /fetch|network/i.test(String((err as Error)?.message ?? ""));

  if (networkish || typeErrorNetwork) {
    (window as any).__valnix_firestore_blocked = true;
  }
}
