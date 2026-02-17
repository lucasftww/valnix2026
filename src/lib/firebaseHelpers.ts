import { getDocs, getDocsFromServer, type Query } from "firebase/firestore";

/**
 * Resilient Firestore fetch: tries server first, falls back to local cache if offline.
 * Prevents stale/corrupt IndexedDB cache from returning empty results.
 */
export async function resilientGetDocs(q: Query) {
  try {
    return await getDocsFromServer(q);
  } catch {
    return await getDocs(q);
  }
}
