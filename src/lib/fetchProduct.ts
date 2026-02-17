import { doc, getDocFromServer, type DocumentSnapshot } from "firebase/firestore";
import { db, appCheckReady } from "@/integrations/firebase/config";
import type { Product } from "@/types";
import type { FirebaseError } from "firebase/app";

const TIMEOUT_MS = 15000; // 15s — generous for cold starts + App Check

/** Determine if a fetch error is retryable (timeout, network, quota) */
export const shouldRetryProductFetch = (error: unknown): boolean => {
  const msg = (error as Error)?.message ?? "";
  const code = (error as FirebaseError & { code?: string })?.code ?? "";

  if (msg.includes("PRODUCT_FETCH_TIMEOUT")) return true;
  return (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("resource-exhausted") ||
    msg.toLowerCase().includes("network")
  );
};

/** Log timeout with productId for observability */
export const logFetchTimeout = (productId: string, error: unknown) => {
  if ((error as Error)?.message?.includes("PRODUCT_FETCH_TIMEOUT")) {
    console.warn("Product fetch timeout", { productId });
  }
};

/**
 * Shared product fetcher used by both useProductById hook and ProductCard prefetch.
 * - Single getDoc call (persistent cache checks local first, then network)
 * - Timeout throws error (not null) so caller can distinguish timeout vs not-found
 * - Retries once on timeout/network error
 * - Returns null for genuinely non-existent or inactive products
 */
export async function fetchProduct(productId: string): Promise<Product | null> {
  // Wait for App Check token before querying
  await appCheckReady;
  
  const ref = doc(db, "products", productId);

  const attempt = (): Promise<DocumentSnapshot> =>
    Promise.race<DocumentSnapshot>([
      getDocFromServer(ref),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PRODUCT_FETCH_TIMEOUT")), TIMEOUT_MS)
      ),
    ]);

  let snap: DocumentSnapshot;
  try {
    snap = await attempt();
  } catch (err) {
    // Retry once on timeout/network
    if (shouldRetryProductFetch(err)) {
      await new Promise((r) => setTimeout(r, 1500));
      snap = await attempt();
    } else {
      throw err;
    }
  }

  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data?.is_active) return null;
  return { id: snap.id, ...data } as Product;
}
