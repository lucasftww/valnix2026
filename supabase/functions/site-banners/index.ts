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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

const FIREBASE_PROJECT_ID = "valnix";

// ── In-memory banner cache with jitter + single-flight lock ──
let cachedBanners: any[] | null = null;
let bannersCacheExpiry = 0;
const BANNER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes base
const BANNER_JITTER = 2 * 60 * 1000; // ±2 min jitter to prevent thundering herd
// Stale cache: kept even after expiry as fallback when Firestore is unavailable
let staleBanners: any[] | null = null;
// Single-flight: only one Firestore fetch at a time; concurrent requests share the same promise
let inflight: Promise<any[]> | null = null;

function getTTLWithJitter(): number {
  const ttl = BANNER_CACHE_TTL + Math.floor((Math.random() - 0.5) * BANNER_JITTER * 2);
  return Math.max(60_000, ttl); // never less than 1 minute
}

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

function extractFirestoreValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(extractFirestoreValue);
  if ('mapValue' in val) {
    const obj: any = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = extractFirestoreValue(v);
    return obj;
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const cacheHeaders = { "Cache-Control": "public, max-age=600, s-maxage=900, stale-while-revalidate=1800" };
  const staleCacheHeaders = { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };

  try {
    // 1. Serve from fresh cache
    if (cachedBanners && Date.now() < bannersCacheExpiry) {
      return new Response(JSON.stringify({ banners: cachedBanners }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", ...cacheHeaders, "X-Banners-Source": "cache" },
      });
    }

    // 2. Single-flight: if another request is already fetching, wait for it
    if (inflight) {
      try {
        const banners = await inflight;
        return new Response(JSON.stringify({ banners }), {
          headers: { ...corsHeaders, "Content-Type": "application/json", ...cacheHeaders, "X-Banners-Source": "coalesced" },
        });
      } catch {
        // inflight failed — fall through to stale/empty
        if (staleBanners) {
          return new Response(JSON.stringify({ banners: staleBanners, stale: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json", ...staleCacheHeaders, "X-Banners-Source": "stale" },
          });
        }
        return new Response(JSON.stringify({ banners: [] }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Banners-Source": "empty" },
        });
      }
    }

    // 3. This request becomes the fetcher (single-flight leader)
    inflight = (async (): Promise<any[]> => {
      const accessToken = await getFirebaseAccessToken();
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

      let res = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'site_banners' }],
            where: { fieldFilter: { field: { fieldPath: 'is_active' }, op: 'EQUAL', value: { booleanValue: true } } },
            orderBy: [{ field: { fieldPath: 'display_order' }, direction: 'ASCENDING' }],
            limit: 20,
          },
        }),
      });

      // Fallback for missing composite index
      if (!res.ok) {
        const errorText = await res.text();
        const isIndexMissing = res.status === 400 && errorText.includes('FAILED_PRECONDITION') && errorText.includes('requires an index');
        if (isIndexMissing) {
          const indexLink = errorText.match(/https:\/\/console\.firebase\.google\.com[^\s"')]+/);
          console.warn(`⚠️ Composite index missing. Falling back.${indexLink ? ` Create: ${indexLink[0]}` : ''}`);
          res = await fetch(queryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'site_banners' }],
                where: { fieldFilter: { field: { fieldPath: 'is_active' }, op: 'EQUAL', value: { booleanValue: true } } },
                limit: 20,
              },
            }),
          });
        }
        if (!res.ok) {
          console.error(`❌ Firestore query failed (${res.status})`);
          throw new Error('Firestore unavailable');
        }
      }

      const results = await res.json();
      return (Array.isArray(results) ? results : [])
        .filter((r: any) => r.document)
        .map((r: any) => {
          const fields = r.document.fields || {};
          const obj: any = { id: r.document.name.split('/').pop() };
          for (const [k, v] of Object.entries(fields)) obj[k] = extractFirestoreValue(v);
          return obj;
        })
        .sort((a: any, b: any) => (a.display_order ?? 999) - (b.display_order ?? 999));
    })();

    try {
      const banners = await inflight;
      // Update caches
      cachedBanners = banners;
      staleBanners = banners;
      bannersCacheExpiry = Date.now() + getTTLWithJitter();

      return new Response(JSON.stringify({ banners }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", ...cacheHeaders, "X-Banners-Source": "firestore" },
      });
    } catch {
      // Firestore failed — serve stale or empty
      console.warn('⚠️ Firestore fetch failed, serving fallback');
      if (staleBanners) {
        return new Response(JSON.stringify({ banners: staleBanners, stale: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json", ...staleCacheHeaders, "X-Banners-Source": "stale" },
        });
      }
      return new Response(JSON.stringify({ banners: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Banners-Source": "empty" },
      });
    } finally {
      inflight = null;
    }
  } catch (error) {
    console.error("❌ site-banners unhandled error:", error);
    if (staleBanners) {
      return new Response(JSON.stringify({ banners: staleBanners, stale: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", ...staleCacheHeaders, "X-Banners-Source": "stale" },
      });
    }
    return new Response(JSON.stringify({ banners: [] }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Banners-Source": "empty" },
    });
  }
});
