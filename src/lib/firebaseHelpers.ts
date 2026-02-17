import { getDocsFromServer, type Query, type QuerySnapshot } from "firebase/firestore";

const QUERY_TIMEOUT_MS = 4000; // 4s — fast fail, fallback handles the rest

/**
 * Resilient Firestore fetch.
 * 1. Fetches from server directly (avoids stale cache)
 * 2. NO retry — caller handles fallback
 * 3. Catches losing promise to prevent "Uncaught (in promise)"
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  const firestorePromise = getDocsFromServer(q);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
  );

  // Prevent "Uncaught (in promise)" for the loser of the race
  firestorePromise.catch(() => {});
  timeoutPromise.catch(() => {});

  return Promise.race<QuerySnapshot>([firestorePromise, timeoutPromise]);
}
