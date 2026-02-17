import { getDocs, getDocsFromServer, type Query, type QuerySnapshot } from "firebase/firestore";

const QUERY_TIMEOUT_MS = 15000;

/**
 * Resilient Firestore fetch. If cache returns empty, retries from server.
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  const attempt = (fromServer = false): Promise<QuerySnapshot> =>
    Promise.race<QuerySnapshot>([
      fromServer ? getDocsFromServer(q) : getDocs(q),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
      ),
    ]);

  try {
    const snapshot = await attempt(false);
    
    // If cache returned empty, try server to avoid stale empty cache
    if (snapshot.empty && snapshot.metadata.fromCache) {
      console.info("[Firestore] Cache returned empty, retrying from server...");
      try {
        return await attempt(true);
      } catch {
        return snapshot; // server failed, return cache result
      }
    }
    
    return snapshot;
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    const code = (err as any)?.code ?? "";
    const isRetryable =
      msg.includes("FIRESTORE_QUERY_TIMEOUT") ||
      code.includes("unavailable") ||
      code.includes("deadline-exceeded") ||
      code.includes("resource-exhausted") ||
      msg.toLowerCase().includes("network");

    if (isRetryable) {
      await new Promise((r) => setTimeout(r, 1500));
      return attempt(true); // retry directly from server
    }
    throw err;
  }
}
