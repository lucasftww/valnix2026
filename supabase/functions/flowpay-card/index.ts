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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-delivery-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

const FLOWPAY_CARD_URL = 'https://flowpayments.net/api/card';
const FIREBASE_PROJECT_ID = 'valnix';
const SUPABASE_FUNCTIONS_URL = Deno.env.get('SUPABASE_URL') + '/functions/v1';

// ── Firebase Service Account Auth ──
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }
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

async function getFirestoreDoc(collection: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const data = await response.json();
  return data.fields || null;
}

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

// ── Firebase ID Token Verification ──
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

// ── Coupon increment (atomic) ──
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
  else console.log(`✅ Coupon ${couponId} incremented (card server-side)`);
}

// 🔒 Idempotent coupon increment — prevents double-increment from concurrent confirm/webhook
async function idempotentCouponIncrement(orderId: string, couponId: string) {
  const accessToken = await getFirebaseAccessToken();
  // Try to atomically create coupon_use_events/{orderId} — 409 if already exists
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

// ── Analytics ──
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
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
}

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

// ── Constant-time comparison ──
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let result = 0;
  for (let i = 0; i < ab.length; i++) result |= ab[i] ^ bb[i];
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
          return { allowed: true, attempts: count };
        }

        return { allowed: !shouldBlock, attempts: count + 1 };
      }
    }

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

