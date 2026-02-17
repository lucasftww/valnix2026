import { getDocs, getDocsFromServer, getDocsFromCache, type Query, type QuerySnapshot } from "firebase/firestore";

/** Race a promise against a timeout. Resolves to null on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Resilient Firestore fetch with timeout protection.
 * App Check can cause getDocs to hang indefinitely if the reCAPTCHA token
 * cannot be obtained. This wrapper ensures we never block the UI forever.
 *
 * Strategy:
 * 1. Try local cache first (instant, no network, no App Check needed)
 * 2. Try default getDocs with timeout (uses cache or server)
 * 3. If everything fails/times out, return whatever we have
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  // Layer 1: try local cache only (no network, no App Check)
  try {
    const fromCache = await withTimeout(getDocsFromCache(q), 3000);
    if (fromCache && fromCache.docs.length > 0) return fromCache;
  } catch {
    // Cache miss or not available — continue
  }

  // Layer 2: default getDocs with timeout (may use server + App Check)
  try {
    const result = await withTimeout(getDocs(q), 8000);
    if (result && result.docs.length > 0) return result;
    if (result) return result; // even if empty, it's a valid response from server
  } catch (e) {
    console.warn("[resilientGetDocs] getDocs failed:", (e as any)?.message || e);
  }

  // Layer 3: force server with timeout
  try {
    const server = await withTimeout(getDocsFromServer(q), 8000);
    if (server) return server;
  } catch (e) {
    console.warn("[resilientGetDocs] server fallback failed:", (e as any)?.message || e);
  }

  // Final: return empty-like result via one last cache attempt or throw-safe getDocs
  try {
    const last = await withTimeout(getDocs(q), 5000);
    if (last) return last;
  } catch { /* exhausted all options */ }

  // Absolute fallback: throw so react-query can retry
  throw new Error("[resilientGetDocs] All fetch strategies failed or timed out");
}
