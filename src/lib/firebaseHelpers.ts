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
 * Strategy: cache-first (instant) → server with timeout → graceful fallback
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  // Layer 1: try local cache only (instant, no network)
  try {
    const fromCache = await withTimeout(getDocsFromCache(q), 2000);
    if (fromCache && fromCache.docs.length > 0) return fromCache;
  } catch {
    // Cache miss — continue
  }

  // Layer 2: default getDocs with tight timeout
  try {
    const result = await withTimeout(getDocs(q), 6000);
    if (result) return result;
  } catch (e) {
    console.warn("[resilientGetDocs] getDocs failed:", (e as any)?.message || e);
  }

  // Layer 3: force server
  try {
    const server = await withTimeout(getDocsFromServer(q), 6000);
    if (server) return server;
  } catch {
    // exhausted
  }

  throw new Error("[resilientGetDocs] All fetch strategies timed out");
}
