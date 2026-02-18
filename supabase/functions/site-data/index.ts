import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';

// ── In-memory cache ──────────────────────────────────────────────
interface CacheEntry { data: any; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

// ── Firestore query helpers ──────────────────────────────────────
function extractFields(fields: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields || {})) {
    const v = val as any;
    if (v.stringValue !== undefined) result[key] = v.stringValue;
    else if (v.integerValue !== undefined) result[key] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) result[key] = v.doubleValue;
    else if (v.booleanValue !== undefined) result[key] = v.booleanValue;
    else if (v.nullValue !== undefined) result[key] = null;
    else if (v.arrayValue) result[key] = (v.arrayValue.values || []).map((item: any) => extractFields({ _: item })._ );
    else if (v.mapValue) result[key] = extractFields(v.mapValue.fields);
  }
  return result;
}

async function queryCollection(collectionId: string, filters?: any[]) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const structuredQuery: any = { from: [{ collectionId }], limit: 200 };
  if (filters && filters.length > 0) {
    if (filters.length === 1) structuredQuery.where = { fieldFilter: filters[0] };
    else structuredQuery.where = { compositeFilter: { op: 'AND', filters: filters.map(f => ({ fieldFilter: f })) } };
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery }) });
  if (!res.ok) { console.error('Firestore query failed:', await res.text()); return []; }
  const results = await res.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document).map((r: any) => ({ id: r.document.name.split('/').pop(), ...extractFields(r.document.fields) }));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "content-type, apikey, authorization, x-client-info", methods: "GET, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "featured";
    const slug = url.searchParams.get("slug") || "";
    const id = url.searchParams.get("id") || "";
    const cacheKey = `${type}_${slug || id || "all"}`;

    if (type !== "check-role") {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return new Response(JSON.stringify(cached.data), { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT", "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600" } });
      }
    }

    let data: any;

    if (type === "featured") {
      const products = await queryCollection("products", [
        { field: { fieldPath: "featured" }, op: "EQUAL", value: { booleanValue: true } },
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      data = { products: products.sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0)).slice(0, 20) };
    } else if (type === "categories") {
      const categories = await queryCollection("categories", [{ field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } }]);
      data = { categories: categories.sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0)) };
    } else if (type === "category") {
      if (!slug) return new Response(JSON.stringify({ error: "slug required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const products = await queryCollection("products", [
        { field: { fieldPath: "category" }, op: "EQUAL", value: { stringValue: slug } },
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      data = { products: products.sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0)) };
    } else if (type === "product") {
      if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const accessToken = await getFirebaseAccessToken();
      const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${id}`;
      const res = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      if (!res.ok) { data = { product: null }; }
      else { const doc = await res.json(); const product = { id: doc.name.split('/').pop(), ...extractFields(doc.fields) }; data = { product: product.is_active ? product : null }; }
    } else if (type === "check-role") {
      const authHeader = req.headers.get("Authorization") || "";
      const idToken = authHeader.replace("Bearer ", "");
      if (!idToken) return new Response(JSON.stringify({ error: "Authorization required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const webApiKey = Deno.env.get("FIREBASE_WEB_API_KEY");
      if (!webApiKey) { console.error("FIREBASE_WEB_API_KEY not configured"); return new Response(JSON.stringify({ isAdmin: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      if (!verifyRes.ok) return new Response(JSON.stringify({ isAdmin: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const verifyData = await verifyRes.json();
      const uid = verifyData.users?.[0]?.localId;
      if (!uid) return new Response(JSON.stringify({ isAdmin: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const accessToken = await getFirebaseAccessToken();
      const roleDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
      const roleRes = await fetch(roleDocUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      if (!roleRes.ok) data = { isAdmin: false };
      else { const roleDoc = await roleRes.json(); data = { isAdmin: roleDoc.fields?.role?.stringValue === "admin" }; }
    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type !== "check-role") cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL });
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS", "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
