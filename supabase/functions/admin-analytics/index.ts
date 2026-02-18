import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
  }
  if (!ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

const FIREBASE_PROJECT_ID = "valnix";

// ── Firebase Auth ──────────────────────────────────────────────────
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

// ── HMAC Admin Token Verification ──────────────────────────────────
const TOKEN_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour (must match admin-auth generation TTL)

async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [timestampHex, nonce, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) return false;
  if (timestamp > now + 60_000) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(adminPassword), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampHex}:${nonce}:admin`));
  const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (providedHmac.length !== expectedHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < providedHmac.length; i++) { diff |= providedHmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i); }
  return diff === 0;
}

// ── Firestore query with date filter ───────────────────────────────
async function queryAnalyticsEvents(dateFilter: Date) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'analytics_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'event_time' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { stringValue: dateFilter.toISOString() },
          },
        },
        orderBy: [{ field: { fieldPath: 'event_time' }, direction: 'DESCENDING' }],
        limit: 10000,
      },
    }),
  });

  if (!res.ok) {
    console.error('❌ Firestore query failed:', await res.text());
    return [];
  }

  const results = await res.json();
  if (!Array.isArray(results)) return [];

  return results
    .filter((r: any) => r.document)
    .map((r: any) => {
      const f = r.document.fields;
      return {
        id: r.document.name.split('/').pop(),
        event_name: f?.event_name?.stringValue || '',
        event_time: f?.event_time?.stringValue || '',
        user_id: f?.user_id?.stringValue || null,
        page_url: f?.page_url?.stringValue || null,
        device_type: f?.device_type?.stringValue || null,
        browser: f?.browser?.stringValue || null,
        value: f?.value?.doubleValue ?? f?.value?.integerValue ?? null,
        currency: f?.currency?.stringValue || null,
        order_id: f?.order_id?.stringValue || null,
        content_name: f?.content_name?.stringValue || null,
        content_category: f?.content_category?.stringValue || null,
      };
    });
}

// ── Server-side rate limiting (per-IP, in-memory) ──────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();
const RL_MAX = 20;
const RL_WINDOW_MS = 60_000;
const RL_BLOCK_MS = 120_000;

function checkServerRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (entry && entry.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS, blockedUntil: 0 });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > RL_MAX) {
    entry.blockedUntil = now + RL_BLOCK_MS;
    return { allowed: false, retryAfter: Math.ceil(RL_BLOCK_MS / 1000) };
  }
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (v.resetAt <= now && v.blockedUntil <= now) rateLimitMap.delete(k);
  }
}, 300_000);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Rate limiting ──
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkServerRateLimit(clientIp);
  if (!rl.allowed) {
    console.warn(`🚫 Rate limited admin-analytics: ip=${clientIp}`);
    return new Response(JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 120) } });
  }

  try {
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) {
      return new Response(JSON.stringify({ error: "Admin token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid or expired admin token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const dateRange = url.searchParams.get("dateRange") || "7d";

    let dateFilter = new Date();
    if (dateRange === "today") dateFilter.setHours(0, 0, 0, 0);
    else if (dateRange === "7d") dateFilter.setDate(dateFilter.getDate() - 7);
    else if (dateRange === "30d") dateFilter.setDate(dateFilter.getDate() - 30);
    else dateFilter = new Date(0);

    const events = await queryAnalyticsEvents(dateFilter);

    return new Response(JSON.stringify({ events }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
  }
});
