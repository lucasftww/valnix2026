/**
 * Fallback API for when Firestore is blocked by ad blockers.
 * Fetches data via edge function proxy instead of direct Firestore.
 */
import { invokeFunction } from "@/lib/apiHelper";

const API_CACHE = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

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
  return data;
}

export async function fetchFeaturedProductsFallback() {
  const data = await fetchFromApi({ type: "featured" });
  return data.products || [];
}

export async function fetchCategoriesFallback() {
  const data = await fetchFromApi({ type: "categories" });
  return data.categories || [];
}

export async function fetchCategoryProductsFallback(slug: string) {
  const data = await fetchFromApi({ type: "category", slug });
  return data.products || [];
}

export async function fetchProductFallback(id: string) {
  const data = await fetchFromApi({ type: "product", id });
  return data.product || null;
}
