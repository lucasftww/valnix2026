import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * guest-order — Read-only endpoint for guest order data.
 * Validates hash and returns order + items from subcollection.
 * No auth required (hash acts as unguessable token).
 * Rate-limited via Firestore-backed atomic counter.
 */

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || "*") : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const FIREBASE_PROJECT_ID = "valnix";
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── Firebase Auth ──
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

// ── Firestore-backed atomic rate limiter ──
async function checkRateLimitFirestore(
  key: string,
  maxAttempts: number,
  windowMs: number,
  blockMs: number,
  accessToken: string,
): Promise<boolean> {
  const docPath = `rate_limits/guest_order_${key.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const now = new Date().toISOString();

  // Atomic increment via commit + FieldTransform
  const commitBody = {
    writes: [
      {
        transform: {
          document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`,
          fieldTransforms: [
            { fieldPath: "count", increment: { integerValue: "1" } },
          ],
        },
      },
      {
        update: {
          name: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`,
          fields: {
            last_attempt: { timestampValue: now },
            key: { stringValue: key },
          },
        },
        updateMask: { fieldPaths: ["last_attempt", "key"] },
      },
    ],
  };

  try {
    const commitRes = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(commitBody),
    });

    if (!commitRes.ok) {
      console.warn("Rate limit commit failed, allowing request");
      return true; // fail-open for reads
    }

    // Read current count
    const docUrl = `${firestoreBase}/${docPath}`;
    const docRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!docRes.ok) return true;

    const docData = await docRes.json();
    const count = Number(docData.fields?.count?.integerValue || 0);
    const blockedUntil = docData.fields?.blocked_until?.timestampValue;

    if (blockedUntil && new Date(blockedUntil).getTime() > Date.now()) {
      return false;
    }

    if (count > maxAttempts) {
      // Set block
      const blockUntil = new Date(Date.now() + blockMs).toISOString();
      await fetch(`${firestoreBase}/${docPath}?updateMask.fieldPaths=blocked_until&updateMask.fieldPaths=count`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          fields: {
            blocked_until: { timestampValue: blockUntil },
            count: { integerValue: "0" },
          },
        }),
      });

      // Log the block
      const logUrl = `${firestoreBase}/rate_limit_logs`;
      await fetch(logUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          fields: {
            function_name: { stringValue: "guest-order" },
            key: { stringValue: key },
            blocked_until: { timestampValue: blockUntil },
            created_at: { timestampValue: now },
          },
        }),
      });

      return false;
    }

    return true;
  } catch (err) {
    console.warn("Rate limit error, allowing:", err);
    return true;
  }
}

// ── Helpers ──
function readIsoTimestamp(field: any): string | null {
  if (!field) return null;
  return field.timestampValue || field.stringValue || null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    // Accept hash from query param (GET) or body (POST)
    let hash: string | null = null;
    if (req.method === 'GET') {
      const url = new URL(req.url);
      hash = url.searchParams.get('hash');
    } else {
      const body = await req.json();
      hash = body.hash || null;
    }

    // ✅ Fix #4: Tighter hash validation (12–32 alnum only)
    if (!hash || typeof hash !== 'string' || !/^[A-Za-z0-9]{12,32}$/.test(hash)) {
      return new Response(JSON.stringify({ error: 'Invalid hash' }),
        { status: 400, headers: jsonHeaders });
    }

    const accessToken = await getFirebaseAccessToken();

    // ✅ Fix #3: Firestore-backed rate limit (30 req/min, 5min block)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkRateLimitFirestore(clientIp, 30, 60_000, 300_000, accessToken);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: jsonHeaders });
    }

    // Read guest_orders/{hash}
    const docUrl = `${firestoreBase}/guest_orders/${hash}`;
    const docRes = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

    if (docRes.status === 404 || !docRes.ok) {
      return new Response(JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: jsonHeaders });
    }

    const docData = await docRes.json();
    const fields = docData.fields || {};

    // ✅ Fix #2: Handle timestampValue OR stringValue for expiration
    const expiresIso = readIsoTimestamp(fields.expires_at);
    if (expiresIso && new Date(expiresIso).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'Order expired' }),
        { status: 410, headers: jsonHeaders });
    }

    // ✅ Fix #1: Use runQuery to list subcollection items reliably
    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
    const parent = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/guest_orders/${hash}`;

    const itemsRes = await fetch(runQueryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        parent,
        structuredQuery: {
          from: [{ collectionId: "items" }],
          orderBy: [{ field: { fieldPath: "product_name" }, direction: "ASCENDING" }],
          limit: 50,
        },
      }),
    });

    const items: Array<{
      product_name: string;
      product_image: string | null;
      quantity: number;
      unit_price: number;
      total_price: number;
      delivery_code: string | null;
    }> = [];

    if (itemsRes.ok) {
      const rows = await itemsRes.json();
      for (const r of rows) {
        const f = r.document?.fields;
        if (!f) continue; // skip empty results from runQuery
        items.push({
          product_name: f.product_name?.stringValue || '',
          product_image: f.product_image?.stringValue || null,
          quantity: Number(f.quantity?.integerValue || f.quantity?.doubleValue || 1),
          unit_price: Number(f.unit_price?.doubleValue || f.unit_price?.integerValue || 0),
          total_price: Number(f.total_price?.doubleValue || f.total_price?.integerValue || 0),
          delivery_code: f.delivery_code?.stringValue || null,
        });
      }
    }

    // Build response (only safe fields — no internal IDs, no user_id, no session)
    const response = {
      order_id: fields.order_id?.stringValue || null,
      email: fields.email?.stringValue || null,
      customer_name: fields.customer_name?.stringValue || null,
      customer_phone: fields.customer_phone?.stringValue || null,
      total_amount: Number(fields.total_amount?.doubleValue || fields.total_amount?.integerValue || 0),
      payment_method: fields.payment_method?.stringValue || 'pix',
      created_at: readIsoTimestamp(fields.created_at),
      expires_at: expiresIso,
      linked: fields.linked?.booleanValue ?? false,
      items,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...jsonHeaders,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('❌ guest-order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
