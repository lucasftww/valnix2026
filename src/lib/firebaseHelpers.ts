import { getDocs, getDocsFromServer, type Query, type QuerySnapshot } from "firebase/firestore";
import { appCheckReady } from "@/integrations/firebase/config";

const QUERY_TIMEOUT_MS = 15000;

/**
 * Resilient Firestore fetch.
 * 1. Waits for App Check token to be ready (prevents "Missing permissions" errors)
 * 2. Fetches from server directly (avoids stale cache issues)
 * 3. Retries once on timeout/network errors
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  // Wait for App Check token before any Firestore query
  await appCheckReady;

  const attempt = (): Promise<QuerySnapshot> =>
    Promise.race<QuerySnapshot>([
      getDocsFromServer(q),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
      ),
    ]);

  try {
    return await attempt();
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    const code = (err as any)?.code ?? "";
    const isRetryable =
      msg.includes("FIRESTORE_QUERY_TIMEOUT") ||
      code.includes("unavailable") ||
      code.includes("deadline-exceeded") ||
      code.includes("resource-exhausted") ||
      msg.toLowerCase().includes("network") ||
      msg.toLowerCase().includes("permission");

    if (isRetryable) {
      console.info("[Firestore] Retrying query after error:", msg || code);
      await new Promise((r) => setTimeout(r, 2000));
      return attempt();
    }
    throw err;
  }
}
