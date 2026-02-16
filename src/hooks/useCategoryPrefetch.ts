import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/integrations/firebase/config';
import { generateConsistentSalesAndReviews } from './firebase/useFirebaseProducts';
import { QUERY_KEYS } from '@/lib/constants';

/**
 * Hook que pré-carrega categorias e produtos em background
 * Chamado na home para que navegação seja instantânea
 */
export const useCategoryPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch categories first (needed for sidebar + navigation)
    const prefetchCategories = async () => {
      const existingCategories = queryClient.getQueryData([QUERY_KEYS.CATEGORIES]);
      if (existingCategories) return (existingCategories as any[]);

      const snapshot = await getDocs(collection(db, 'categories'));
      const categories = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((c) => c?.is_active)
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0));

      // Set cache for categories
      queryClient.setQueryData([QUERY_KEYS.CATEGORIES], categories);

      // Also cache each category by slug for instant category page loads
      categories.forEach((cat) => {
        if (cat.slug) {
          queryClient.setQueryData(['category', cat.slug], {
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || null,
            image_url: cat.image_url || null,
            icon_url: cat.icon_url || null,
            parent_id: cat.parent_id || null,
            is_active: cat.is_active,
            display_order: cat.display_order,
            show_on_homepage: cat.show_on_homepage || null,
          });
        }
      });

      return categories;
    };

    const prefetchProducts = async (categorySlugs: string[]) => {
      // Prefetch products for each category in parallel
      await Promise.all(
        categorySlugs.map(async (slug) => {
          const existingData = queryClient.getQueryData(['products-with-reviews', slug]);
          if (existingData) return;

          try {
            const productsQuery = query(
              collection(db, 'products'),
              where('category', '==', slug)
            );

            const productsSnapshot = await getDocs(productsQuery);
            if (productsSnapshot.empty) return;

            const products = productsSnapshot.docs
              .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
              .filter((p) => p?.is_active)
              .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
              .map((product) => {
                const stats = generateConsistentSalesAndReviews(product.id);
                return { ...product, sold: stats.sold, reviewCount: stats.reviewCount };
              });

            queryClient.setQueryData(['products-with-reviews', slug], products);
          } catch (err) {
            // Silent fail - prefetch is best-effort
          }
        })
      );
    };

    // Start prefetch sooner (500ms instead of 2s)
    const timeoutId = setTimeout(async () => {
      try {
        const categories = await prefetchCategories();
        // Get all category slugs to prefetch products for ALL categories
        const slugs = (categories || [])
          .filter((c: any) => c?.slug)
          .map((c: any) => c.slug);
        
        if (slugs.length > 0) {
          await prefetchProducts(slugs);
        }
      } catch (err) {
        // Silent fail
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [queryClient]);
};