// ── Pending order flood protection (Firestore-backed) ──
async function checkPendingOrderFlood(userId: string): Promise<boolean> {
  const rl = await checkRateLimitFirestore(`flood_${userId}`, 10, 3600_000, 3600_000);
  if (!rl.allowed) {
    console.warn(`🚨 ORDER FLOOD: user ${userId} exceeded 10 pending orders/hour`);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const apiKey = Deno.env.get('FLOWPAY_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FlowPay API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== CREATE card charge ====================
    if (action === 'create' && req.method === 'POST') {
      // 🔒 Rate limit card creation per IP (Firestore-backed, centralized)
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`card_${clientIp}`, 5, 60_000, 600_000);
      if (!rlResult.allowed) {
        logRateLimitBlock('flowpay-card', clientIp, rlResult.attempts);
        return new Response(
          JSON.stringify({ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const body = await req.json();
      const { orderId, customer } = body;
      let amount: number;

      if (!orderId || typeof orderId !== 'string' || orderId.length > 50) {
        return new Response(
          JSON.stringify({ success: false, error: 'orderId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 🔒 CRITICAL: Recalculate total from REAL product prices (never trust client total_amount)
      const orderFields = await getFirestoreDoc('orders', orderId);
      if (!orderFields) {
        return new Response(
          JSON.stringify({ success: false, error: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const orderItemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
      if (!orderItemsResults || !Array.isArray(orderItemsResults) || orderItemsResults.length === 0 || !orderItemsResults[0]?.document) {
        return new Response(
          JSON.stringify({ success: false, error: 'Order items not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let recalculatedTotal = 0;
      for (const result of orderItemsResults) {
        if (!result.document) continue;
        const itemFields = result.document.fields;
        const productId = itemFields?.product_id?.stringValue;
        const quantity = parseInt(itemFields?.quantity?.integerValue || '1');
        if (!productId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid order item' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const productFields = await getFirestoreDoc('products', productId);
        if (!productFields) {
          return new Response(
            JSON.stringify({ success: false, error: `Product ${productId} not found` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const realPrice = Number(productFields.price?.doubleValue || productFields.price?.integerValue || 0);
        recalculatedTotal += realPrice * quantity;
      }

      // Apply coupon discount (server-side validation)
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
            if (discountType === 'percentage') {
              discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal);
            } else {
              discountAmount = Math.min(discountValue, recalculatedTotal);
            }
            recalculatedTotal -= discountAmount;
          }
        }
      }

      // 🔒 Flood protection: check if user has too many pending orders
      const orderUserId = orderFields.user_id?.stringValue;
      if (orderUserId && !(await checkPendingOrderFlood(orderUserId))) {
        return new Response(
          JSON.stringify({ success: false, error: 'Muitos pedidos pendentes. Aguarde ou finalize os pedidos anteriores.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
      if (Math.abs(clientTotal - recalculatedTotal) > 0.01) {
        console.warn(`🚨 PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${recalculatedTotal} (order ${orderId})`);
      }

      amount = Math.round(recalculatedTotal * 100);
      if (amount < 100) {
        return new Response(
          JSON.stringify({ success: false, error: 'Valor mínimo é R$ 1,00' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`🔒 Card charge: server-recalculated amount ${amount} cents (order ${orderId})`);

      // 🔒 SECURITY: Description is ALWAYS generated server-side (never trust client input)
      const safeDescription = `Pedido ${orderId.substring(0, 8).toUpperCase()}`;

      const flowpayResponse = await fetch(`${FLOWPAY_CARD_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          value: amount,
          description: safeDescription,
          customer: customer ? {
            name: customer.name || undefined,
            email: customer.email || undefined,
            phone: customer.phone || undefined,
            taxId: customer.taxId || undefined,
          } : undefined,
        }),
      });

      const flowpayData = await flowpayResponse.json();
      if (!flowpayResponse.ok || !flowpayData.success) {
        console.error('FlowPay card create error:', flowpayData);
        return new Response(
          JSON.stringify({ success: false, error: flowpayData.error || 'Erro ao criar cobrança de cartão' }),
          { status: flowpayResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 🔒 P0 FIX: Generate delivery_token SERVER-SIDE (never trust client-generated tokens)
      const deliveryToken = crypto.randomUUID();
      try {
        await updateFirestoreDoc('orders', orderId, {
          flowpay_charge_id: flowpayData.payment.id,
          delivery_token: deliveryToken,
          delivery_token_created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('⚠️ Failed to save flowpay_charge_id/delivery_token:', err);
      }

      return new Response(
        JSON.stringify({
          success: true,
          paymentId: flowpayData.payment.id,
          paymentUrl: flowpayData.payment.paymentUrl,
          status: flowpayData.payment.status,
          deliveryToken, // Return to client for callback use
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== CHECK STATUS ====================
    if (action === 'status' && req.method === 'GET') {
      const paymentId = url.searchParams.get('id');
      if (!paymentId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Payment ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 🔒 P1 FIX: Require Firebase token or delivery token for status check (prevent privacy leak)
      const statusAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      const deliveryTokenHeader = req.headers.get('x-delivery-token');
      let statusCallerUid: string | null = null;

      if (statusAuth) {
        const fbUser = await verifyFirebaseIdToken(statusAuth);
        if (!fbUser) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        statusCallerUid = fbUser.uid;
      }

      if (!statusCallerUid && !deliveryTokenHeader) {
        return new Response(JSON.stringify({ success: false, error: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Ownership validation
      const ownerResults = await queryFirestore('orders', 'flowpay_charge_id', 'EQUAL', paymentId);
      if (ownerResults?.[0]?.document) {
        const ownerFields = ownerResults[0].document.fields;
        const ownerUid = ownerFields?.user_id?.stringValue;
        const ownerDeliveryToken = ownerFields?.delivery_token?.stringValue;

        if (statusCallerUid) {
          if (ownerUid && ownerUid !== statusCallerUid) {
            console.warn(`🚨 Card status ownership mismatch: caller=${statusCallerUid}, owner=${ownerUid}, paymentId=${paymentId}`);
            return new Response(JSON.stringify({ success: false, error: 'Forbidden' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        } else if (deliveryTokenHeader) {
          if (ownerDeliveryToken !== deliveryTokenHeader) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid delivery token' }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }
      }

      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, {
        headers: { 'x-api-key': apiKey },
      });

      const statusData = await statusResponse.json();
      if (!statusResponse.ok) {
        return new Response(
          JSON.stringify({ success: false, error: statusData.error || 'Erro ao consultar status' }),
          { status: statusResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: statusData.payment?.status,
          paidAt: statusData.payment?.paidAt || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ==================== CONFIRM (server-side payment confirmation) ====================
    // 🔒 P0 FIX: All payment confirmation logic moved from CardPaymentCallback to server
    if (action === 'confirm' && req.method === 'POST') {
      const body = await req.json();
      const { orderId, paymentId } = body;

      if (!orderId || !paymentId) {
        return new Response(
          JSON.stringify({ success: false, error: 'orderId and paymentId are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Auth: accept Firebase token OR delivery_token
      const authHeader = req.headers.get('authorization');
      const idToken = authHeader?.replace(/^Bearer\s+/i, '');
      const deliveryTokenHeader = req.headers.get('x-delivery-token');

      let authSource = 'none';
      let callerUid: string | null = null;

      if (idToken) {
        const user = await verifyFirebaseIdToken(idToken);
        if (user) {
          callerUid = user.uid;
          authSource = 'user';
        }
      }
      if (authSource === 'none' && deliveryTokenHeader && deliveryTokenHeader.length >= 20) {
        authSource = 'delivery_token';
      }
      if (authSource === 'none') {
        return new Response(
          JSON.stringify({ success: false, error: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 1. Verify payment status with FlowPay API (never trust client)
      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, {
        headers: { 'x-api-key': apiKey },
      });
      const statusData = await statusResponse.json();

      if (!statusResponse.ok || statusData.payment?.status !== 'COMPLETED') {
        const currentStatus = statusData.payment?.status || 'unknown';
        return new Response(
          JSON.stringify({ success: false, error: 'Payment not confirmed', status: currentStatus }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 2. Fetch order and validate ownership
      const orderFields = await getFirestoreDoc('orders', orderId);
      if (!orderFields) {
        return new Response(
          JSON.stringify({ success: false, error: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate auth against order
      if (authSource === 'user') {
        const orderUserId = orderFields.user_id?.stringValue;
        if (orderUserId && !orderUserId.startsWith('guest_') && orderUserId !== callerUid) {
          return new Response(
            JSON.stringify({ success: false, error: 'Forbidden: not your order' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (authSource === 'delivery_token') {
        const storedToken = orderFields.delivery_token?.stringValue;
        if (!storedToken || storedToken !== deliveryTokenHeader) {
          return new Response(
            JSON.stringify({ success: false, error: 'Forbidden: invalid delivery token' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // 🔒 Consume delivery_token to prevent reuse (fail-closed)
        try {
          await updateFirestoreDoc('orders', orderId, {
            delivery_token: null,
            delivery_token_created_at: null,
            delivery_token_consumer: `card_confirm_${crypto.randomUUID()}`,
          });
        } catch (consumeErr) {
          console.error(`❌ [${orderId}] Failed to consume delivery_token on card confirm — aborting`, consumeErr);
          return new Response(
            JSON.stringify({ success: false, error: 'Internal error: token consumption failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Validate flowpay_charge_id matches
      const storedChargeId = orderFields.flowpay_charge_id?.stringValue;
      if (storedChargeId !== paymentId) {
        console.warn(`🚨 Card confirm: chargeId mismatch! stored=${storedChargeId}, provided=${paymentId}`);
        return new Response(
          JSON.stringify({ success: false, error: 'Payment ID mismatch' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 3. Idempotency: if already paid, return success
      if (orderFields.payment_status?.stringValue === 'paid') {
        console.log(`ℹ️ Card order ${orderId} already paid`);
        return new Response(
          JSON.stringify({ success: true, message: 'Already processed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 4. Mark as paid (server-side only)
      await updateFirestoreDoc('orders', orderId, {
        payment_status: 'paid',
        status: 'processing',
        updated_at: new Date().toISOString(),
      });
      console.log(`✅ Card order ${orderId} marked as paid (server-side confirm)`);

      // 5. Process delivery via internal key
      try {
        const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
        await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret });
        console.log(`📦 process-delivery called for card order ${orderId}`);
      } catch (e) { console.warn('⚠️ process-delivery call failed:', e); }

      // 6. Increment coupon usage (idempotent — prevents double-increment)
      const couponId = orderFields.coupon_id?.stringValue;
      if (couponId) {
        try { await idempotentCouponIncrement(orderId, couponId); } catch {}
      }

      // 7. Fetch real product names from order_items for analytics accuracy
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

      // 8. Analytics
      const orderValue = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
      const userId = orderFields.user_id?.stringValue;
      const customerEmail = orderFields.customer_email?.stringValue;
      const customerName = orderFields.customer_name?.stringValue || '';
      const customerPhone = orderFields.customer_phone?.stringValue || '';

      try {
        await addFirestoreDoc('analytics_events', {
          event_name: 'Purchase',
          event_time: new Date().toISOString(),
          user_id: userId || null,
          value: orderValue,
          currency: 'BRL',
          order_id: orderId,
          page_url: 'https://www.valnix.com.br/card-callback',
          content_name: productNamesList,
        });
      } catch {}

      // 9. Meta CAPI
      const nameParts = customerName.split(' ');
      try {
        await invokeEdgeFunction('meta-capi', {
          event_name: 'Purchase',
          event_id: `purchase_${orderId}_${Date.now()}`,
          order_id: orderId,
          value: orderValue,
          currency: 'BRL',
          content_name: productNamesList,
          email: customerEmail,
          phone: customerPhone || undefined,
          first_name: nameParts[0] || undefined,
          last_name: nameParts.slice(1).join(' ') || undefined,
          external_id: userId,
          fbc: orderFields.fbc?.stringValue,
          fbp: orderFields.fbp?.stringValue,
        });
        console.log(`📡 Meta CAPI Purchase sent for card order ${orderId}`);
      } catch (e) { console.warn('⚠️ Meta CAPI card error:', e); }

      // 10. UTMify
      try {
        await invokeEdgeFunction('utmify-event', {
          order_id: orderId,
          event_type: 'Purchase',
          value: orderValue,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone || undefined,
          product_name: productNamesList,
          utm_source: orderFields.utm_source?.stringValue,
          utm_medium: orderFields.utm_medium?.stringValue,
          utm_campaign: orderFields.utm_campaign?.stringValue,
          utm_content: orderFields.utm_content?.stringValue,
          utm_term: orderFields.utm_term?.stringValue,
        });
        console.log(`📡 UTMify Purchase sent for card order ${orderId}`);
      } catch (e) { console.warn('⚠️ UTMify card error:', e); }

      return new Response(
        JSON.stringify({ success: true, orderId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action. Use ?action=create, ?action=status&id=..., or ?action=confirm' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('FlowPay card error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
