import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// UTMify Event Edge Function — now uses Firestore for dedup/logging

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  // Allow internal calls (no Origin) from other edge functions
  const allowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || "*") : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// ── Rate limiting (Firestore-backed, ATOMIC — consistent with PIX/Card/Balance) ──
const RATE_LIMIT_DOC_BASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;

async function checkRateLimitFirestore(key: string, maxAttempts: number, windowMs: number, blockMs: number): Promise<{ allowed: boolean; attempts: number }> {
  const docId = key.replace(/[\/\.]/g, '_');
  const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
  const now = Date.now();
  const accessToken = await getFirebaseAccessToken();

  try {
    const existing = await getFirestoreDoc('rate_limits', docId);

    if (existing) {
      const fields = existing.fields || existing;
      const blockedUntil = Number(fields.blocked_until?.integerValue || '0');
      if (blockedUntil > now) {
        return { allowed: false, attempts: Number(fields.count?.integerValue || '0') };
      }

      const resetAt = Number(fields.reset_at?.integerValue || '0');
      const count = Number(fields.count?.integerValue || '0');

      if (resetAt > now) {
        const shouldBlock = count >= maxAttempts;

        const commitRes = await fetch(COMMIT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({
            writes: [
              {
                update: {
                  name: docPath,
                  fields: {
                    reset_at: { integerValue: String(resetAt) },
                    blocked_until: { integerValue: String(shouldBlock ? now + blockMs : 0) },
                    updated_at: { timestampValue: new Date().toISOString() },
                  },
                },
                currentDocument: { exists: true },
              },
              {
                transform: {
                  document: docPath,
                  fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }],
                },
              },
            ],
          }),
        });
        if (!commitRes.ok) {
          console.warn(`⚠️ UTMify rate limit commit failed: ${commitRes.status}`);
          return { allowed: true, attempts: count };
        }

        return { allowed: !shouldBlock, attempts: count + 1 };
      }
    }

    // Window expired or doc doesn't exist — reset with count=1
    const resetRes = await fetch(COMMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        writes: [{
          update: {
            name: docPath,
            fields: {
              count: { integerValue: '1' },
              reset_at: { integerValue: String(now + windowMs) },
              blocked_until: { integerValue: '0' },
              updated_at: { timestampValue: new Date().toISOString() },
            },
          },
        }],
      }),
    });
    if (!resetRes.ok) console.warn(`⚠️ UTMify rate limit reset failed: ${resetRes.status}`);

    return { allowed: true, attempts: 1 };
  } catch (e) {
    console.warn('⚠️ UTMify rate limit check failed, allowing request:', e);
    return { allowed: true, attempts: 0 };
  }
}

