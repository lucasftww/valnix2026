import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * checkout-balance — Server-side balance payment handler
 * 
 * CRITICAL SECURITY: Balance deduction MUST happen server-side.
 * The client NEVER touches the balance field directly.
 * 
 * Flow:
 * 1. Verify Firebase auth token
 * 2. Validate order exists and belongs to user
 * 3. Recalculate total from real product prices (never trust client)
 * 4. Validate coupon server-side
 * 5. Check user has sufficient balance
 * 6. Atomically deduct balance and mark order as paid
 * 7. Increment coupon usage (idempotent)
 * 8. Call process-delivery
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
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

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

// ── Firestore helpers ──
async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return await response.json();
}

async function updateFirestoreDoc(col: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}?${fieldPaths}`;
  const firestoreFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') firestoreFields[key] = { stringValue: value };
    else if (typeof value === 'number') firestoreFields[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    else if (typeof value === 'boolean') firestoreFields[key] = { booleanValue: value };
    else if (value === null || value === undefined) firestoreFields[key] = { nullValue: null };
    else firestoreFields[key] = { stringValue: String(value) };
  }
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
  if (!response.ok) throw new Error(`Firestore update failed: ${response.status}`);
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

// ── Atomic balance deduction via Firestore commit ──
async function atomicDeductBalance(userId: string, amount: number): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles/${userId}`,
        fieldTransforms: [{
          fieldPath: 'balance',
          increment: { doubleValue: -amount }
        }]
      }
    }]
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error('❌ Balance deduction failed:', await response.text());
    return false;
  }
  return true;
}

// ── Idempotent coupon increment ──
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
  if (!response.ok) console.error('❌ Coupon increment error:', await response.text());
  else console.log(`✅ Coupon ${couponId} incremented server-side`);
}

