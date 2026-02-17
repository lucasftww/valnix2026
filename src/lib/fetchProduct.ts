import { doc, getDoc, type DocumentSnapshot } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import type { Product } from "@/types";
import type { FirebaseError } from "firebase/app";

const TIMEOUT_MS = 8000;

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

/**
 * Shared product fetcher used by both useProductById hook and ProductCard prefetch.
 * - Single getDoc call (persistent cache checks local first, then network)
 * - Timeout throws error (not null) so caller can distinguish timeout vs not-found
 * - Returns null for genuinely non-existent or inactive products
 */
export async function fetchProduct(productId: string): Promise<Product | null> {
  const ref = doc(db, "products", productId);

  const snap = await Promise.race<DocumentSnapshot>([
    getDoc(ref),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PRODUCT_FETCH_TIMEOUT")), TIMEOUT_MS)
    ),
  ]);

  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data?.is_active) return null;
  return { id: snap.id, ...data } as Product;
}