// ── Rate limit logging to Firestore ──
async function logRateLimitBlock(source: string, ip: string, attempts: number) {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limit_logs`;
    const fields: Record<string, unknown> = {
      source: { stringValue: source },
      ip: { stringValue: ip },
      attempts: { integerValue: String(attempts) },
      blocked_at: { timestampValue: new Date().toISOString() },
      created_at: { timestampValue: new Date().toISOString() },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) console.warn(`⚠️ Rate limit log POST failed: ${res.status}`);
    console.warn(`🛡️ Rate limit block logged: ${source} | IP: ${ip} | Attempts: ${attempts}`);
  } catch (e) {
    console.warn('⚠️ Failed to log rate limit block:', e);
  }
}

const UTMIFY_API_URL = 'https://api.utmify.com.br/api-credentials/orders';
const FIREBASE_PROJECT_ID = 'valnix';

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

// ── Firestore helpers ──────────────────────────────────────────────
async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 404 || !res.ok) return null;
  return await res.json();
}

async function setFirestoreDoc(col: string, docId: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

// ── UTMify payload ─────────────────────────────────────────────────
interface UtmifyOrderPayload {
  orderId: string; platform: string; paymentMethod: string; status: string;
  createdAt: string; approvedDate?: string; refundedAt?: string;
  customer: { name?: string; email?: string; phone: string | null; document: string | null };
  product: { id?: string; name?: string; planId: string; planName: string; quantity: number; price: number; priceInCents: number };
  trackingParameters: { src?: string; sck?: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null };
  commission: { amount?: number; currency?: string; totalPriceInCents: number; gatewayFeeInCents: number; userCommissionInCents: number };
}

async function sendToUtmify(payload: UtmifyOrderPayload): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const apiToken = Deno.env.get('UTMIFY_API_TOKEN');
  if (!apiToken) return { success: false, error: 'UTMIFY_API_TOKEN not configured' };
  try {
    const response = await fetch(UTMIFY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': apiToken },
      body: JSON.stringify(payload),
    });
    const data = await response.text();
    if (!response.ok) {
      console.error(`❌ UTMify API error (${response.status}):`, data);
      return { success: false, error: data, statusCode: response.status };
    }
    console.log('✅ UTMify event sent:', data);
    return { success: true, statusCode: response.status };
  } catch (error) {
    console.error('❌ UTMify fetch error:', error);
    return { success: false, error: String(error) };
  }
}

// ── Dedup via Firestore (replaces acquire_utmify_lock RPC) ─────────
async function acquireLock(eventId: string, eventType: string, orderId: string | null): Promise<boolean> {
  try {
    const existing = await getFirestoreDoc('utmify_event_log', eventId);
    if (existing) {
      const status = existing.fields?.status?.stringValue;
      if (status === 'sent') {
        console.log(`ℹ️ UTMify event ${eventId} already sent, skipping`);
        return false;
      }
      // If failed, allow retry
      const attemptCount = existing.fields?.attempt_count?.doubleValue || existing.fields?.attempt_count?.integerValue || 0;
      await setFirestoreDoc('utmify_event_log', eventId, {
        event_id: eventId, event_type: eventType, order_id: orderId,
        status: 'pending', attempt_count: Number(attemptCount) + 1,
        locked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      return true;
    }
    // Create new lock
    await setFirestoreDoc('utmify_event_log', eventId, {
      event_id: eventId, event_type: eventType, order_id: orderId,
      status: 'pending', attempt_count: 1,
      locked_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return true;
  } catch (e) {
    console.warn('⚠️ UTMify lock error:', e);
    return true; // Still try
  }
}

async function updateLockStatus(eventId: string, result: { success: boolean; error?: string }) {
  try {
    await setFirestoreDoc('utmify_event_log', eventId, {
      status: result.success ? 'sent' : 'failed',
      last_error: result.error || null,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('⚠️ UTMify lock update failed:', e);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Rate limit: 60/min per IP (Firestore-backed)
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await checkRateLimitFirestore(`utmify_ip_${clientIp}`, 60, 60_000, 300_000);
  if (!ipRl.allowed) {
    logRateLimitBlock('utmify-event-ip', clientIp, ipRl.attempts);
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  try {
    const body = await req.json();
    const {
      order_id, event_type = 'Purchase', value, customer_name, customer_email,
      customer_phone, customer_document, product_name, product_id,
      payment_method = 'pix', utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, sck,
    } = body;

    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Secondary rate limit: 10/min per payload fingerprint (utm/fbc/fbp/external_id/email)
    const fingerprintParts = [
      utm_source || '', utm_campaign || '', customer_email || '', order_id || '',
    ].join('|');
    if (fingerprintParts.length > 1) {
      // Simple hash for key
      let hash = 0;
      for (let i = 0; i < fingerprintParts.length; i++) {
        hash = ((hash << 5) - hash) + fingerprintParts.charCodeAt(i);
        hash |= 0;
      }
      const fpKey = `utmify_fp_${Math.abs(hash).toString(36)}`;
      const fpRl = await checkRateLimitFirestore(fpKey, 10, 60_000, 300_000);
      if (!fpRl.allowed) {
        logRateLimitBlock('utmify-event-fingerprint', `${clientIp}|fp:${fpKey}`, fpRl.attempts);
        return new Response(JSON.stringify({ error: 'Too many requests (fingerprint)' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const eventId = `${event_type}_${order_id}`;
    const shouldProceed = await acquireLock(eventId, event_type, order_id);
    if (!shouldProceed) {
      return new Response(JSON.stringify({ success: true, message: 'Already processed', event_id: eventId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const statusMap: Record<string, string> = { 'Purchase': 'paid', 'Refund': 'refunded', 'Chargeback': 'charged_back' };
    const now = new Date().toISOString();
    const priceInCents = Math.round((Number(value) || 0) * 100);

    const payload: UtmifyOrderPayload = {
      orderId: order_id, platform: 'valnix', paymentMethod: payment_method,
      status: statusMap[event_type] || 'paid', createdAt: now,
      approvedDate: event_type === 'Purchase' ? now : undefined,
      refundedAt: event_type === 'Refund' ? now : undefined,
      customer: { name: customer_name || undefined, email: customer_email || undefined, phone: customer_phone || null, document: customer_document || null },
      product: { id: product_id || order_id, name: product_name || 'Pedido VALNIX', planId: product_id || order_id, planName: product_name || 'Pedido VALNIX', quantity: 1, price: Number(value) || 0, priceInCents },
      trackingParameters: { src: src || undefined, sck: sck || undefined, utm_source: utm_source || null, utm_medium: utm_medium || null, utm_campaign: utm_campaign || null, utm_content: utm_content || null, utm_term: utm_term || null },
      commission: { amount: Number(value) || 0, currency: 'BRL', totalPriceInCents: priceInCents, gatewayFeeInCents: 0, userCommissionInCents: priceInCents },
    };

    console.log(`📡 Sending ${event_type} to UTMify (order: ${order_id})`);
    const result = await sendToUtmify(payload);
    await updateLockStatus(eventId, result);

    return new Response(JSON.stringify({
      success: result.success, event_id: eventId,
      ...(result.error ? { error: result.error } : {}),
    }), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ UTMify event error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
