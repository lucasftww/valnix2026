import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * process-delivery — Single-writer auto-delivery endpoint
 * 
 * ALL delivery code consumption MUST go through this function.
 * No client-side code should ever read/write auto_delivery_codes.
 * 
 * Auth modes:
 *   - Firebase admin token (admin panel auto-verify)
 *   - Internal call (from PIX webhook/status fallback — no auth needed, signature validated upstream)
 *   - Client callback (CardPaymentCallback / Balance — validates payment status server-side)
 * 
 * Idempotency: Items with existing delivery_code are skipped.
 * Atomicity: Uses per-product locks to prevent concurrent code consumption.
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
  // Allow internal calls (no Origin header) from other edge functions
  const allowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || "*") : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key, x-delivery-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const FIREBASE_PROJECT_ID = 'valnix';

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
  if (!response.ok) {
    const errText = await response.text();
    console.error(`❌ Firestore update failed for ${col}/${docId}:`, errText);
    throw new Error(`Firestore update failed: ${response.status}`);
  }
  return true;
}

async function updateFirestoreArray(col: string, docId: string, fieldPath: string, values: Array<{ stringValue: string }>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}?updateMask.fieldPaths=${fieldPath}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: { [fieldPath]: { arrayValue: { values } } } }),
  });
  if (!response.ok) {
    console.error(`❌ Array update failed for ${col}/${docId}:`, await response.text());
    throw new Error(`Array update failed: ${response.status}`);
  }
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

// ── Per-product lock for atomic code consumption ──
const LOCK_TTL_MS = 30_000; // 30 seconds

async function acquireProductLock(productId: string): Promise<boolean> {
  const lockDoc = await getFirestoreDoc('delivery_locks', productId);
  if (lockDoc?.fields) {
    const lockTime = lockDoc.fields.locked_at?.stringValue;
    if (lockTime && (Date.now() - new Date(lockTime).getTime()) < LOCK_TTL_MS) {
      return false; // Lock is held
    }
  }
  // Acquire lock
  await updateFirestoreDoc('delivery_locks', productId, {
    locked_at: new Date().toISOString(),
    locked_by: 'process-delivery',
  });
  return true;
}

