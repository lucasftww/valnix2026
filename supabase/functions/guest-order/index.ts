import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * guest-order — Read-only endpoint for guest order data.
 * Validates hash and returns order + items from subcollection.
 * No auth required (hash acts as unguessable token).
 * Rate-limited by IP to prevent hash brute-forcing.
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

// ── Simple in-memory rate limiter (per isolate) ──
const ipAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Rate limit: 30/min per IP
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(clientIp, 30, 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

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

    if (!hash || typeof hash !== 'string' || hash.length < 8 || hash.length > 64) {
      return new Response(JSON.stringify({ error: 'Invalid hash' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Sanitize hash (alphanumeric only)
    if (!/^[a-zA-Z0-9]+$/.test(hash)) {
      return new Response(JSON.stringify({ error: 'Invalid hash format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const accessToken = await getFirebaseAccessToken();

    // Read guest_orders/{hash}
    const docUrl = `${firestoreBase}/guest_orders/${hash}`;
    const docRes = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

    if (docRes.status === 404 || !docRes.ok) {
      return new Response(JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const docData = await docRes.json();
    const fields = docData.fields || {};

    // Check expiration
    const expiresAt = fields.expires_at?.stringValue;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return new Response(JSON.stringify({ error: 'Order expired' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Read subcollection items: guest_orders/{hash}/items
    const itemsUrl = `${firestoreBase}/guest_orders/${hash}/items`;
    const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    
    const items: Array<{
      product_name: string;
      product_image: string | null;
      quantity: number;
      unit_price: number;
      total_price: number;
      delivery_code: string | null;
    }> = [];

    if (itemsRes.ok) {
      const itemsData = await itemsRes.json();
      for (const itemDoc of (itemsData.documents || [])) {
        const f = itemDoc.fields || {};
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
      created_at: fields.created_at?.stringValue || fields.created_at?.timestampValue || null,
      expires_at: expiresAt || null,
      linked: fields.linked?.booleanValue ?? false,
      items,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store', // delivery codes change over time
      },
    });
  } catch (error) {
    console.error('❌ guest-order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
