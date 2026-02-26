import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';

// ── In-memory cache ──────────────────────────────────────────────
interface CacheEntry { data: unknown; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── Firestore helpers ────────────────────────────────────────────
function extractFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, rawVal] of Object.entries(fields || {})) {
    const v = rawVal as Record<string, unknown>;
    if (v.stringValue !== undefined) result[key] = v.stringValue;
    else if (v.integerValue !== undefined) result[key] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) result[key] = v.doubleValue;
    else if (v.booleanValue !== undefined) result[key] = v.booleanValue;
    else if (v.nullValue !== undefined) result[key] = null;
    else if (v.arrayValue) {
      const arr = v.arrayValue as Record<string, unknown>;
      const values = (arr.values || []) as Record<string, unknown>[];
      result[key] = values.map((item) => {
        if (item.stringValue !== undefined) return item.stringValue;
        if (item.mapValue) {
          const mp = item.mapValue as Record<string, unknown>;
          return extractFields(mp.fields as Record<string, unknown>);
        }
        return null;
      });
    } else if (v.mapValue) {
      const mp = v.mapValue as Record<string, unknown>;
      result[key] = extractFields(mp.fields as Record<string, unknown>);
    }
  }
  return result;
}

interface FieldFilter {
  field: { fieldPath: string };
  op: string;
  value: Record<string, unknown>;
}

async function queryCollection(collectionId: string, filters?: FieldFilter[]) {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}:runQuery`;
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId }], limit: 200 };
  if (filters && filters.length > 0) {
    if (filters.length === 1) {
      structuredQuery.where = { fieldFilter: filters[0] };
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: filters.map((f) => ({ fieldFilter: f })),
        },
      };
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    console.error('Firestore query failed:', await res.text());
    return [];
  }
  const results = await res.json();
  if (!Array.isArray(results)) return [];
  return results
    .filter((r: Record<string, unknown>) => r.document)
    .map((r: Record<string, unknown>) => {
      const doc = r.document as Record<string, unknown>;
      const name = doc.name as string;
      return {
        id: name.split('/').pop(),
        ...extractFields(doc.fields as Record<string, unknown>),
      };
    });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, {
    headers: "content-type, apikey, authorization, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    methods: "GET, OPTIONS",
  });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "featured";
    const slug = url.searchParams.get("slug") || "";
    const id = url.searchParams.get("id") || "";
    const cacheKey = `${type}_${slug || id || "all"}`;
    const cacheControl =
      type === "featured" || type === "categories"
        ? "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400"
        : "public, max-age=300, s-maxage=900, stale-while-revalidate=3600";

    if (type !== "check-role") {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return new Response(JSON.stringify(cached.data), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-Cache": "HIT",
            "Cache-Control": cacheControl,
          },
        });
      }
    }

    let data: unknown;

    if (type === "featured") {
      const products = await queryCollection("products", [
        { field: { fieldPath: "featured" }, op: "EQUAL", value: { booleanValue: true } },
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      const slim = products
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          ((a.display_order as number) ?? 0) - ((b.display_order as number) ?? 0)
        )
        .slice(0, 20)
        .map((p: Record<string, unknown>) => ({
          id: p.id,
          name: p.name,
          image_url: p.image_url,
          icon_url: p.icon_url,
          price: p.price,
          old_price: p.old_price,
          discount: p.discount,
          category: p.category,
          display_order: p.display_order,
        }));
      data = { products: slim };
    } else if (type === "categories") {
      const categories = await queryCollection("categories", [
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      data = {
        categories: categories.sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            ((a.display_order as number) ?? 0) - ((b.display_order as number) ?? 0)
        ),
      };
    } else if (type === "category") {
      if (!slug) {
        return new Response(JSON.stringify({ error: "slug required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const products = await queryCollection("products", [
        { field: { fieldPath: "category" }, op: "EQUAL", value: { stringValue: slug } },
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      const slim = products
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          ((a.display_order as number) ?? 0) - ((b.display_order as number) ?? 0)
        )
        .map((p: Record<string, unknown>) => {
          const copy = { ...p };
          delete copy.instructions;
          delete copy.rich_description;
          delete copy.description;
          delete copy.auto_delivery_codes;
          delete copy.terms_conditions;
          return copy;
        });
      data = { products: slim };
    } else if (type === "product") {
      if (!id) {
        return new Response(JSON.stringify({ error: "id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getFirebaseAccessToken();
      const docUrl = `${FIRESTORE_BASE}/products/${id}`;
      const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        data = { product: null };
      } else {
        const doc = await res.json();
        const product = {
          id: (doc.name as string).split('/').pop(),
          ...extractFields(doc.fields),
        };
        data = { product: (product as Record<string, unknown>).is_active ? product : null };
      }
    } else if (type === "check-role") {
      const authHeader = req.headers.get("Authorization") || "";
      const idToken = authHeader.replace("Bearer ", "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Authorization required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const webApiKey = Deno.env.get("FIREBASE_WEB_API_KEY");
      if (!webApiKey) {
        console.error("FIREBASE_WEB_API_KEY not configured");
        return new Response(JSON.stringify({ isAdmin: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!verifyRes.ok) {
        return new Response(JSON.stringify({ isAdmin: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const verifyData = await verifyRes.json();
      const uid = verifyData.users?.[0]?.localId;
      if (!uid) {
        return new Response(JSON.stringify({ isAdmin: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessToken = await getFirebaseAccessToken();
      const roleDocUrl = `${FIRESTORE_BASE}/user_roles/${uid}`;
      const roleRes = await fetch(roleDocUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!roleRes.ok) {
        data = { isAdmin: false };
      } else {
        const roleDoc = await roleRes.json();
        data = { isAdmin: roleDoc.fields?.role?.stringValue === "admin" };
      }
    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type !== "check-role") {
      cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL });
    }

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-Cache": "MISS",
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
