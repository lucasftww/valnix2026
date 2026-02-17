/**
 * API-only data hooks for homepage.
 * These hooks fetch data exclusively via edge functions (no Firebase imports),
 * ensuring Firebase SDK (~300KB) is NOT in the critical rendering path.
 */
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS, UI_CONFIG } from "@/lib/constants";
import { fetchFeaturedProductsFallback, fetchCategoriesFallback } from "@/lib/firestoreFallback";
import type { ProductCardData, Category } from "@/types";

// Deterministic fake stats (same logic as useFirebaseProducts)
const generateConsistentSalesAndReviews = (productId: string) => {
  const hash = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);
  const hash2 = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 3) * 7, 0);
  const baseSold = 800 + (hash % 7200);
  const sold = baseSold + (hash2 % 100);
  const reviewRate = 0.05 + ((hash2 % 13) / 100);
  return { sold, reviewCount: Math.floor(sold * reviewRate) };
};

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

function deduplicateCategories(raw: any[]): Category[] {
  const score = (c: any) => {
    let s = 0;
    if (c?.icon_url) s += 2;
    if (c?.image_url) s += 2;
    if (c?.description) s += 1;
    if (c?.show_on_homepage) s += 1;
    return s;
  };

  const bySlug = new Map<string, any>();
  for (const c of raw) {
    const slug = String(c?.slug ?? c?.id ?? "");
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (!existing) { bySlug.set(slug, c); continue; }
    if (score(c) > score(existing)) bySlug.set(slug, c);
    else if (score(c) === score(existing) && (c?.display_order ?? Infinity) < (existing?.display_order ?? Infinity)) {
      bySlug.set(slug, c);
    }
  }

  return Array.from(bySlug.values())
    .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0)) as Category[];
}

function buildCategoryTree(categories: Category[]): Category[] {
  const categoryMap = new Map<string, Category>();
  const roots: Category[] = [];

  categories.forEach((c) => categoryMap.set(c.id, { ...c, children: [] }));
  categories.forEach((c) => {
    const node = categoryMap.get(c.id)!;
    if (c.parent_id) {
      const parent = categoryMap.get(c.parent_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
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

// ── Home categories ──
export const useHomeCategoriesApi = () => {
  const { data: categories = [], ...rest } = useCategoriesApi();
  return {
    data: categories.filter((cat) => cat.show_on_homepage && !cat.parent_id),
    ...rest,
  };
};
