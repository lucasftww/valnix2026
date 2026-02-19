/**
 * API-only data hooks for homepage.
 * These hooks fetch data exclusively via edge functions (no Firebase imports),
 * ensuring Firebase SDK (~300KB) is NOT in the critical rendering path.
 */
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS, UI_CONFIG } from "@/lib/constants";
import { fetchFeaturedProductsFallback, fetchCategoriesFallback } from "@/lib/firestoreFallback";
import { generateConsistentSalesAndReviews } from "@/lib/productUtils";
import { deduplicateCategories, buildCategoryTree } from "@/lib/categoryUtils";
import type { ProductCardData, Category } from "@/types";

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

// ── Featured products (homepage) ──
export const useFeaturedProductsApi = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.BEST_SELLING],
    queryFn: async (): Promise<ProductCardData[]> => {
      const products = await fetchFeaturedProductsFallback();
      return products
        .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .slice(0, UI_CONFIG.FEATURED_PRODUCTS_LIMIT)
        .map(mapToProductCard);
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

// ── Categories (flat list) ──
export const useCategoriesApi = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORIES],
    queryFn: async (): Promise<Category[]> => {
      const raw = await fetchCategoriesFallback();
      return deduplicateCategories(raw.filter((c: any) => c?.is_active));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// ── Categories tree (for navigation) ──
export const useCategoriesTreeApi = () => {
  const { data: categories = [], ...rest } = useCategoriesApi();
  return { data: buildCategoryTree(categories), ...rest };
};
