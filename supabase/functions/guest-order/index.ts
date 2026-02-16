import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * guest-order — Read-only endpoint for guest order data.
 * Validates hash and returns order + items from subcollection.
 * No auth required (hash acts as unguessable token).
 * Rate-limited via Firestore-backed atomic counter with windowed reset.
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

// ── Parse first public IP from x-forwarded-for ──
function parsePublicIp(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const ips = raw.split(',').map(ip => ip.trim()).filter(Boolean);
  const privateRanges = [
    /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./,
    /^::1$/, /^fd[0-9a-f]{2}:/i, /^fc[0-9a-f]{2}:/i, /^fe80:/i,
  ];
  for (const ip of ips) {
    const normalized = ip.replace(/^::ffff:/i, '');
    if (!privateRanges.some(r => r.test(normalized))) return normalized;
  }
  return ips[0]?.replace(/^::ffff:/i, '') || 'unknown';
}

// ── Firestore-backed atomic rate limiter (windowed) ──
async function checkRateLimitFirestore(
  key: string,
  maxAttempts: number,
  windowMs: number,
  blockMs: number,
  accessToken: string,
): Promise<boolean> {
  const docId = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
  const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits/guest_order_${docId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const docUrl = `${firestoreBase}/rate_limits/guest_order_${docId}`;

  const now = Date.now();

  try {
    // Read current state
    const existingRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    let count = 0;
    let resetAt = 0;
    let blockedUntil = 0;

    if (existingRes.ok) {
      const existing = await existingRes.json();
      const f = existing.fields || {};
      count = Number(f.count?.integerValue || "0");
      resetAt = Number(f.reset_at?.integerValue || "0");
      blockedUntil = Number(f.blocked_until?.integerValue || "0");
    } else {
      // Doc doesn't exist yet — consume body
      await existingRes.text();
    }

    // Currently blocked
    if (blockedUntil > now) return false;

    // Window expired → reset to count=1, new window
    if (resetAt <= now) {
      const res = await fetch(commitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          writes: [{
            update: {
              name: docPath,
              fields: {
                key: { stringValue: key },
                count: { integerValue: "1" },
                reset_at: { integerValue: String(now + windowMs) },
                blocked_until: { integerValue: "0" },
                updated_at: { timestampValue: new Date().toISOString() },
              },
            },
          }],
        }),
      });
      await res.text(); // consume
      return true; // first request in new window always passes
    }

    // Window active → increment atomically
    const commitRes = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docPath,
              fields: {
                key: { stringValue: key },
                reset_at: { integerValue: String(resetAt) },
                updated_at: { timestampValue: new Date().toISOString() },
              },
            },
            updateMask: { fieldPaths: ["key", "reset_at", "updated_at"] },
            currentDocument: { exists: true },
          },
          {
            transform: {
              document: docPath,
              fieldTransforms: [{ fieldPath: "count", increment: { integerValue: "1" } }],
            },
          },
        ],
      }),
    });
    await commitRes.text();

    if (!commitRes.ok) return true; // fail-open

    // Fix A: read-after-write near limit to close race condition
    if (count + 1 >= maxAttempts - 2) {
      const verifyRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        const realCount = Number(verifyData.fields?.count?.integerValue || "0");
        if (realCount > maxAttempts) {
          // Block now
          const blockUntilMs = now + blockMs;
          const blockRes = await fetch(commitUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              writes: [{
                update: {
                  name: docPath,
                  fields: {
                    blocked_until: { integerValue: String(blockUntilMs) },
                    count: { integerValue: "0" },
                  },
                },
                updateMask: { fieldPaths: ["blocked_until", "count"] },
              }],
            }),
          });
          await blockRes.text();

          // Fix B: log with consistent field name (epoch ms, not timestamp)
          const logUrl = `${firestoreBase}/rate_limit_logs`;
          const logRes = await fetch(logUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              fields: {
                function_name: { stringValue: "guest-order" },
                key: { stringValue: key },
                blocked_until_ms: { integerValue: String(blockUntilMs) },
                created_at: { timestampValue: new Date().toISOString() },
              },
            }),
          });
          await logRes.text();

          return false;
        }
      } else {
        await verifyRes.text();
      }
    }

    return true;
  } catch (e) {
    console.warn("Rate limit failed (allowing):", e);
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

    // Tight hash validation (12–32 alnum only)
    if (!hash || typeof hash !== 'string' || !/^[A-Za-z0-9]{12,32}$/.test(hash)) {
      return new Response(JSON.stringify({ error: 'Invalid hash' }),
        { status: 400, headers: jsonHeaders });
    }

    const accessToken = await getFirebaseAccessToken();

    // Firestore-backed rate limit (30 req/min window, 5min block)
    const raw = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || undefined;
    const clientIp = parsePublicIp(raw);
    const allowed = await checkRateLimitFirestore(clientIp, 30, 60_000, 300_000, accessToken);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: jsonHeaders });
    }

    // Read guest_orders/{hash}
    const docUrl = `${firestoreBase}/guest_orders/${hash}`;
    const docRes = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

    if (docRes.status === 404 || !docRes.ok) {
      await docRes.text(); // consume
      return new Response(JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: jsonHeaders });
    }

    const docData = await docRes.json();
    const fields = docData.fields || {};

    // Handle timestampValue OR stringValue for expiration
    const expiresIso = readIsoTimestamp(fields.expires_at);
    if (expiresIso && new Date(expiresIso).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'Order expired' }),
        { status: 410, headers: jsonHeaders });
    }

    // Use runQuery to list subcollection items reliably
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
    } else {
      await itemsRes.text(); // consume
    }

    // Build response (only safe fields)
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
      headers: { ...jsonHeaders, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('❌ guest-order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
