/**
 * Public catalog fetchers used during homepage hydration. Reads directly
 * from Supabase with the anon key — RLS limits anon to is_active rows.
 * Layered in-memory + localStorage cache to keep first paint snappy.
 *
 * The `*Fallback` suffix on function names is historical — the original
 * implementation went through /api/site-data because Firestore was
 * blocked by adblockers. Supabase doesn't have that problem.
 */
import { supabase } from '@/integrations/supabase/client';

// In-memory + localStorage caching kept to preserve homepage perf characteristics.
const API_CACHE = new Map<string, { data: unknown; expiresAt: number }>();
const INFLIGHT = new Map<string, Promise<unknown>>();
const CACHE_TTL = 5 * 60 * 1000;
const LS_PREFIX = 'valnix_cache_v2_';
const LS_TTL = 30 * 60 * 1000;

function getLsCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; expiresAt: number };
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(LS_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setLsCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      LS_PREFIX + key,
      JSON.stringify({ data, expiresAt: Date.now() + LS_TTL }),
    );
  } catch {
    /* quota exceeded */
  }
}

async function memoize<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = API_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data as T;

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = (async () => {
    const data = await fetcher();
    API_CACHE.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
    setLsCache(key, data);
    return data;
  })();

  INFLIGHT.set(key, promise);
  promise.finally(() => INFLIGHT.delete(key));
  return promise;
}

export async function fetchFeaturedProductsFallback() {
  const cacheKey = 'featured';
  const lsData = getLsCache<unknown[]>(cacheKey);
  if (lsData) {
    memoize(cacheKey, fetchFeaturedFromSupabase).catch(() => {});
    return lsData;
  }
  return memoize(cacheKey, fetchFeaturedFromSupabase);
}

async function fetchFeaturedFromSupabase() {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,price,old_price,discount,image_url,icon_url,category,display_order,is_active,featured')
    .eq('is_active', true)
    .eq('featured', true)
    .order('display_order', { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchCategoriesFallback() {
  const cacheKey = 'categories';
  const lsData = getLsCache<unknown[]>(cacheKey);
  if (lsData) {
    memoize(cacheKey, fetchCategoriesFromSupabase).catch(() => {});
    return lsData;
  }
  return memoize(cacheKey, fetchCategoriesFromSupabase);
}

async function fetchCategoriesFromSupabase() {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,slug,description,image_url,icon_url,parent_id,is_active,display_order,show_on_homepage')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchCategoryBySlugFallback(slug: string): Promise<unknown | null> {
  const categories = await fetchCategoriesFallback();
  return (categories as Array<{ slug: string; is_active: boolean }>).find(
    (c) => c.slug === slug && c.is_active,
  ) ?? null;
}

export async function fetchCategoryProductsFallback(slug: string) {
  const cacheKey = `cat:${slug}`;
  const lsData = getLsCache<unknown[]>(cacheKey);
  if (lsData) {
    memoize(cacheKey, () => fetchCategoryProductsFromSupabase(slug)).catch(() => {});
    return lsData;
  }
  return memoize(cacheKey, () => fetchCategoryProductsFromSupabase(slug));
}

async function fetchCategoryProductsFromSupabase(slug: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('category', slug)
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchProductFallback(id: string) {
  const cacheKey = `prod:${id}`;
  const lsData = getLsCache<unknown>(cacheKey);
  if (lsData) {
    memoize(cacheKey, () => fetchProductFromSupabase(id)).catch(() => {});
    return lsData;
  }
  return memoize(cacheKey, () => fetchProductFromSupabase(id));
}

async function fetchProductFromSupabase(id: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
