import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// FlowPay PIX Edge Function v4 — fully Firestore-based (zero Supabase client)

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeadersPix(req: Request) {
  const origin = req.headers.get("Origin") || "";
  // Allow internal calls (no Origin) from webhook
  const allowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || "*") : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-secret, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const FLOWPAY_BASE_URL = 'https://flowpayments.net/api/pix';
const FIREBASE_PROJECT_ID = 'valnix';
const SUPABASE_FUNCTIONS_URL = Deno.env.get('SUPABASE_URL') + '/functions/v1';

// ── Firebase ID Token Verification ─────────────────────────────────
async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  try {
    const apiKey = Deno.env.get('FIREBASE_WEB_API_KEY') || '';
    const res = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email || undefined };
  } catch { return null; }
}

// ── Firebase Service Account Auth ──────────────────────────────────
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
async function updateFirestoreDoc(collection: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}?${fieldPaths}`;
  const firestoreFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') firestoreFields[key] = { stringValue: value };
    else if (typeof value === 'number') firestoreFields[key] = { doubleValue: value };
    else if (typeof value === 'boolean') firestoreFields[key] = { booleanValue: value };
    else if (value === null || value === undefined) firestoreFields[key] = { nullValue: null };
    else firestoreFields[key] = { stringValue: String(value) };
  }
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
  if (!response.ok) {
    console.error(`❌ Firestore update failed for ${collection}/${docId}:`, await response.text());
    throw new Error(`Firestore update failed: ${response.status}`);
  }
  return true;
}

async function getFirestoreDoc(collection: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const data = await response.json();
  return data.fields || null;
}

async function queryFirestore(collectionId: string, fieldPath: string, op: string, value: string) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op, value: { stringValue: value } } },
      },
    }),
  });
  return await response.json();
}

async function addFirestoreDoc(col: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

/** Create doc with specific ID — returns true if created, false if already exists (409) */
async function addFirestoreDocWithId(col: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}?documentId=${encodeURIComponent(docId)}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  if (res.status === 409) return false;
  if (!res.ok) console.warn(`⚠️ addFirestoreDocWithId ${col}/${docId} failed: ${res.status}`);
  return res.ok;
}

// NOTE: Auto-delivery is handled exclusively by process-delivery edge function.
// generateFakeDeliveryCode and processAutoDelivery were removed to prevent bypass of atomic locks.

// ── Analytics → Firestore ──────────────────────────────────────────
async function registerAnalyticsEvent(orderId: string, value: number, userId?: string, customerEmail?: string, contentName?: string) {
  try {
    await addFirestoreDoc('analytics_events', {
      event_name: 'Purchase',
      event_time: new Date().toISOString(),
      user_id: userId || null,
      value,
      currency: 'BRL',
      order_id: orderId,
      page_url: 'https://www.valnix.com.br/checkout',
      content_name: contentName || `Pedido #${orderId.substring(0, 8)}`,
    });
    console.log(`📊 Analytics Purchase event registered for order ${orderId}`);
  } catch (error) {
    console.warn('⚠️ Analytics event registration failed:', error);
  }
}

// ── Call edge function via direct fetch (replaces supabase.functions.invoke) ──
async function invokeEdgeFunction(functionName: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`⚠️ ${functionName} returned ${res.status}`);
    return res;
  } catch (e) {
    console.warn(`⚠️ ${functionName} invoke error:`, e);
    return null;
  }
}

// ── Coupon increment ───────────────────────────────────────────────
async function incrementCouponUsage(couponId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/coupons/${couponId}`,
        fieldTransforms: [{ fieldPath: 'current_uses', increment: { integerValue: "1" } }]
      }
    }]
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) console.error(`❌ Coupon increment error:`, await response.text());
  else console.log(`✅ Coupon ${couponId} incremented`);
}

// 🔒 Idempotent coupon increment — prevents double-increment from concurrent webhook/polling
async function idempotentCouponIncrement(orderId: string, couponId: string) {
  const accessToken = await getFirebaseAccessToken();
  const createUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/coupon_use_events?documentId=${encodeURIComponent(orderId)}`;
  const res = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      fields: {
        coupon_id: { stringValue: couponId },
        used_at: { stringValue: new Date().toISOString() },
      },
    }),
  });
  if (res.status === 409) {
    console.log(`ℹ️ Coupon already incremented for order ${orderId}`);
    return;
  }
  if (!res.ok) {
    console.warn(`⚠️ Coupon event creation failed for order ${orderId}: ${res.status}`);
    return;
  }
  await incrementCouponUsage(couponId);
}

