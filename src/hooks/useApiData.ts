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

function mapToProductCard(p: Record<string, unknown>): ProductCardData {
  const id = String(p.id ?? "");
  const stats = generateConsistentSalesAndReviews(id);
  return {
    id,
    name: String(p.name ?? ""),
    image_url: typeof p.image_url === "string" ? p.image_url : "",
    icon_url: typeof p.icon_url === "string" ? p.icon_url : undefined,
    price: Number(p.price ?? 0),
    old_price: typeof p.old_price === "number" ? p.old_price : undefined,
    discount: typeof p.discount === "number" ? p.discount : undefined,
    category: typeof p.category === "string" ? p.category : undefined,
    sold: stats.sold,
    reviewCount: stats.reviewCount,
  };
}

/** Same mapping as homepage query — used to hydrate React Query before first paint. */
export function buildFeaturedProductCards(raw: unknown[]): ProductCardData[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))
    .slice(0, UI_CONFIG.FEATURED_PRODUCTS_LIMIT)
    .map(mapToProductCard);
}

/** Hydrate cache — matches useCategoriesApi queryFn output. */
export function buildCategoriesList(raw: unknown[]): Category[] {
  if (!Array.isArray(raw)) return [];
  return deduplicateCategories(raw.filter((c: { is_active?: boolean }) => c?.is_active));
}

// ── Featured products (homepage) ──
export const useFeaturedProductsApi = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.BEST_SELLING],
    queryFn: async (): Promise<ProductCardData[]> => {
      const products = await fetchFeaturedProductsFallback();
      return buildFeaturedProductCards(products);
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
      return buildCategoriesList(raw);
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
