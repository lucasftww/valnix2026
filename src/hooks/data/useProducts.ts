import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QUERY_KEYS } from '@/lib/constants';
import { generateConsistentSalesAndReviews } from '@/lib/productUtils';
import type { Category, Product, ProductWithReviews, Review } from '@/types';

export { generateConsistentSalesAndReviews } from '@/lib/productUtils';

function mapToProductWithReviews(p: Product): ProductWithReviews {
  const stats = generateConsistentSalesAndReviews(p.id);
  return { ...p, sold: stats.sold, reviewCount: stats.reviewCount } as ProductWithReviews;
}

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
  stock: number | null;
  reviewCount: number;
}

// Public column list — never include `auto_delivery_codes` (the actual codes
// delivered to paying customers). Wildcards through the anon key would leak.
const PRODUCT_PUBLIC_COLS =
  'id,name,description,rich_description,price,old_price,discount,' +
  'image_url,icon_url,category,is_active,featured,is_featured_in_category,' +
  'display_order,stock,sold,delivery_type,delivery_info,instructions,' +
  'terms_conditions,video_url,product_type,offer_hash,created_at,updated_at';

/** Products on a category page — full ProductWithReviews shape. */
export const useCategoryProducts = (categorySlug: string | undefined) => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORY_PRODUCTS, categorySlug],
    queryFn: async (): Promise<ProductWithReviews[]> => {
      if (!categorySlug) return [];
      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_PUBLIC_COLS)
        .eq('category', categorySlug)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => mapToProductWithReviews(p as unknown as Product));
    },
    enabled: !!categorySlug,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

/** Lighter category card data (used by category pages with reviews) */
export const useProductsWithReviews = (category: string) => {
  return useQuery({
    queryKey: ['products-with-reviews', category],
    queryFn: async (): Promise<CategoryProductData[]> => {
      if (!category) return [];
      const { data, error } = await supabase
        .from('products')
        .select('id,name,price,old_price,discount,image_url,icon_url,category,is_active,featured,display_order,stock')
        .eq('category', category)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => {
        const stats = generateConsistentSalesAndReviews(p.id);
        return { ...p, sold: stats.sold, reviewCount: stats.reviewCount } as CategoryProductData;
      });
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

export const useCategoryBySlug = (slug: string | undefined) => {
  return useQuery({
    queryKey: ['category', slug],
    queryFn: async (): Promise<Category | null> => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('categories')
        .select('id,name,slug,description,image_url,icon_url,parent_id,is_active,display_order,show_on_homepage')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Category) ?? null;
    },
    enabled: !!slug,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};

export const useProductById = (productId: string | undefined) => {
  return useQuery({
    queryKey: ['product', productId],
    queryFn: async (): Promise<Product | null> => {
      if (!productId) return null;
      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_PUBLIC_COLS)
        .eq('id', productId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as Product) ?? null;
    },
    enabled: typeof productId === 'string',
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * (attempt + 1), 4000),
  });
};

export const useProductReviews = (category: string | undefined) => {
  return useQuery({
    queryKey: ['product-reviews', category],
    queryFn: async (): Promise<Review[]> => {
      if (!category) return [];
      const { data, error } = await supabase
        .from('product_reviews')
        .select('id,product_id,category,customer_name,rating,comment,display_order,created_at')
        .eq('category', category)
        .order('display_order', { ascending: true })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as Review[];
    },
    enabled: !!category,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};
