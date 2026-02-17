import { getDocs, getDocsFromServer, type Query } from "firebase/firestore";

/**
 * Resilient Firestore fetch with multiple fallback layers:
 * 1. Try default getDocs (uses cache if available, otherwise server)
 * 2. If cache returns empty, try server directly
 * 3. If everything fails, return empty result gracefully
 */
export async function resilientGetDocs(q: Query) {
  // Layer 1: default SDK behavior (cache-aware)
  const cached = await getDocs(q).catch(() => null);
  if (cached && cached.docs.length > 0) return cached;

  // Layer 2: force server (bypasses stale/empty cache)
  try {
    const server = await getDocsFromServer(q);
    if (server.docs.length > 0) return server;
  } catch (e) {
    // Server failed (offline, App Check, quota, etc.)
    console.warn("[resilientGetDocs] server fallback failed:", (e as any)?.message || e);
  }

  // Layer 3: return whatever we got (even if empty)
  if (cached) return cached;

  // Final fallback: one more try with default
  return await getDocs(q);
}
