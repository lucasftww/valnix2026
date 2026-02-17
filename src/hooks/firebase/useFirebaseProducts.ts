import { useQuery } from "@tanstack/react-query";
import { collection, query, where, limit } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS, CACHE_TIMES, UI_CONFIG } from "@/lib/constants";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import { fetchFeaturedProductsFallback, fetchCategoryProductsFallback } from "@/lib/firestoreFallback";
import { isBlockedByAdBlocker, markFirestorePossiblyBlocked } from "@/lib/firestoreBlockDetect";
import type { ProductCardData, ProductWithReviews } from "@/types";

const generateConsistentSalesAndReviews = (productId: string): { sold: number; reviewCount: number } => {
  const hash = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);
  const hash2 = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 3) * 7, 0);
  const baseSold = 800 + (hash % 7200);
  const soldVariation = hash2 % 100;
  const sold = baseSold + soldVariation;
  const reviewRate = 0.05 + ((hash2 % 13) / 100);
  const reviewCount = Math.floor(sold * reviewRate);
  return { sold, reviewCount };
};

export { generateConsistentSalesAndReviews };

// isBlockedByAdBlocker and markFirestorePossiblyBlocked are now imported from @/lib/firestoreBlockDetect

function mapToProductCard(p: any): ProductCardData {
  const stats = generateConsistentSalesAndReviews(p.id);
  return {
    id: p.id,
    name: p.name,
    image_url: p.image_url,
    icon_url: p.icon_url,
    price: p.price,
    old_price: p.old_price,
    discount: p.discount,
    category: p.category,
    sold: stats.sold,
    reviewCount: stats.reviewCount,
  };
}

// Hook para produtos em destaque (home)
export const useFeaturedProducts = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.BEST_SELLING],
    queryFn: async (): Promise<ProductCardData[]> => {
      // Race: Firestore vs API fallback — both start immediately
      // .catch(() => null) on each prevents "Uncaught (in promise)" for the loser
      let firestoreResult: ProductCardData[] | null = null;
      let apiResult: ProductCardData[] | null = null;

      const firestoreFetch = (async () => {
        const productsQuery = query(
          collection(db, "products"),
          where("featured", "==", true),
          limit(50)
        );
        const productsSnapshot = await resilientGetDocs(productsQuery);
        if (import.meta.env.DEV) console.log(`[Products] Firestore returned ${productsSnapshot.size} featured docs`);
        return productsSnapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((p) => p?.is_active)
          .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
          .slice(0, UI_CONFIG.FEATURED_PRODUCTS_LIMIT)
          .map(mapToProductCard);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const products = await fetchFeaturedProductsFallback();
        return products
          .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .slice(0, UI_CONFIG.FEATURED_PRODUCTS_LIMIT)
          .map(mapToProductCard);
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      // Wait for the first non-null result
      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first && first.length > 0) return first;

      // If winner returned null/empty, wait for the other
      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult && firestoreResult.length > 0) return firestoreResult;
      if (apiResult && apiResult.length > 0) return apiResult;
      return [];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: 2000,
  });
};

// Helper to map raw product to ProductWithReviews
function mapToProductWithReviews(p: any): ProductWithReviews {
  const stats = generateConsistentSalesAndReviews(p.id);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    image_url: p.image_url,
    icon_url: p.icon_url,
    price: p.price,
    old_price: p.old_price,
    discount: p.discount,
    category: p.category,
    is_active: p.is_active,
    featured: p.featured,
    display_order: p.display_order,
    created_at: p.created_at,
    updated_at: p.updated_at,
    stock: p.stock,
    sold: stats.sold,
    delivery_info: p.delivery_info,
    delivery_type: p.delivery_type,
    auto_delivery_codes: null,
    instructions: p.instructions,
    terms_conditions: p.terms_conditions,
    rich_description: p.rich_description,
    video_url: p.video_url,
    product_type: p.product_type,
    is_featured_in_category: p.is_featured_in_category,
    offer_hash: p.offer_hash,
    reviewCount: stats.reviewCount,
  } as ProductWithReviews;
}

// Hook para produtos de uma categoria
export const useCategoryProducts = (categorySlug: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORY_PRODUCTS, categorySlug],
    queryFn: async (): Promise<ProductWithReviews[]> => {
      if (!categorySlug) return [];

      let firestoreResult: ProductWithReviews[] | null = null;
      let apiResult: ProductWithReviews[] | null = null;

      const firestoreFetch = (async () => {
        const productsQuery = query(
          collection(db, "products"),
          where("category", "==", categorySlug)
        );
        const productsSnapshot = await resilientGetDocs(productsQuery);
        return productsSnapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((p) => p?.is_active)
          .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
          .map(mapToProductWithReviews);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const products = await fetchCategoryProductsFallback(categorySlug!);
        return products
          .filter((p: any) => p?.is_active)
          .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map(mapToProductWithReviews);
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first && first.length > 0) return first;

      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult && firestoreResult.length > 0) return firestoreResult;
      if (apiResult && apiResult.length > 0) return apiResult;
      return [];
    },
    enabled: !!categorySlug,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

// Hook para detalhes de um produto — uses shared fetchProduct with API fallback
export const useProduct = (productId: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.PRODUCT, productId],
    queryFn: async () => {
      if (!productId) return null;

      let firestoreResult: any = undefined;
      let apiResult: any = undefined;

      const firestoreFetch = (async () => {
        const { fetchProduct } = await import("@/lib/fetchProduct");
        return await fetchProduct(productId);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const { fetchProductFallback } = await import("@/lib/firestoreFallback");
        return await fetchProductFallback(productId);
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first) return first;

      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult) return firestoreResult;
      if (apiResult) return apiResult;
      return null;
    },
    enabled: !!productId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 2000,
  });
};
