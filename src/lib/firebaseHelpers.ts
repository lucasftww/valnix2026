import { getDocs, getDocsFromServer, type Query } from "firebase/firestore";

/**
 * Resilient Firestore fetch: tries cache first (fast), then server if cache is empty.
 * This handles both:
 * - Corrupted/empty IndexedDB cache → falls through to server
 * - App Check enforcement blocking server calls → uses cache
 */
export async function resilientGetDocs(q: Query) {
  try {
    // Try cache first (instant, works even if App Check blocks server)
    const cached = await getDocs(q);
    if (cached.docs.length > 0) return cached;
    
    // Cache empty — might be corrupted, try server directly
    return await getDocsFromServer(q);
  } catch {
    // Server also failed — return whatever cache had (even if empty)
    return await getDocs(q);
  }
}
