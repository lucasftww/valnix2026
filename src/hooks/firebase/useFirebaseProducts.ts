import { useQuery } from "@tanstack/react-query";
import { collection, query, where, limit } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS, CACHE_TIMES, UI_CONFIG } from "@/lib/constants";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
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


// Hook para produtos em destaque (home)
export const useFeaturedProducts = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.BEST_SELLING],
    queryFn: async (): Promise<ProductCardData[]> => {
      const productsQuery = query(
        collection(db, "products"),
        where("featured", "==", true),
        limit(50)
      );

      const productsSnapshot = await resilientGetDocs(productsQuery);

      const featuredActive = productsSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((p) => p?.is_active)
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
        .slice(0, UI_CONFIG.FEATURED_PRODUCTS_LIMIT);

      return featuredActive.map((p) => {
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
      });
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });
};

// Hook para produtos de uma categoria
export const useCategoryProducts = (categorySlug: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORY_PRODUCTS, categorySlug],
    queryFn: async (): Promise<ProductWithReviews[]> => {
      if (!categorySlug) return [];
      
      const productsQuery = query(
        collection(db, "products"),
        where("category", "==", categorySlug)
      );

      const productsSnapshot = await resilientGetDocs(productsQuery);

      return productsSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((p) => p?.is_active)
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
        .map((p) => {
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
        });
    },
    enabled: !!categorySlug,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

// Hook para detalhes de um produto — uses shared fetchProduct
export const useProduct = (productId: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.PRODUCT, productId],
    queryFn: async () => {
      if (!productId) return null;
      const { fetchProduct } = await import("@/lib/fetchProduct");
      return fetchProduct(productId);
    },
    enabled: !!productId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false;
      const msg = (error as Error)?.message ?? "";
      const code = (error as any)?.code ?? "";
      if (msg.includes("PRODUCT_FETCH_TIMEOUT")) return true;
      return code.includes("unavailable") || code.includes("deadline-exceeded") || msg.toLowerCase().includes("network");
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
};
