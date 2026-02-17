import { getDocs, getDocsFromServer, type Query, type QuerySnapshot } from "firebase/firestore";
import { appCheckReady } from "@/integrations/firebase/config";

const QUERY_TIMEOUT_MS = 4000; // 4s — fast fail, fallback handles the rest

/**
 * Resilient Firestore fetch.
 * 1. Waits for App Check token to be ready (prevents "Missing permissions" errors)
 * 2. Fetches from server directly (avoids stale cache issues)
 * 3. NO retry — let the caller handle fallback quickly
 */
export async function resilientGetDocs(q: Query): Promise<QuerySnapshot> {
  // Wait for App Check token before any Firestore query
  await appCheckReady;

  return Promise.race<QuerySnapshot>([
    getDocsFromServer(q),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("FIRESTORE_QUERY_TIMEOUT")), QUERY_TIMEOUT_MS)
    ),
  ]);
}