// ── Process upsell addon payment (webhook or fallback) ─────────────
async function processAddonPayment(addonDoc: any, addonId: string): Promise<boolean> {
  const f = addonDoc.fields || addonDoc;
  const getVal = (field: any) => field?.stringValue || field?.doubleValue?.toString() || field?.integerValue?.toString() || null;

  const status = getVal(f.status);
  if (status === 'paid') {
    console.log(`ℹ️ Addon ${addonId} already paid, skipping`);
    return false;
  }

  // Update addon status to paid in Firestore
  await updateFirestoreDoc('sale_addons', addonId, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  console.log(`✅ Addon ${addonId} marked as paid`);

  const orderId = getVal(f.order_id) || '';
  const addonType = getVal(f.addon_type) || '';
  const amount = f.amount?.doubleValue ?? (f.amount?.integerValue ? Number(f.amount.integerValue) : 0);
  const customerName = getVal(f.customer_name) || '';
  const customerEmail = getVal(f.customer_email) || '';
  const userId = getVal(f.user_id) || undefined;
  const utmSource = getVal(f.utm_source) || undefined;
  const utmMedium = getVal(f.utm_medium) || undefined;
  const utmCampaign = getVal(f.utm_campaign) || undefined;

  const upsellOrderId = `upsell-${orderId}-${addonType}`;

  // Analytics
  await registerAnalyticsEvent(upsellOrderId, Number(amount), userId, customerEmail);

  // Get parent order for fbc/fbp enrichment
  let parentFbc: string | undefined;
  let parentFbp: string | undefined;
  let parentPhone: string | undefined;
  try {
    const parentOrder = await getFirestoreDoc('orders', orderId);
    if (parentOrder) {
      parentFbc = parentOrder.fbc?.stringValue || undefined;
      parentFbp = parentOrder.fbp?.stringValue || undefined;
      parentPhone = parentOrder.customer_phone?.stringValue || undefined;
    }
  } catch {}

  // Meta CAPI (upsell — deterministic event_id, no timestamp)
  const nameParts = customerName.split(' ');
  const upsellEventId = `purchase_upsell_${orderId}_${addonType}`;
  try {
    await invokeEdgeFunction('meta-capi', {
      event_name: 'Purchase',
      event_id: upsellEventId,
      order_id: `${orderId}_${addonType}`,
      value: Number(amount), currency: 'BRL',
      content_name: `Upsell ${addonType}`,
      email: customerEmail || undefined,
      phone: parentPhone,
      first_name: nameParts[0] || undefined,
      last_name: nameParts.slice(1).join(' ') || undefined,
      external_id: userId, fbc: parentFbc, fbp: parentFbp,
    });
    console.log(`📡 Meta CAPI upsell Purchase sent for addon ${addonId}`);
  } catch (e) { console.warn('⚠️ Meta CAPI upsell failed:', e); }

  // UTMify
  try {
    await invokeEdgeFunction('utmify-event', {
      order_id: `${orderId}_${addonType}`,
      event_type: 'Purchase', value: Number(amount),
      customer_name: customerName, customer_email: customerEmail,
      product_name: `Upsell ${addonType}`,
      utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign,
    });
    console.log(`📡 UTMify upsell Purchase sent for addon ${addonId}`);
  } catch (e) { console.warn('⚠️ UTMify upsell failed:', e); }

  return true;
}

// ── Rate limit logging to Firestore ──
async function logRateLimitBlock(source: string, ip: string, attempts: number) {
  try {
    await addFirestoreDoc('rate_limit_logs', {
      source,
      ip,
      attempts,
      blocked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    console.warn(`🛡️ Rate limit block logged: ${source} | IP: ${ip} | Attempts: ${attempts}`);
  } catch (e) {
    console.warn('⚠️ Failed to log rate limit block:', e);
  }
}

// ── Constant-time comparison (no length leak) ──
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const max = Math.max(ab.length, bb.length);
  let result = ab.length ^ bb.length;
  for (let i = 0; i < max; i++) {
    result |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return result === 0;
}

// ── Rate limiting (Firestore-backed, ATOMIC via :commit + increment) ──
const RATE_LIMIT_DOC_BASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;

async function checkRateLimitFirestore(key: string, maxAttempts: number, windowMs: number, blockMs: number): Promise<{ allowed: boolean; attempts: number }> {
  const docId = key.replace(/[\/\.]/g, '_');
  const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
  const now = Date.now();
  const accessToken = await getFirebaseAccessToken();

  try {
    const fields = await getFirestoreDoc('rate_limits', docId);

    if (fields) {
      const blockedUntil = Number(fields.blocked_until?.integerValue || '0');
      if (blockedUntil > now) {
        return { allowed: false, attempts: Number(fields.count?.integerValue || '0') };
      }

      const resetAt = Number(fields.reset_at?.integerValue || '0');
      const count = Number(fields.count?.integerValue || '0');

      if (resetAt > now) {
        // Block decision based on CURRENT count (before increment) — safe under concurrency
        // If count >= maxAttempts, block. This means even if 2 concurrent reads see count=4
        // with maxAttempts=5, both block at count=5 (not count=6).
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
          console.warn(`⚠️ Rate limit commit failed: ${commitRes.status}`);
          return { allowed: true, attempts: count }; // fail-open but log
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
    if (!resetRes.ok) {
      console.warn(`⚠️ Rate limit reset commit failed: ${resetRes.status}`);
    }

    return { allowed: true, attempts: 1 };
  } catch (e) {
    console.warn('⚠️ Rate limit check failed, allowing request:', e);
    return { allowed: true, attempts: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeadersPix(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const apiKey = Deno.env.get('FLOWPAY_API_KEY');

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // ==================== WEBHOOK ====================
    if (req.method === 'POST' && action === 'webhook') {
      console.log('🔔 FlowPay webhook received');

      const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
      if (!webhookSecret) {
        console.error('❌ FLOWPAY_WEBHOOK_SECRET not configured');
        return new Response(JSON.stringify({ error: 'Webhook authentication not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      const receivedSecret = req.headers.get('x-webhook-secret') || req.headers.get('x-secret') || req.headers.get('authorization')?.replace('Bearer ', '') || req.headers.get('x-api-key');
      if (!receivedSecret || !timingSafeEqual(receivedSecret, webhookSecret)) {
        console.error('❌ Invalid webhook secret');
        return new Response(JSON.stringify({ error: 'Invalid webhook authentication' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      const body = await req.json();
      console.log('🔔 Webhook payload:', JSON.stringify(body));

      const event = body.event || body.type || body.status;
      const chargeData = body.data || body.charge || body;
      const paidEvents = ['pix.received', 'charge.paid', 'COMPLETED', 'paid', 'approved', 'pix_paid'];
      const isPaidEvent = paidEvents.includes(event) || chargeData?.status === 'COMPLETED' || chargeData?.status === 'paid';

      if (!isPaidEvent) {
        console.log(`ℹ️ Ignoring webhook event: ${event}`);
        return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), { headers: { 'Content-Type': 'application/json' } });
      }

      const chargeId = chargeData.chargeId || chargeData.id;
      const paidValue = chargeData.value;
      if (!chargeId) {
        return new Response(JSON.stringify({ error: 'Missing chargeId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      console.log(`💰 Payment confirmed for charge: ${chargeId}, value: ${paidValue}`);

      // Find order in Firestore
      const queryResults = await queryFirestore('orders', 'flowpay_charge_id', 'EQUAL', chargeId);

      if (!queryResults || !queryResults[0]?.document) {
        // Check if it's an upsell addon in Firestore
        console.log(`ℹ️ No order found for chargeId: ${chargeId}, checking sale_addons...`);
        const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', chargeId);

        if (!addonResults || !addonResults[0]?.document) {
          console.error(`❌ No order or addon found for chargeId: ${chargeId}`);
          return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const addonDoc = addonResults[0].document;
        const addonId = addonDoc.name.split('/').pop()!;
        await processAddonPayment(addonDoc, addonId);
        return new Response(JSON.stringify({ success: true, addonId }), { headers: { 'Content-Type': 'application/json' } });
      }

      const orderDoc = queryResults[0].document;
      const orderId = orderDoc.name.split('/').pop()!;
      const orderFields = orderDoc.fields;

      if (orderFields?.payment_status?.stringValue === 'paid') {
        console.log(`ℹ️ Order ${orderId} already paid, skipping`);
        return new Response(JSON.stringify({ success: true, message: 'Already processed' }), { headers: { 'Content-Type': 'application/json' } });
      }

      const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || (paidValue ? paidValue / 100 : 0);
      const customerEmail = orderFields?.customer_email?.stringValue;
      const userId = orderFields?.user_id?.stringValue;

      await updateFirestoreDoc('orders', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
      console.log(`✅ Order ${orderId} marked as paid via webhook`);

      // 🔒 Call process-delivery (single-writer) via internal key
      try {
        const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
        await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret });
        console.log(`📦 process-delivery called for order ${orderId}`);
      } catch (e) { console.error(`⚠️ process-delivery call failed:`, e); }

      const couponId = orderFields?.coupon_id?.stringValue;
      if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }

      // Fetch real product names from order_items for analytics accuracy
      let productNamesList = `Pedido #${orderId.substring(0, 8)}`;
      try {
        const itemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
        if (Array.isArray(itemsResults)) {
          const names = itemsResults
            .filter((r: any) => r.document?.fields?.product_name?.stringValue)
            .map((r: any) => r.document.fields.product_name.stringValue);
          if (names.length > 0) productNamesList = names.join(', ');
        }
      } catch {}

      await registerAnalyticsEvent(orderId, orderValue, userId, customerEmail, productNamesList);

      // Meta CAPI (idempotent via meta_purchase_events/{orderId})
      const customerName = orderFields?.customer_name?.stringValue || '';
      const customerPhone = orderFields?.customer_phone?.stringValue || '';
      const nameParts = customerName.split(' ');
      try {
        const capiGuardRes = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'webhook', event_id: `purchase_${orderId}`, created_at: new Date().toISOString() });
        if (capiGuardRes) {
          await invokeEdgeFunction('meta-capi', {
            event_name: 'Purchase', event_id: `purchase_${orderId}`, order_id: orderId,
            value: orderValue, currency: 'BRL', content_name: productNamesList,
            email: customerEmail, phone: customerPhone || undefined,
            first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined,
            external_id: userId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue,
          });
          console.log(`📡 Meta CAPI Purchase sent for order ${orderId}`);
        } else {
          console.log(`ℹ️ Meta CAPI Purchase already sent for order ${orderId}, skipping`);
        }
      } catch (e) { console.warn('⚠️ Meta CAPI failed:', e); }

      // UTMify
      try {
        await invokeEdgeFunction('utmify-event', {
          order_id: orderId, event_type: 'Purchase', value: orderValue,
          customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined,
          product_name: productNamesList,
          utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue,
          utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue,
          utm_term: orderFields?.utm_term?.stringValue,
        });
        console.log(`📡 UTMify Purchase sent for order ${orderId}`);
      } catch (e) { console.warn('⚠️ UTMify failed:', e); }

      return new Response(JSON.stringify({ success: true, orderId }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ==================== CREATE PIX CHARGE ====================
    if (req.method === 'POST' && action === 'create') {
      // 🔒 Rate limit PIX creation per IP (Firestore-backed, centralized)
      const createIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`pix_${createIp}`, 6, 60_000, 600_000);
      if (!rlResult.allowed) {
        logRateLimitBlock('flowpay-pix', createIp, rlResult.attempts);
        return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const authHeader = req.headers.get('authorization');
      const idToken = authHeader?.replace(/^Bearer\s+/i, '');
      let firebaseUser: { uid: string; email?: string } | null = null;
      if (idToken) {
        firebaseUser = await verifyFirebaseIdToken(idToken);
        if (firebaseUser) console.log(`🔐 Authenticated user: ${firebaseUser.uid}`);
        else console.warn('⚠️ Invalid Firebase token, proceeding as guest');
      }

      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const clientIpAtCreate = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || null;
      const clientUaAtCreate = req.headers.get('user-agent') || null;

      const body = await req.json();
      const { orderId, customer, utmParameters } = body;
      let { amount } = body;

      if (!orderId || typeof orderId !== 'string' || orderId.length > 100) {
        return new Response(JSON.stringify({ error: 'orderId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const isUpsell = orderId.startsWith('upsell-');

      if (!isUpsell) {
        // 🔒 Server-side price recalculation
        const orderFields = await getFirestoreDoc('orders', orderId);
        if (!orderFields) {
          return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const orderItemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
        if (!orderItemsResults || !Array.isArray(orderItemsResults) || !orderItemsResults[0]?.document) {
          return new Response(JSON.stringify({ error: 'Order items not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        let recalculatedTotal = 0;
        for (const result of orderItemsResults) {
          if (!result.document) continue;
          const itemFields = result.document.fields;
          const productId = itemFields?.product_id?.stringValue;
          const quantity = parseInt(itemFields?.quantity?.integerValue || '1');
          if (!productId) {
            return new Response(JSON.stringify({ error: 'Invalid order item' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          const productFields = await getFirestoreDoc('products', productId);
          if (!productFields) {
            return new Response(JSON.stringify({ error: `Product ${productId} not found` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          const realPrice = Number(productFields.price?.doubleValue || productFields.price?.integerValue || 0);
          recalculatedTotal += realPrice * quantity;
        }

        // Apply coupon
        const couponId = orderFields.coupon_id?.stringValue;
        if (couponId) {
          const couponFields = await getFirestoreDoc('coupons', couponId);
          if (couponFields) {
            const discountType = couponFields.discount_type?.stringValue;
            const discountValue = Number(couponFields.discount_value?.doubleValue || couponFields.discount_value?.integerValue || 0);
            const isActive = couponFields.is_active?.booleanValue !== false;
            const maxUses = couponFields.max_uses?.integerValue ? parseInt(couponFields.max_uses.integerValue) : null;
            const currentUses = couponFields.current_uses?.integerValue ? parseInt(couponFields.current_uses.integerValue) : 0;
            if (isActive && (!maxUses || currentUses < maxUses)) {
              let discountAmount = 0;
              if (discountType === 'percentage') discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal);
              else discountAmount = Math.min(discountValue, recalculatedTotal);
              recalculatedTotal -= discountAmount;
              console.log(`🏷️ Coupon ${couponId}: -R$${discountAmount.toFixed(2)}`);
            }
          }
        }

        const serverAmountCents = Math.round(recalculatedTotal * 100);
        if (serverAmountCents < 100) {
          return new Response(JSON.stringify({ error: 'Order amount too low' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 🔒 Flood protection: check if user has too many pending orders (parity with card)
        const orderUserId = orderFields.user_id?.stringValue;
        if (orderUserId) {
          const floodRl = await checkRateLimitFirestore(`flood_${orderUserId}`, 10, 3600_000, 3600_000);
          if (!floodRl.allowed) {
            console.warn(`🚨 ORDER FLOOD (PIX): user ${orderUserId} exceeded 10 pending orders/hour`);
            return new Response(JSON.stringify({ error: 'Muitos pedidos pendentes. Aguarde ou finalize os pedidos anteriores.' }),
              { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
        if (Math.abs(clientTotal - recalculatedTotal) > 0.01) {
          console.warn(`🚨 PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${recalculatedTotal}`);
        }

        amount = serverAmountCents;
        console.log(`🔒 Server-recalculated: ${amount} cents (order ${orderId})`);
      } else {
        // Upsell: validate from Firestore post_payment_pages
        const addonType = body.addonType;
        if (addonType) {
          const pageResults = await queryFirestore('post_payment_pages', 'addon_type', 'EQUAL', addonType);
          if (pageResults?.[0]?.document) {
            const pageFields = pageResults[0].document.fields;
            const isActive = pageFields?.is_active?.booleanValue !== false;
            if (isActive) {
              const pagePrice = Number(pageFields?.price?.doubleValue || pageFields?.price?.integerValue || 0);
              const serverUpsellCents = Math.round(pagePrice * 100);
              if (serverUpsellCents >= 100) {
                amount = serverUpsellCents;
                console.log(`🔒 Upsell server-verified: ${amount} cents (type: ${addonType})`);
              }
            }
          }
        }

        if (!amount || amount < 100) {
          return new Response(JSON.stringify({ error: 'Amount must be at least 100' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // 🔒 SECURITY: Description is ALWAYS generated server-side (never trust client input)
      const isUpsellCharge = orderId.startsWith('upsell-');
      const description = isUpsellCharge ? `Upsell ${orderId.substring(7, 30)}` : `Pedido ${orderId.substring(0, 8).toUpperCase()}`;

      console.log('🔵 Creating FlowPay PIX charge:', { amount, orderId });
      const response = await fetch(`${FLOWPAY_BASE_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ value: amount, description, expiresIn: 900, customer: customer || undefined }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        return new Response(JSON.stringify({ error: data.error || 'Failed to create PIX charge' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (orderId && !isUpsell) {
        try {
          await updateFirestoreDoc('orders', orderId, {
            flowpay_charge_id: data.charge.id,
            ...(utmParameters ? { utm_parameters: utmParameters } : {}),
            ...(clientIpAtCreate ? { client_ip: clientIpAtCreate } : {}),
            ...(clientUaAtCreate ? { client_ua: clientUaAtCreate } : {}),
          });
        } catch (err) { console.warn('⚠️ Failed to store chargeId:', err); }
      }

      return new Response(JSON.stringify({
        success: true, chargeId: data.charge.id, brCode: data.charge.brCode,
        qrCodeImage: data.charge.qrCodeImage, expiresAt: data.charge.expiresAt,
      }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CHECK STATUS ====================
    if (req.method === 'GET' && action === 'status') {
      const webhookSecretForStatus = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';

      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const chargeId = url.searchParams.get('chargeId');
      if (!chargeId) {
        return new Response(JSON.stringify({ error: 'chargeId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // 🔒 Ownership verification: require orderId parameter and validate it matches the chargeId
      const expectedOrderId = url.searchParams.get('orderId');
      if (!expectedOrderId) {
        return new Response(JSON.stringify({ error: 'orderId is required for status check' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // 🔒 Auth: require Firebase token or delivery token for side-effects
      const statusAuthHeader = req.headers.get('authorization');
      const statusIdToken = statusAuthHeader?.replace(/^Bearer\s+/i, '');
      let statusCallerUid: string | null = null;
      let canAttemptSideEffects = false;

      if (statusIdToken) {
        const fbUser = await verifyFirebaseIdToken(statusIdToken);
        if (fbUser) statusCallerUid = fbUser.uid;
      }

      // Verify the orderId actually belongs to this chargeId before returning any data
      const ownershipCheck = await getFirestoreDoc('orders', expectedOrderId);
      if (!ownershipCheck || ownershipCheck.flowpay_charge_id?.stringValue !== chargeId) {
        // Also check sale_addons for upsell
        const isUpsellOwner = expectedOrderId.startsWith('upsell-');
        if (!isUpsellOwner) {
          console.warn(`🚨 Ownership mismatch: orderId=${expectedOrderId} chargeId=${chargeId}`);
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // 🔒 Side-effects gate: only allow if caller owns the order or is a guest with matching user_id
      if (ownershipCheck) {
        const ownerUid = ownershipCheck.user_id?.stringValue;
        if (statusCallerUid) {
          // Authenticated user: must own the order
          canAttemptSideEffects = (ownerUid === statusCallerUid);
          if (!canAttemptSideEffects) {
            console.warn(`🚫 PIX status side-effects blocked: caller=${statusCallerUid}, owner=${ownerUid}, order=${expectedOrderId}`);
          }
        } else if (ownerUid?.startsWith('guest_')) {
          // Guest order polled without auth: allow side-effects (guest can't authenticate)
          canAttemptSideEffects = true;
        }
        // If authenticated user but not owner → side-effects blocked, status still returned
      }

      const response = await fetch(`${FLOWPAY_BASE_URL}/status?id=${chargeId}`, { headers: { 'x-api-key': apiKey } });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return new Response(JSON.stringify({ error: data.error || 'Failed to check status' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Side-effects: FlowPay API is source of truth — if COMPLETED, process payment
      if (data.charge?.status === 'COMPLETED' && canAttemptSideEffects) {
        try {
          const queryResults = await queryFirestore('orders', 'flowpay_charge_id', 'EQUAL', chargeId);
          const orderDoc = queryResults?.[0]?.document;

          if (orderDoc) {
            const orderId = orderDoc.name.split('/').pop()!;
            const orderFields = orderDoc.fields;
            const currentPaymentStatus = orderFields?.payment_status?.stringValue;

            if (currentPaymentStatus !== 'paid') {
              console.log(`🔄 Processing order ${orderId} via polling (FlowPay confirmed COMPLETED)`);
              const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0;
              const fbUserId = orderFields?.user_id?.stringValue;
              const fbEmail = orderFields?.customer_email?.stringValue;
              const fbName = orderFields?.customer_name?.stringValue || '';
              const fbPhone = orderFields?.customer_phone?.stringValue || '';

              await updateFirestoreDoc('orders', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
              try {
                await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecretForStatus });
              } catch {}

              const couponId = orderFields?.coupon_id?.stringValue;
              if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }

              // Fetch real product names for analytics accuracy
              let pollingProductNames = `Pedido #${orderId.substring(0, 8)}`;
              try {
                const pollingItems = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
                if (Array.isArray(pollingItems)) {
                  const names = pollingItems
                    .filter((r: any) => r.document?.fields?.product_name?.stringValue)
                    .map((r: any) => r.document.fields.product_name.stringValue);
                  if (names.length > 0) pollingProductNames = names.join(', ');
                }
              } catch {}

              await registerAnalyticsEvent(orderId, Number(orderValue), fbUserId, fbEmail, pollingProductNames);

              const nameParts = fbName.split(' ');
              try {
                const capiGuardRes = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'polling', event_id: `purchase_${orderId}`, created_at: new Date().toISOString() });
                if (capiGuardRes) {
                  await invokeEdgeFunction('meta-capi', {
                    event_name: 'Purchase', event_id: `purchase_${orderId}`, order_id: orderId,
                    value: Number(orderValue), currency: 'BRL', content_name: pollingProductNames,
                    email: fbEmail, phone: fbPhone || undefined,
                    first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined,
                    external_id: fbUserId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue,
                  });
                } else {
                  console.log(`ℹ️ Meta CAPI Purchase already sent for order ${orderId} (polling), skipping`);
                }
              } catch {}

              try {
                await invokeEdgeFunction('utmify-event', {
                  order_id: orderId, event_type: 'Purchase', value: Number(orderValue),
                  customer_name: fbName, customer_email: fbEmail, customer_phone: fbPhone || undefined,
                  product_name: pollingProductNames,
                  utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue,
                  utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue,
                  utm_term: orderFields?.utm_term?.stringValue,
                });
              } catch {}
            }
          } else {
            // Check upsell addon
            const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', chargeId);
            if (addonResults?.[0]?.document) {
              const addonDoc2 = addonResults[0].document;
              const addonId = addonDoc2.name.split('/').pop()!;
              const addonStatus = addonDoc2.fields?.status?.stringValue;
              if (addonStatus !== 'paid') {
                console.log(`🔄 Processing upsell addon ${addonId} via polling`);
                await processAddonPayment(addonDoc2, addonId);
              }
            }
          }
        } catch (fallbackError) {
          console.warn('⚠️ Purchase fallback error (non-blocking):', fallbackError);
        }
      }

      return new Response(JSON.stringify({ success: true, status: data.charge.status, paidAt: data.charge.paidAt || null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('❌ FlowPay edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
