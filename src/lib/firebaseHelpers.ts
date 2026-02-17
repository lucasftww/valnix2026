import { getDocs, type Query, type QuerySnapshot } from "firebase/firestore";

const QUERY_TIMEOUT_MS = 8000;

/**
 * Resilient Firestore collection fetch.
 * Single getDocs call (checks persistent cache first automatically) with timeout.
 * Throws on timeout so callers (React Query) can retry.
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  const result = await Promise.race<QuerySnapshot>([
    getDocs(q),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
    ),
  ]);

  return result;
}
