import { useQuery } from "@tanstack/react-query";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { resilientGetDocs } from "@/lib/firebaseHelpers";
import { fetchProduct } from "@/lib/fetchProduct";
import { fetchCategoryProductsFallback, fetchProductFallback, fetchCategoryBySlugFallback } from "@/lib/firestoreFallback";
import { markFirestorePossiblyBlocked } from "@/lib/firestoreBlockDetect";
import type { Category, Review, Product } from "@/types";

import { generateConsistentSalesAndReviews } from "@/lib/productUtils";

// Uses ProductWithReviews from types but only needs subset for category page
interface CategoryProductData {
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

      let firestoreResult: CategoryProductData[] | null = null;
      let apiResult: CategoryProductData[] | null = null;

      const mapProducts = (products: any[]): CategoryProductData[] =>
        products
          .filter((p: any) => p?.is_active)
          .sort((a: any, b: any) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
          .map((product: any) => {
            const stats = generateConsistentSalesAndReviews(product.id);
            return { ...product, sold: stats.sold, reviewCount: stats.reviewCount } as CategoryProductData;
          });

      const firestoreFetch = (async () => {
        const productsQuery = query(
          collection(db, "products"),
          where("category", "==", category)
        );
        const productsSnapshot = await resilientGetDocs(productsQuery);
        const raw = productsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
        return mapProducts(raw);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const products = await fetchCategoryProductsFallback(category);
        return mapProducts(products);
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first && first.length > 0) return first;

      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult && (firestoreResult as CategoryProductData[]).length > 0) return firestoreResult;
      if (apiResult && (apiResult as CategoryProductData[]).length > 0) return apiResult;
      return [];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Hook para buscar categoria por slug — with API fallback
export const useCategoryBySlug = (slug: string | undefined) => {
  return useQuery({
    queryKey: ["category", slug],
    queryFn: async (): Promise<Category | null> => {
      if (!slug) return null;

      let firestoreResult: Category | null | undefined = undefined;
      let apiResult: Category | null | undefined = undefined;

      const mapCategory = (data: any, id: string): Category => ({
        id,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        image_url: data.image_url || null,
        icon_url: data.icon_url || null,
        parent_id: data.parent_id || null,
        is_active: data.is_active,
        display_order: data.display_order,
        show_on_homepage: data.show_on_homepage || null,
      } as Category);

      const firestoreFetch = (async () => {
        const categoriesQuery = query(
          collection(db, "categories"),
          where("slug", "==", slug)
        );
        const snapshot = await resilientGetDocs(categoriesQuery);
        if (snapshot.empty) return null;
        const docSnap = snapshot.docs[0];
        const data = docSnap.data();
        if (!data.is_active) return null;
        return mapCategory(data, docSnap.id);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => { markFirestorePossiblyBlocked(err); return null; });

      const apiFetch = (async () => {
        const cat = await fetchCategoryBySlugFallback(slug);
        if (!cat) return null;
        return mapCategory(cat, cat.id);
      })().then(r => { apiResult = r; return r; }).catch(() => null);

      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first) return first;

      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult !== undefined && firestoreResult !== null) return firestoreResult;
      if (apiResult !== undefined && apiResult !== null) return apiResult;
      return null;
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

// Hook para buscar produto por ID — with API fallback race
export const useProductById = (productId: string | undefined) => {
  return useQuery({
    queryKey: ['product', productId],
    queryFn: async (): Promise<Product | null> => {
      if (!productId) return null;

      let firestoreResult: Product | null | undefined = undefined;
      let apiResult: Product | null | undefined = undefined;
      let firestoreError: unknown = null;
      let apiError: unknown = null;

      const firestoreFetch = (async () => {
        return await fetchProduct(productId);
      })().then(r => { firestoreResult = r; return r; }).catch((err) => {
        firestoreError = err;
        markFirestorePossiblyBlocked(err);
        return null;
      });

      const apiFetch = (async () => {
        return await fetchProductFallback(productId);
      })().then(r => { apiResult = r; return r; }).catch((err) => {
        apiError = err;
        return null;
      });

      // Wait for first non-null result
      const first = await Promise.race([firestoreFetch, apiFetch]);
      if (first) return first;

      // Wait for both to settle
      await Promise.allSettled([firestoreFetch, apiFetch]);
      if (firestoreResult) return firestoreResult;
      if (apiResult) return apiResult;

      // If BOTH errored (network issue, App Check rejection, etc.),
      // THROW so React Query can retry instead of showing "not found"
      if (firestoreError && apiError) {
        throw new Error("PRODUCT_FETCH_BOTH_FAILED");
      }

      // If at least one succeeded but returned null → product genuinely doesn't exist
      return null;
    },
    enabled: typeof productId === "string",
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    retry: (failureCount, error) => {
      // Retry up to 3 times for network/App Check failures
      if (failureCount >= 3) return false;
      const msg = (error as Error)?.message || "";
      return msg.includes("BOTH_FAILED") || msg.includes("TIMEOUT") || msg.includes("network");
    },
    retryDelay: (attempt) => Math.min(1000 * (attempt + 1), 4000),
    meta: { productId },
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
