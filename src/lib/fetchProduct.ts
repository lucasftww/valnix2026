import { supabase } from '@/integrations/supabase/client';
import type { Product } from '@/types';

const TIMEOUT_MS = 4000;

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
      .select('*')
      .eq('id', productId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Product) ?? null;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('PRODUCT_FETCH_TIMEOUT')), TIMEOUT_MS),
  );

  return Promise.race([queryPromise, timeoutPromise]);
}
