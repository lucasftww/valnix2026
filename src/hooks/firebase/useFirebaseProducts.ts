import { useQuery } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS } from "@/lib/constants";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import { fetchCategoryProductsFallback } from "@/lib/firestoreFallback";
import { markFirestorePossiblyBlocked } from "@/lib/firestoreBlockDetect";
import { generateConsistentSalesAndReviews } from "@/lib/productUtils";
import type { ProductCardData, ProductWithReviews } from "@/types";

// Re-export for consumers that still import from here
export { generateConsistentSalesAndReviews } from "@/lib/productUtils";

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

      // Wait for at least one to finish. If it's valid, return it.
      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first && first.length > 0) return first;

      // If we're here, first was null or empty. Wait for both to settle to get the fallback.
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
