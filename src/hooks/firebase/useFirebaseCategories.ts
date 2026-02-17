import { useQuery } from "@tanstack/react-query";
import { collection } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import { fetchCategoriesFallback } from "@/lib/firestoreFallback";
import { isBlockedByAdBlocker, markFirestorePossiblyBlocked } from "@/lib/firestoreBlockDetect";
import { QUERY_KEYS, CACHE_TIMES } from "@/lib/constants";
import type { Category } from "@/types";

export type { Category } from "@/types";

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
    const aScore = score(existing);
    const bScore = score(c);
    if (bScore > aScore) {
      bySlug.set(slug, c);
    } else if (bScore === aScore) {
      const aOrder = existing?.display_order ?? Number.POSITIVE_INFINITY;
      const bOrder = c?.display_order ?? Number.POSITIVE_INFINITY;
      if (bOrder < aOrder) bySlug.set(slug, c);
    }
  }

  return Array.from(bySlug.values())
    .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0)) as Category[];
}

// Hook centralizado para buscar categorias
export const useCategories = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORIES],
    queryFn: async (): Promise<Category[]> => {
      try {
        const snapshot = await resilientGetDocs(collection(db, "categories"));
        const raw = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((c) => c?.is_active);
        return deduplicateCategories(raw);
      } catch (err) {
        console.warn("[Categories] Firestore failed, trying API fallback:", (err as Error)?.message || err);
        if (isBlockedByAdBlocker(err)) markFirestorePossiblyBlocked(err);
        try {
          const raw = await fetchCategoriesFallback();
          return deduplicateCategories(raw.filter((c: any) => c?.is_active));
        } catch (fallbackErr) {
          console.error("[Categories] API fallback also failed:", fallbackErr);
          throw err;
        }
      }
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

// Hook para categorias da homepage
export const useHomeCategories = () => {
  const { data: categories = [], ...rest } = useCategories();
  
  const homeCategories = categories.filter(
    (cat) => cat.show_on_homepage && !cat.parent_id
  );

  return { data: homeCategories, ...rest };
};

// Função utilitária para construir árvore de categorias
function buildCategoryTree(categories: Category[]): Category[] {
  const categoryMap = new Map<string, Category>();
  const roots: Category[] = [];

  categories.forEach((c) => {
    categoryMap.set(c.id, { ...c, children: [] });
  });

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
