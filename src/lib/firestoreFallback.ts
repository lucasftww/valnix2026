/**
 * Fallback API for when Firestore is blocked by ad blockers.
 * Fetches data via edge function proxy instead of direct Firestore.
 * Uses localStorage for instant loading on repeat visits.
 */
import { invokeFunction } from "@/lib/apiHelper";

const API_CACHE = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min in-memory
const LS_PREFIX = "valnix_cache_v1_";
const LS_TTL = 30 * 60 * 1000; // 30 min localStorage

function getLsCache(key: string): any | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(LS_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch { return null; }
}

function setLsCache(key: string, data: any): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ data, expiresAt: Date.now() + LS_TTL }));
  } catch { /* quota exceeded — ignore */ }
}

async function fetchFromApi(params: Record<string, string>): Promise<any> {
  const cacheKey = JSON.stringify(params);
  const cached = API_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const response = await invokeFunction("site-data", {
    method: "GET",
    queryParams: params,
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();

  API_CACHE.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL });
  setLsCache(cacheKey, data);
  return data;
}

export async function fetchFeaturedProductsFallback() {
  const lsData = getLsCache('{"type":"featured"}');
  if (lsData) {
    // Return cached immediately, refresh in background
    fetchFromApi({ type: "featured" }).catch(() => {});
    return lsData.products || [];
  }
  const data = await fetchFromApi({ type: "featured" });
  return data.products || [];
}

export async function fetchCategoriesFallback() {
  const lsData = getLsCache('{"type":"categories"}');
  if (lsData) {
    fetchFromApi({ type: "categories" }).catch(() => {});
    return lsData.categories || [];
  }
  const data = await fetchFromApi({ type: "categories" });
  return data.categories || [];
}

export async function fetchCategoryBySlugFallback(slug: string): Promise<any | null> {
  const categories = await fetchCategoriesFallback();
  return categories.find((c: any) => c.slug === slug && c.is_active) || null;
}

export async function fetchCategoryProductsFallback(slug: string) {
  const key = JSON.stringify({ type: "category", slug });
  const lsData = getLsCache(key);
  if (lsData) {
    fetchFromApi({ type: "category", slug }).catch(() => {});
    return lsData.products || [];
  }
  const data = await fetchFromApi({ type: "category", slug });
  return data.products || [];
}

export async function fetchProductFallback(id: string) {
  const key = JSON.stringify({ type: "product", id });
  const lsData = getLsCache(key);
  if (lsData) {
    fetchFromApi({ type: "product", id }).catch(() => {});
    return lsData.product || null;
  }
  const data = await fetchFromApi({ type: "product", id });
  return data.product || null;
}
