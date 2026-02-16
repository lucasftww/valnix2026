import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/integrations/firebase/config';
import { QUERY_KEYS } from '@/lib/constants';

/**
 * Hook que pré-carrega APENAS categorias em background (lightweight).
 * Produtos de cada categoria são carregados sob demanda ao navegar.
 * Isso evita waterfall de Firestore reads competindo com dados críticos.
 */
export const useCategoryPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const prefetchCategories = async () => {
      const existingCategories = queryClient.getQueryData([QUERY_KEYS.CATEGORIES]);
      if (existingCategories) return;

      try {
        const snapshot = await getDocs(collection(db, 'categories'));
        const categories = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((c) => c?.is_active)
          .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0));

        queryClient.setQueryData([QUERY_KEYS.CATEGORIES], categories);

        // Cache each category by slug for instant navigation
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
      } catch (err) {
        // Silent fail — prefetch is best-effort
      }
    };

    // Defer to avoid competing with critical initial data (banners + products)
    const timeoutId = setTimeout(prefetchCategories, 3000);
    return () => clearTimeout(timeoutId);
  }, [queryClient]);
};
