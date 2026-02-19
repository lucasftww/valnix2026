import { useQuery } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import { fetchCategoriesFallback } from "@/lib/firestoreFallback";
import { markFirestorePossiblyBlocked } from "@/lib/firestoreBlockDetect";
import { deduplicateCategories, buildCategoryTree } from "@/lib/categoryUtils";
import { QUERY_KEYS } from "@/lib/constants";
import type { Category } from "@/types";

export type { Category } from "@/types";

// Hook centralizado para buscar categorias
export const useCategories = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORIES],
    queryFn: async (): Promise<Category[]> => {
      let firestoreResult: Category[] | null = null;
      let apiResult: Category[] | null = null;

      const firestoreFetch = (async () => {
        const snapshot = await resilientGetDocs(collection(db, "categories"));
        const raw = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((c) => c?.is_active);
        return deduplicateCategories(raw);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const raw = await fetchCategoriesFallback();
        return deduplicateCategories(raw.filter((c: any) => c?.is_active));
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first && first.length > 0) return first;

      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult && firestoreResult.length > 0) return firestoreResult;
      if (apiResult && apiResult.length > 0) return apiResult;
      return [];
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Hook para categorias com estrutura em árvore
export const useCategoriesTree = () => {
  const { data: categories = [], ...rest } = useCategories();
  const categoryTree = buildCategoryTree(categories);
  return { data: categoryTree, ...rest };
};