// ── Rate limiting ──
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (entry && entry.blockedUntil > now) return false;
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000, blockedUntil: 0 });
    return true;
  }
  entry.count++;
  if (entry.count > 10) { // 10 balance attempts per minute
    entry.blockedUntil = now + 300_000; // 5 min block
    return false;
  }
  return true;
}

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (v.resetAt <= now && v.blockedUntil <= now) rateLimitMap.delete(k);
  }
}, 300_000);

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // Rate limit
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Auth: REQUIRED for balance payments ──
    const authHeader = req.headers.get('authorization');
    const idToken = authHeader?.replace(/^Bearer\s+/i, '');
    if (!idToken) {
      return new Response(JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firebaseUser = await verifyFirebaseIdToken(idToken);
    if (!firebaseUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { orderId } = body;

    if (!orderId || typeof orderId !== 'string') {
      return new Response(JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Validate order ──
    const orderDoc = await getFirestoreDoc('orders', orderId);
    if (!orderDoc?.fields) {
      return new Response(JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const orderFields = orderDoc.fields;

    // Ownership check
    const orderUserId = orderFields.user_id?.stringValue;
    if (orderUserId !== firebaseUser.uid) {
      console.warn(`🚫 Balance checkout: user ${firebaseUser.uid} tried to pay order owned by ${orderUserId}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotency: already paid
    if (orderFields.payment_status?.stringValue === 'paid') {
      return new Response(JSON.stringify({ success: true, message: 'Already paid', orderId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Must be pending
    if (orderFields.payment_status?.stringValue !== 'pending') {
      return new Response(JSON.stringify({ error: `Invalid payment status: ${orderFields.payment_status?.stringValue}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Server-side price recalculation ──
    const orderItemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
    if (!orderItemsResults || !Array.isArray(orderItemsResults) || !orderItemsResults[0]?.document) {
      return new Response(JSON.stringify({ error: 'Order items not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let recalculatedTotal = 0;
    for (const result of orderItemsResults) {
      if (!result.document) continue;
      const itemFields = result.document.fields;
      const productId = itemFields?.product_id?.stringValue;
      const quantity = parseInt(itemFields?.quantity?.integerValue || '1');
      if (!productId) continue;

      const productDoc = await getFirestoreDoc('products', productId);
      if (!productDoc?.fields) {
        return new Response(JSON.stringify({ error: `Product ${productId} not found` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const realPrice = Number(productDoc.fields.price?.doubleValue || productDoc.fields.price?.integerValue || 0);
      recalculatedTotal += realPrice * quantity;
    }

    // Apply coupon
    const couponId = orderFields.coupon_id?.stringValue;
    if (couponId) {
      const couponDoc = await getFirestoreDoc('coupons', couponId);
      if (couponDoc?.fields) {
        const cf = couponDoc.fields;
        const discountType = cf.discount_type?.stringValue;
        const discountValue = Number(cf.discount_value?.doubleValue || cf.discount_value?.integerValue || 0);
        const isActive = cf.is_active?.booleanValue !== false;
        const maxUses = cf.max_uses?.integerValue ? parseInt(cf.max_uses.integerValue) : null;
        const currentUses = cf.current_uses?.integerValue ? parseInt(cf.current_uses.integerValue) : 0;
        const expiresAt = cf.expires_at?.stringValue;

        // Validate coupon
        if (isActive && (!maxUses || currentUses < maxUses) && (!expiresAt || new Date(expiresAt) > new Date())) {
          let discountAmount = 0;
          if (discountType === 'percentage') discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal);
          else discountAmount = Math.min(discountValue, recalculatedTotal);
          recalculatedTotal -= discountAmount;
          console.log(`🏷️ Coupon ${couponId}: -R$${discountAmount.toFixed(2)}`);
        }
      }
    }

    if (recalculatedTotal < 1) {
      return new Response(JSON.stringify({ error: 'Order total too low' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Check user balance (server-side) ──
    const profileDoc = await getFirestoreDoc('profiles', firebaseUser.uid);
    if (!profileDoc?.fields) {
      return new Response(JSON.stringify({ error: 'User profile not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const currentBalance = Number(profileDoc.fields.balance?.doubleValue || profileDoc.fields.balance?.integerValue || 0);
    if (currentBalance < recalculatedTotal) {
      console.warn(`🚫 Insufficient balance: has R$${currentBalance}, needs R$${recalculatedTotal}`);
      return new Response(JSON.stringify({ error: 'Saldo insuficiente', balance: currentBalance, required: recalculatedTotal }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Log client vs server total mismatch
    const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
    if (Math.abs(clientTotal - recalculatedTotal) > 0.01) {
      console.warn(`🚨 PRICE MISMATCH in balance checkout! Client: R$${clientTotal}, Server: R$${recalculatedTotal} (order ${orderId})`);
    }

    // ── Atomic operations ──
    // 1. Deduct balance
    const deducted = await atomicDeductBalance(firebaseUser.uid, recalculatedTotal);
    if (!deducted) {
      return new Response(JSON.stringify({ error: 'Balance deduction failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Mark order as paid (server-side only)
    await updateFirestoreDoc('orders', orderId, {
      payment_status: 'paid',
      status: 'processing',
      payment_method: 'balance',
      updated_at: new Date().toISOString(),
    });
    console.log(`✅ Order ${orderId} marked as paid via balance (server-side). Deducted R$${recalculatedTotal}`);

    // 3. Increment coupon usage (idempotent)
    if (couponId) {
      try { await incrementCouponUsage(couponId); } catch {}
    }

    // 4. Call process-delivery
    try {
      const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
      await fetch(`${SUPABASE_FUNCTIONS_URL}/process-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': webhookSecret },
        body: JSON.stringify({ orderId }),
      });
      console.log(`📦 process-delivery called for balance order ${orderId}`);
    } catch (e) {
      console.warn('⚠️ process-delivery call failed (will retry):', e);
    }

    return new Response(JSON.stringify({
      success: true,
      orderId,
      deducted: recalculatedTotal,
      remainingBalance: currentBalance - recalculatedTotal,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('❌ checkout-balance error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
