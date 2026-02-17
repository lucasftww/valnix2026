import { getDocs, type Query, type QuerySnapshot } from "firebase/firestore";

const QUERY_TIMEOUT_MS = 15000; // 15s — generous for cold starts + App Check token

/**
 * Resilient Firestore collection fetch with retry.
 * Single getDocs call (checks persistent cache first automatically) with timeout.
 * Retries once on timeout/network error before giving up.
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  const attempt = (): Promise<QuerySnapshot> =>
    Promise.race<QuerySnapshot>([
      getDocs(q),
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
      msg.toLowerCase().includes("network");

    if (isRetryable) {
      // Wait 1.5s then retry once
      await new Promise((r) => setTimeout(r, 1500));
      return attempt();
    }
    throw err;
  }
}
