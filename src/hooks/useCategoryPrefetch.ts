import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';

/**
 * Hook that ensures category data is warm in the React Query cache.
 * Instead of making its own Firestore call, it relies on the shared
 * useCategories hook (triggered by Header) and just seeds per-slug
 * cache entries once that data arrives.
 */
export const useCategoryPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Wait for the shared categories query to resolve (triggered by Header/Navigation)
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event?.type === 'updated' &&
        event.query.queryKey[0] === QUERY_KEYS.CATEGORIES &&
        event.query.state.status === 'success'
      ) {
        const categories = event.query.state.data as any[] | undefined;
        if (!categories?.length) return;

        // Seed per-slug cache for instant category page navigation
        categories.forEach((cat: any) => {
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

        unsubscribe();
      }
    });

    return unsubscribe;
  }, [queryClient]);
};
