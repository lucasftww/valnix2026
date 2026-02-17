import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

const FIREBASE_PROJECT_ID = "valnix";

// ── Firebase Auth (service account) ──────────────────────────────
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken;
  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!saKeyRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');
  const saKey = JSON.parse(saKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saKey.client_email, sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };
  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const pemBody = saKey.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Firebase auth failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  return cachedAccessToken!;
}

// ── In-memory cache ──────────────────────────────────────────────
interface CacheEntry { data: any; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

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
  
  const structuredQuery: any = {
    from: [{ collectionId }],
    limit: 200,
  };

  if (filters && filters.length > 0) {
    if (filters.length === 1) {
      structuredQuery.where = { fieldFilter: filters[0] };
    } else {
      structuredQuery.where = {
        compositeFilter: { op: 'AND', filters: filters.map(f => ({ fieldFilter: f })) }
      };
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) {
    console.error('Firestore query failed:', await res.text());
    return [];
  }

  const results = await res.json();
  if (!Array.isArray(results)) return [];

  return results
    .filter((r: any) => r.document)
    .map((r: any) => ({
      id: r.document.name.split('/').pop(),
      ...extractFields(r.document.fields),
    }));
}

// ── Handler ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "featured";

    const slug = url.searchParams.get("slug") || "";
    const id = url.searchParams.get("id") || "";
    const cacheKey = `${type}_${slug || id || "all"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    let data: any;

    if (type === "featured") {
      const products = await queryCollection("products", [
        { field: { fieldPath: "featured" }, op: "EQUAL", value: { booleanValue: true } },
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
      data = { products: products.sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0)).slice(0, 20) };

    } else if (type === "categories") {
      const categories = await queryCollection("categories", [
        { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } },
      ]);
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
      if (!res.ok) {
        data = { product: null };
      } else {
        const doc = await res.json();
        const product = { id: doc.name.split('/').pop(), ...extractFields(doc.fields) };
        data = { product: product.is_active ? product : null };
      }

    } else if (type === "check-role") {
      // Check admin role for a given Firebase UID via server-side Firestore
      const uid = url.searchParams.get("uid");
      if (!uid) return new Response(JSON.stringify({ error: "uid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const accessToken = await getFirebaseAccessToken();
      const roleDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
      const roleRes = await fetch(roleDocUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      if (!roleRes.ok) {
        data = { isAdmin: false };
      } else {
        const roleDoc = await roleRes.json();
        const role = roleDoc.fields?.role?.stringValue;
        data = { isAdmin: role === "admin" };
      }

    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cache the result
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL });

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
