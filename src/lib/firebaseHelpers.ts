import { getDocs, getDocsFromServer, type Query, type QuerySnapshot } from "firebase/firestore";
import { appCheckReady } from "@/integrations/firebase/config";

const QUERY_TIMEOUT_MS = 4000; // 4s — fast fail, fallback handles the rest

/**
 * Resilient Firestore fetch.
 * 1. Waits for App Check token to be ready
 * 2. Fetches from server directly (avoids stale cache)
 * 3. NO retry — caller handles fallback
 * 4. Catches losing promise to prevent "Uncaught (in promise)"
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  await appCheckReady;

  const firestorePromise = getDocsFromServer(q);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
  );

  // Prevent "Uncaught (in promise)" for the loser of the race
  firestorePromise.catch(() => {});
  timeoutPromise.catch(() => {});

  return Promise.race<QuerySnapshot>([firestorePromise, timeoutPromise]);
}
