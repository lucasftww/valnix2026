import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/integrations/firebase/config';
import { generateConsistentSalesAndReviews } from './firebase/useFirebaseProducts';

// Categorias principais para prefetch
const MAIN_CATEGORIES = ['valorant', 'roblox'];

/**
 * Hook que pré-carrega produtos das categorias principais
 * Chamado na home para que navegação seja instantânea
 */
export const useCategoryPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Aguarda carregamento inicial (2s) antes de fazer prefetch
    const timeoutId = setTimeout(() => {
      MAIN_CATEGORIES.forEach(async (category) => {
        // Verifica se já tem cache
        const existingData = queryClient.getQueryData(['products-with-reviews', category]);
        if (existingData) return;

        // Prefetch em background
        queryClient.prefetchQuery({
          queryKey: ['products-with-reviews', category],
          queryFn: async () => {
            const productsQuery = query(
              collection(db, 'products'),
              where('category', '==', category)
            );

            const productsSnapshot = await getDocs(productsQuery);

            if (productsSnapshot.empty) return [];

            const products = productsSnapshot.docs
              .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
              .filter((p) => p?.is_active)
              .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0));

            return products.map((product) => {
              const stats = generateConsistentSalesAndReviews(product.id);
              return {
                ...product,
                sold: stats.sold,
                reviewCount: stats.reviewCount,
              };
            });
          },
          staleTime: 30 * 60 * 1000, // 30 min
        });
      });
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [queryClient]);
};
