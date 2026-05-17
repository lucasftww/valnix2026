import { supabase } from '@/integrations/supabase/client';
import type { Product } from '@/types';

const TIMEOUT_MS = 4000;

// IMPORTANT: never `select('*')` from the storefront client — RLS allows anon
// reads of active products but doesn't restrict columns, so a wildcard select
// would expose `auto_delivery_codes` (the literal codes we deliver to paying
// customers). Always whitelist columns.
const PUBLIC_COLUMNS =
  'id,name,description,rich_description,price,old_price,discount,' +
  'image_url,icon_url,category,is_active,featured,is_featured_in_category,' +
  'display_order,stock,sold,delivery_type,delivery_info,instructions,' +
  'terms_conditions,video_url,product_type,offer_hash,created_at,updated_at';

export const shouldRetryProductFetch = (error: unknown): boolean => {
  const msg = (error as Error)?.message ?? '';
  if (msg.includes('PRODUCT_FETCH_TIMEOUT')) return true;
  return msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch');
};

export const logFetchTimeout = (productId: string, error: unknown) => {
  if (import.meta.env.DEV && (error as Error)?.message?.includes('PRODUCT_FETCH_TIMEOUT')) {
    console.warn('Product fetch timeout', { productId });
  }
};

/** Shared product fetcher (used by both useProductById and ProductCard prefetch). */
export async function fetchProduct(productId: string): Promise<Product | null> {
  const queryPromise = (async () => {
    const { data, error } = await supabase
      .from('products')
      .select(PUBLIC_COLUMNS)
      .eq('id', productId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Product) ?? null;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('PRODUCT_FETCH_TIMEOUT')), TIMEOUT_MS),
  );

  return Promise.race([queryPromise, timeoutPromise]);
}
