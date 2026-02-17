import { useQuery } from "@tanstack/react-query";
import { collection, query, where, limit, getDocsFromServer } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS, CACHE_TIMES, UI_CONFIG } from "@/lib/constants";
import type { ProductCardData, ProductWithReviews } from "@/types";

// Função utilitária para gerar VENDAS e AVALIAÇÕES consistentes baseadas no ID do produto
// Vendas são SEMPRE maiores que avaliações (realista: nem todo mundo avalia)
// Taxa de avaliação: entre 5% e 20% das vendas viram avaliações
const generateConsistentSalesAndReviews = (productId: string): { sold: number; reviewCount: number } => {
  // Hash do ID para gerar números pseudo-aleatórios mas consistentes
  const hash = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);
  const hash2 = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 3) * 7, 0);
  
  // Vendas: entre 800 e 8000 (números realistas)
  const baseSold = 800 + (hash % 7200);
  // Adiciona variação para parecer mais natural (ex: 2.303, 1.847)
  const soldVariation = hash2 % 100;
  const sold = baseSold + soldVariation;
  
  // Taxa de avaliação: entre 5% e 18% das vendas (realista)
  const reviewRate = 0.05 + ((hash2 % 13) / 100); // 5% a 18%
  const reviewCount = Math.floor(sold * reviewRate);
  
  return { sold, reviewCount };
};

// Export para uso em outros lugares
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

      // Always fetch from server to avoid stale/corrupted IndexedDB cache
      const productsSnapshot = await getDocsFromServer(productsQuery);

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

      const productsSnapshot = await getDocsFromServer(productsQuery);

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
            auto_delivery_codes: null, // 🔒 SECURITY: codes are in secure server-only collection
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

// Hook para detalhes de um produto
export const useProduct = (productId: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.PRODUCT, productId],
    queryFn: async () => {
      if (!productId) return null;
      
      const { doc: docRef, getDocFromServer } = await import("firebase/firestore");
      const productDoc = await getDocFromServer(docRef(db, "products", productId));
      
      if (!productDoc.exists()) return null;
      
      const data = productDoc.data();
      if (!data.is_active) return null;
      
      return {
        id: productDoc.id,
        ...data
      };
    },
    enabled: !!productId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};
