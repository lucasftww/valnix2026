import { useQuery } from "@tanstack/react-query";
import { collection, query, where, doc, getDoc, getDocFromCache, getDocFromServer } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import type { Category, Review, Product } from "@/types";

import { generateConsistentSalesAndReviews } from "./useFirebaseProducts";

interface ProductWithReviews {
  id: string;
  name: string;
  price: number;
  old_price: number | null;
  discount: number | null;
  image_url: string | null;
  icon_url: string | null;
  category: string;
  sold: number | null;
  is_active: boolean;
  featured: boolean;
  display_order: number;
  reviewCount: number;
}

export const useProductsWithReviews = (category: string) => {
  return useQuery({
    queryKey: ["products-with-reviews", category],
    queryFn: async () => {
      if (!category) return [];
      
      const productsQuery = query(
        collection(db, "products"),
        where("category", "==", category)
      );
      
      const productsSnapshot = await resilientGetDocs(productsQuery);
      
      if (productsSnapshot.empty) return [];

      const products = productsSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((p) => p?.is_active)
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0));

      return products.map(product => {
        const stats = generateConsistentSalesAndReviews(product.id);
        return {
          ...product,
          sold: stats.sold,
          reviewCount: stats.reviewCount
        } as ProductWithReviews;
      });
    },
    staleTime: 30 * 60 * 1000, // 30 min - cache agressivo
    gcTime: 60 * 60 * 1000,    // 1 hora
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Hook para buscar categoria por slug
export const useCategoryBySlug = (slug: string | undefined) => {
  return useQuery({
    queryKey: ["category", slug],
    queryFn: async (): Promise<Category | null> => {
      if (!slug) return null;
      
      const categoriesQuery = query(
        collection(db, "categories"),
        // Evita índice composto: filtra por slug e aplica is_active client-side
        where("slug", "==", slug)
      );
      
      const snapshot = await resilientGetDocs(categoriesQuery);
      
      if (snapshot.empty) return null;
      
      const docSnap = snapshot.docs[0];
      const data = docSnap.data();

      if (!data.is_active) return null;
      
      return {
        id: docSnap.id,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        image_url: data.image_url || null,
        icon_url: data.icon_url || null,
        parent_id: data.parent_id || null,
        is_active: data.is_active,
        display_order: data.display_order,
        show_on_homepage: data.show_on_homepage || null
      } as Category;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

// Hook para buscar produto por ID
export const useProductById = (productId: string | undefined) => {
  return useQuery({
    queryKey: ['product', productId],
    queryFn: async (): Promise<Product | null> => {
      if (!productId) return null;
      
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

      const ref = doc(db, "products", productId);

      // Try cache first
      try {
        const cached = await withTimeout(getDocFromCache(ref), 2000);
        if (cached && cached.exists()) {
          const data = cached.data();
          if (!data.is_active) return null;
          return { id: cached.id, ...data } as Product;
        }
      } catch { /* cache miss */ }

      // Try default getDoc with timeout
      try {
        const productDoc = await withTimeout(getDoc(ref), 6000);
        if (productDoc && productDoc.exists()) {
          const data = productDoc.data();
          if (!data.is_active) return null;
          return { id: productDoc.id, ...data } as Product;
        }
      } catch { /* failed */ }

      // Force server
      try {
        const serverDoc = await withTimeout(getDocFromServer(ref), 6000);
        if (serverDoc && serverDoc.exists()) {
          const data = serverDoc.data();
          if (!data.is_active) return null;
          return { id: serverDoc.id, ...data } as Product;
        }
      } catch { /* server failed */ }

      return null;
    },
    enabled: !!productId,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Hook para buscar reviews por categoria
export const useProductReviews = (category: string | undefined) => {
  return useQuery({
    queryKey: ['product-reviews', category],
    queryFn: async (): Promise<Review[]> => {
      if (!category) return [];
      
      const reviewsQuery = query(
        collection(db, "product_reviews"),
        // Evita índice composto: ordena client-side
        where("category", "==", category)
      );
      
      const snapshot = await resilientGetDocs(reviewsQuery);

      return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
        .slice(0, 10)
        .map((data) => ({
          id: data.id,
          product_id: data.product_id || null,
          category: data.category || null,
          customer_name: data.customer_name,
          rating: data.rating,
          comment: data.comment,
          display_order: data.display_order,
          created_at: data.created_at,
        })) as Review[];
    },
    enabled: !!category,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};