async function releaseProductLock(productId: string): Promise<void> {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/delivery_locks/${productId}`;
    await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
  } catch { /* best effort */ }
}

// ── Fake code generation ──
function generateFakeDeliveryCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
    if ((i + 1) % 4 === 0 && i < 15) result += '-';
  }
  return result;
}

// ── Internal auth validation ──
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

async function isAdmin(uid: string): Promise<boolean> {
  const roleDoc = await getFirestoreDoc('user_roles', uid);
  return roleDoc?.fields?.role?.stringValue === 'admin';
}

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { orderId } = body;

    if (!orderId) {
      return new Response(JSON.stringify({ success: false, error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Auth: accept internal key OR Firebase token OR order-scoped delivery token ──
    const internalKey = req.headers.get('x-internal-key');
    const expectedInternalKey = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
    const authHeader = req.headers.get('authorization');
    const idToken = authHeader?.replace(/^Bearer\s+/i, '');
    const deliveryToken = req.headers.get('x-delivery-token');

    let authSource = 'none';
    let callerUid: string | null = null;
    if (internalKey && internalKey === expectedInternalKey) {
      authSource = 'internal';
    } else if (idToken) {
      const user = await verifyFirebaseIdToken(idToken);
      if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      callerUid = user.uid;
      authSource = await isAdmin(user.uid) ? 'admin' : 'user';
    } else if (deliveryToken && deliveryToken.length >= 20) {
      // Order-scoped token — validated against order doc below (after fetching order)
      authSource = 'delivery_token';
    }

    // Only authenticated requests can trigger
    if (authSource === 'none') {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Validate order exists and is paid ──
    const orderDoc = await getFirestoreDoc('orders', orderId);
    if (!orderDoc?.fields) {
      return new Response(JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── SECURITY: validate auth against order ──
    if (authSource === 'user') {
      const orderUserId = orderDoc.fields.user_id?.stringValue;
      if (!orderUserId || orderUserId !== callerUid) {
        console.warn(`🚫 [${orderId}] User ${callerUid} tried to deliver order owned by ${orderUserId}`);
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your order' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else if (authSource === 'delivery_token') {
      const storedToken = orderDoc.fields.delivery_token?.stringValue;
      if (!storedToken || storedToken !== deliveryToken) {
        console.warn(`🚫 [${orderId}] Invalid delivery_token attempt`);
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: invalid delivery token' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // TTL: reject tokens older than 10 minutes
      const tokenCreatedAt = orderDoc.fields.delivery_token_created_at?.stringValue;
      if (tokenCreatedAt) {
        const ageMs = Date.now() - new Date(tokenCreatedAt).getTime();
        if (ageMs > 10 * 60 * 1000) {
          console.warn(`🚫 [${orderId}] delivery_token expired (age: ${Math.round(ageMs / 1000)}s)`);
          try { await updateFirestoreDoc('orders', orderId, { delivery_token: null }); } catch {}
          return new Response(JSON.stringify({ success: false, error: 'Forbidden: delivery token expired' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      // Anti-race: claim token with unique consumer ID, then verify ownership
      const consumerId = crypto.randomUUID();
      try {
        await updateFirestoreDoc('orders', orderId, {
          delivery_token: null,
          delivery_token_created_at: null,
          delivery_token_consumer: consumerId,
        });
      } catch (consumeErr) {
        // FAIL-CLOSED: cannot consume token → abort, no delivery
        console.error(`❌ [${orderId}] Failed to consume delivery_token — aborting`, consumeErr);
        return new Response(JSON.stringify({ success: false, error: 'Internal error: token consumption failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // Verify we won the race (last-writer-wins → only our consumerId should be there)
      const recheck = await getFirestoreDoc('orders', orderId);
      const actualConsumer = recheck?.fields?.delivery_token_consumer?.stringValue;
      if (actualConsumer !== consumerId) {
        console.warn(`🚫 [${orderId}] delivery_token race lost (winner: ${actualConsumer}, ours: ${consumerId})`);
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: token claimed by another request' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      console.log(`✅ [${orderId}] delivery_token validated, consumed by ${consumerId}`);
    }

    const paymentStatus = orderDoc.fields.payment_status?.stringValue;
    if (paymentStatus !== 'paid') {
      return new Response(JSON.stringify({ success: false, error: 'Order not paid', payment_status: paymentStatus }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Get order items ──
    const itemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
    if (!itemsResults || !Array.isArray(itemsResults)) {
      return new Response(JSON.stringify({ success: false, error: 'No order items found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: Array<{ itemId: string; productId: string; status: string; codes?: string }> = [];
    let allDelivered = true;
    let deliveredCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const result of itemsResults) {
      if (!result.document) continue;
      const itemFields = result.document.fields;
      const itemId = result.document.name.split('/').pop()!;

      // ── IDEMPOTENCY: skip already-delivered items ──
      if (itemFields?.delivery_code?.stringValue) {
        results.push({ itemId, productId: itemFields?.product_id?.stringValue || '', status: 'already_delivered', codes: itemFields.delivery_code.stringValue });
        skippedCount++;
        continue;
      }

      const productId = itemFields?.product_id?.stringValue;
      if (!productId) {
        results.push({ itemId, productId: 'unknown', status: 'no_product_id' });
        allDelivered = false;
        failedCount++;
        continue;
      }

      // Get product to check delivery type
      const productDoc = await getFirestoreDoc('products', productId);
      if (!productDoc?.fields) {
        results.push({ itemId, productId, status: 'product_not_found' });
        allDelivered = false;
        failedCount++;
        continue;
      }

      const deliveryType = productDoc.fields.delivery_type?.stringValue || 'manual';
      const quantity = itemFields?.quantity?.integerValue ? parseInt(itemFields.quantity.integerValue) : 1;

      if (deliveryType === 'auto_fake') {
        // Generate fake codes — no concurrency concern
        const codes: string[] = [];
        for (let i = 0; i < quantity; i++) codes.push(generateFakeDeliveryCode());
        const codeStr = codes.join(',');
        await updateFirestoreDoc('order_items', itemId, { delivery_code: codeStr, delivered_at: new Date().toISOString() });
        results.push({ itemId, productId, status: 'delivered', codes: codeStr });
        deliveredCount++;
        console.log(`✅ [${orderId}] auto_fake: ${codes.length} code(s) → item ${itemId}`);

      } else if (deliveryType === 'auto_real') {
        // ── ATOMIC: Lock product, consume codes, release ──
        let lockAcquired = false;
        let retries = 0;
        while (!lockAcquired && retries < 5) {
          lockAcquired = await acquireProductLock(productId);
          if (!lockAcquired) {
            retries++;
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
          }
        }

        if (!lockAcquired) {
          results.push({ itemId, productId, status: 'lock_timeout' });
          allDelivered = false;
          failedCount++;
          console.error(`❌ [${orderId}] Lock timeout for product ${productId}`);
          continue;
        }

        try {
          // Re-read product inside lock to get fresh codes
          const freshProduct = await getFirestoreDoc('products', productId);
          const autoCodesArray = freshProduct?.fields?.auto_delivery_codes?.arrayValue?.values;

          if (!autoCodesArray || autoCodesArray.length === 0) {
            results.push({ itemId, productId, status: 'no_codes_available' });
            allDelivered = false;
            failedCount++;
            console.warn(`⚠️ [${orderId}] No auto_delivery_codes for product ${productId}`);
            continue;
          }

          const neededCodes = Math.min(quantity, autoCodesArray.length);
          const usedCodes = autoCodesArray.slice(0, neededCodes).map((v: any) => v.stringValue);
          const remainingCodes = autoCodesArray.slice(neededCodes);

          const codeStr = usedCodes.join(',');

          // Step 1: Remove codes from product FIRST (prevents double-consumption)
          await updateFirestoreArray('products', productId, 'auto_delivery_codes', remainingCodes);

          // Step 2: Write delivery code to order_item
          try {
            await updateFirestoreDoc('order_items', itemId, { delivery_code: codeStr, delivered_at: new Date().toISOString() });
          } catch (writeErr) {
            // COMPENSATE: best-effort reinsert codes back into product
            console.error(`❌ [${orderId}] Failed to write delivery_code to item ${itemId}, compensating...`, writeErr);
            try {
              const reinsertCodes = [...usedCodes.map((c: string) => ({ stringValue: c })), ...remainingCodes];
              await updateFirestoreArray('products', productId, 'auto_delivery_codes', reinsertCodes);
              console.log(`🔄 [${orderId}] Compensated: ${usedCodes.length} code(s) reinserted into product ${productId}`);
            } catch (compErr) {
              console.error(`🚨 [${orderId}] COMPENSATION FAILED for product ${productId}! Codes may be lost:`, usedCodes, compErr);
            }
            results.push({ itemId, productId, status: 'failed' });
            allDelivered = false;
            failedCount++;
            continue;
          }

          results.push({ itemId, productId, status: 'delivered', codes: codeStr });
          deliveredCount++;
          console.log(`✅ [${orderId}] auto_real: ${usedCodes.length} code(s) → item ${itemId} (${remainingCodes.length} remaining)`);
        } finally {
          await releaseProductLock(productId);
        }

      } else {
        // Manual delivery — nothing to do automatically
        results.push({ itemId, productId, status: 'manual' });
        allDelivered = false;
      }
    }

    // ── Update order status if all items delivered ──
    const hasItems = results.length > 0;
    const allItemsHandled = allDelivered && hasItems && failedCount === 0;
    let orderStatus = orderDoc.fields.status?.stringValue || 'processing';

    if (allItemsHandled) {
      await updateFirestoreDoc('orders', orderId, { status: 'completed', updated_at: new Date().toISOString() });
      orderStatus = 'completed';
      console.log(`✅ [${orderId}] Order auto-completed (all ${deliveredCount} items delivered)`);
    }

    return new Response(JSON.stringify({
      success: true,
      orderId,
      orderStatus,
      deliveredCount,
      skippedCount,
      failedCount,
      items: results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('❌ process-delivery error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
