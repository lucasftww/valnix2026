import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * checkout-balance — Server-side balance payment handler (hardened v2)
 *
 * Security model:
 * 1. Verify Firebase auth token
 * 2. Acquire distributed lock (balance_locks/{uid}, TTL 30s) → prevents double-spend race
 * 3. Validate order exists, belongs to user, is pending
 * 4. Recalculate total from real product prices (never trust client)
 * 5. Validate coupon server-side
 * 6. Check user has sufficient balance
 * 7. Set order to processing_balance (intermediate state)
 * 8. Atomically deduct balance
 * 9. Mark order as paid — if this fails, ROLLBACK balance
 * 10. Idempotent coupon increment via coupon_use_events/{orderId}
 * 11. Call process-delivery
 * 12. Release lock in finally
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
const LOCK_TTL_MS = 30_000;
const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_ALLOWED_BALANCE = 200; // 🔒 Defense-in-depth: reject suspiciously high balances

/** Round to 2 decimal places to avoid floating point drift */
function roundCents(v: number): number {
  return Math.round(v * 100) / 100;
}

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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const res = await fetch(`${firestoreBase}/${col}/${docId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function createFirestoreDoc(col: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const firestoreFields = toFirestoreFields(fields);
  const res = await fetch(`${firestoreBase}/${col}?documentId=${docId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
  return res;
}

async function deleteFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  await fetch(`${firestoreBase}/${col}/${docId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
}

async function updateFirestoreDoc(col: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const firestoreFields = toFirestoreFields(fields);
  const res = await fetch(`${firestoreBase}/${col}/${docId}?${fieldPaths}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
  if (!res.ok) throw new Error(`Firestore update failed: ${res.status} ${await res.text()}`);
  return true;
}

function toFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') out[key] = { stringValue: value };
    else if (typeof value === 'number') out[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    else if (typeof value === 'boolean') out[key] = { booleanValue: value };
    else if (value === null || value === undefined) out[key] = { nullValue: null };
    else out[key] = { stringValue: String(value) };
  }
  return out;
}

async function queryFirestore(collectionId: string, fieldPath: string, op: string, value: string) {
  const accessToken = await getFirebaseAccessToken();
  const res = await fetch(`${firestoreBase}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op, value: { stringValue: value } } },
      },
    }),
  });
  return await res.json();
}

async function addFirestoreDoc(col: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const firestoreFields = toFirestoreFields(data);
  await fetch(`${firestoreBase}/${col}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
}

/** Create doc with specific ID — returns true if created, false if already exists (409) */
async function addFirestoreDocWithId(col: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const firestoreFields = toFirestoreFields(data);
  const res = await fetch(`${firestoreBase}/${col}?documentId=${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: firestoreFields }),
  });
  if (res.status === 409) return false;
  return res.ok;
}

async function invokeEdgeFunction(functionName: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`⚠️ ${functionName} returned ${res.status}`);
    return res;
  } catch (e) {
    console.warn(`⚠️ ${functionName} invoke error:`, e);
    return null;
  }
}

// ── Distributed lock via Firestore (balance_locks/{uid}) ──
async function acquireLock(userId: string, meta: { orderId: string; ip: string }): Promise<boolean> {
  // Check existing lock
  const existing = await getFirestoreDoc('balance_locks', userId);
  if (existing?.fields) {
    const lockedAt = existing.fields.locked_at?.stringValue;
    if (lockedAt) {
      const elapsed = Date.now() - new Date(lockedAt).getTime();
      if (elapsed < LOCK_TTL_MS) {
        return false; // Lock still active
      }
      // Expired lock — delete and re-acquire
      await deleteFirestoreDoc('balance_locks', userId);
    }
  }

  // Try to create lock (POST with documentId= → 409 if already exists)
  const res = await createFirestoreDoc('balance_locks', userId, {
    locked_at: new Date().toISOString(),
    locked_by: userId,
    order_id: meta.orderId,
    ip: meta.ip,
    ttl_ms: LOCK_TTL_MS,
  });

  if (res.status === 409) return false;
  return res.ok;
}

async function releaseLock(userId: string) {
  try {
    await deleteFirestoreDoc('balance_locks', userId);
  } catch (e) {
    console.warn('⚠️ Failed to release balance lock:', e);
  }
}

// ── Atomic balance operations via Firestore commit ──
async function atomicBalanceIncrement(userId: string, amount: number): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const res = await fetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles/${userId}`,
          fieldTransforms: [{ fieldPath: 'balance', increment: { doubleValue: amount } }],
        },
      }],
    }),
  });
  if (!res.ok) {
    console.error('❌ Balance increment failed:', await res.text());
    return false;
  }
  return true;
}

// ── Idempotent coupon increment via coupon_use_events/{orderId} ──
async function idempotentCouponIncrement(couponId: string, orderId: string) {
  // Check if already incremented for this order
  const existing = await getFirestoreDoc('coupon_use_events', orderId);
  if (existing?.fields) {
    console.log(`⏭️ Coupon ${couponId} already incremented for order ${orderId}`);
    return;
  }

  // Record the event first (acts as idempotency key)
  const createRes = await createFirestoreDoc('coupon_use_events', orderId, {
    coupon_id: couponId,
    used_at: new Date().toISOString(),
  });

  if (createRes.status === 409) {
    console.log(`⏭️ Coupon use event already exists for order ${orderId} (concurrent)`);
    return;
  }

  // Now increment
  const accessToken = await getFirebaseAccessToken();
  const res = await fetch(`${firestoreBase}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/coupons/${couponId}`,
          fieldTransforms: [{ fieldPath: 'current_uses', increment: { integerValue: "1" } }],
        },
      }],
    }),
  });

  if (!res.ok) console.error('❌ Coupon increment error:', await res.text());
  else console.log(`✅ Coupon ${couponId} incremented for order ${orderId}`);
}

// ── Rate limiting (Firestore-backed, ATOMIC — consistent with PIX/Card) ──
const RATE_LIMIT_DOC_BASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;

async function checkRateLimitFirestore(key: string, maxAttempts: number, windowMs: number, blockMs: number): Promise<{ allowed: boolean; attempts: number }> {
  const docId = key.replace(/[\/\.]/g, '_');
  const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
  const now = Date.now();
  const accessToken = await getFirebaseAccessToken();

  try {
    const doc = await getFirestoreDoc('rate_limits', docId);
    const fields = doc?.fields || null;

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
              created_at: { timestampValue: new Date().toISOString() },
            },
          },
        }],
      }),
    });
    if (!resetRes.ok) console.warn(`⚠️ Rate limit reset failed: ${resetRes.status}`);

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
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // 🔒 Rate limit balance payment per IP (Firestore-backed, consistent with PIX/Card)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlResult = await checkRateLimitFirestore(`balance_${clientIp}`, 10, 60_000, 300_000);
    if (!rlResult.allowed) {
      console.warn(`🛡️ Rate limit block: checkout-balance | IP: ${clientIp} | Attempts: ${rlResult.attempts}`);
      return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Auth ──
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

    if (!orderId || typeof orderId !== 'string' || orderId.length > 128) {
      return new Response(JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const clientIpForLock = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // ══════════════════════════════════════════════
    // STEP 1: Acquire distributed lock
    // ══════════════════════════════════════════════
    const lockAcquired = await acquireLock(firebaseUser.uid, { orderId, ip: clientIpForLock });
    if (!lockAcquired) {
      return new Response(JSON.stringify({ error: 'Pagamento em processamento. Aguarde.', retry_after_seconds: 5 }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '5' } });
    }

    try {
      // ══════════════════════════════════════════════
      // STEP 2: Validate order
      // ══════════════════════════════════════════════
      const orderDoc = await getFirestoreDoc('orders', orderId);
      if (!orderDoc?.fields) {
        return new Response(JSON.stringify({ error: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const orderFields = orderDoc.fields;

      // Ownership
      if (orderFields.user_id?.stringValue !== firebaseUser.uid) {
        console.warn(`🚫 Balance: user ${firebaseUser.uid} tried order owned by ${orderFields.user_id?.stringValue}`);
        return new Response(JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Idempotency: already paid
      const currentPaymentStatus = orderFields.payment_status?.stringValue;
      if (currentPaymentStatus === 'paid') {
        // Return fresh balance for UI
        const freshProfile = await getFirestoreDoc('profiles', firebaseUser.uid);
        const freshBalance = roundCents(Number(freshProfile?.fields?.balance?.doubleValue || freshProfile?.fields?.balance?.integerValue || 0));
        return new Response(JSON.stringify({ success: true, message: 'Already paid', orderId, remainingBalance: freshBalance }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Must be pending (not processing_balance from another concurrent attempt)
      if (currentPaymentStatus !== 'pending') {
        return new Response(JSON.stringify({ error: `Invalid status: ${currentPaymentStatus}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ══════════════════════════════════════════════
      // STEP 3: Server-side price recalculation
      // ══════════════════════════════════════════════
      const orderItemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
      if (!orderItemsResults || !Array.isArray(orderItemsResults) || !orderItemsResults[0]?.document) {
        return new Response(JSON.stringify({ error: 'Order items not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let subtotalAmount = 0;
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
        subtotalAmount += realPrice * quantity;
      }

      subtotalAmount = roundCents(subtotalAmount);

      // Apply coupon
      let discountAmount = 0;
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

          if (isActive && (!maxUses || currentUses < maxUses) && (!expiresAt || new Date(expiresAt) > new Date())) {
            if (discountType === 'percentage') discountAmount = Math.min(subtotalAmount * (discountValue / 100), subtotalAmount);
            else discountAmount = Math.min(discountValue, subtotalAmount);
            discountAmount = roundCents(discountAmount);
            console.log(`🏷️ Coupon ${couponId}: -R$${discountAmount.toFixed(2)}`);
          }
        }
      }

      const recalculatedTotal = roundCents(subtotalAmount - discountAmount);

      if (recalculatedTotal < 1) {
        return new Response(JSON.stringify({ error: 'Order total too low' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ══════════════════════════════════════════════
      // STEP 4: Check balance
      // ══════════════════════════════════════════════
      const profileDoc = await getFirestoreDoc('profiles', firebaseUser.uid);
      if (!profileDoc?.fields) {
        return new Response(JSON.stringify({ error: 'User profile not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const currentBalance = roundCents(Number(profileDoc.fields.balance?.doubleValue || profileDoc.fields.balance?.integerValue || 0));
      
      // 🔒 Defense-in-depth: reject suspiciously high balances (likely manipulated)
      if (currentBalance > MAX_ALLOWED_BALANCE) {
        console.warn(`🚨 SUSPICIOUS BALANCE: user ${firebaseUser.uid} has R$${currentBalance} (max allowed: R$${MAX_ALLOWED_BALANCE})`);
        return new Response(JSON.stringify({ error: 'Saldo inválido. Entre em contato com o suporte.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      if (currentBalance < recalculatedTotal) {
        return new Response(JSON.stringify({ error: 'Saldo insuficiente', balance: currentBalance, required: recalculatedTotal }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ══════════════════════════════════════════════
      // STEP 5: Set intermediate state (processing_balance)
      // ══════════════════════════════════════════════
      await updateFirestoreDoc('orders', orderId, {
        payment_status: 'processing_balance',
        updated_at: new Date().toISOString(),
      });

      // ══════════════════════════════════════════════
      // STEP 6: Deduct balance
      // ══════════════════════════════════════════════
      const deducted = await atomicBalanceIncrement(firebaseUser.uid, -recalculatedTotal);
      if (!deducted) {
        // Rollback: restore order to pending
        await updateFirestoreDoc('orders', orderId, { payment_status: 'pending', updated_at: new Date().toISOString() });
        return new Response(JSON.stringify({ error: 'Balance deduction failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ══════════════════════════════════════════════
      // STEP 7: Mark paid — if fails, ROLLBACK balance
      // ══════════════════════════════════════════════
      try {
        await updateFirestoreDoc('orders', orderId, {
          payment_status: 'paid',
          status: 'processing',
          payment_method: 'balance',
          subtotal_amount: subtotalAmount,
          discount_amount: discountAmount,
          total_amount: recalculatedTotal,
          currency: 'BRL',
          updated_at: new Date().toISOString(),
        });
        console.log(`✅ Order ${orderId} paid via balance. Sub:R$${subtotalAmount} Disc:R$${discountAmount} Total:R$${recalculatedTotal}`);
      } catch (markPaidError) {
        // COMPENSATE: refund balance
        console.error(`❌ Failed to mark paid, refunding R$${recalculatedTotal}:`, markPaidError);
        const refunded = await atomicBalanceIncrement(firebaseUser.uid, recalculatedTotal);
        if (refunded) {
          await updateFirestoreDoc('orders', orderId, { payment_status: 'pending', updated_at: new Date().toISOString() });
          console.log(`🔄 Refunded R$${recalculatedTotal} and restored order to pending`);
        } else {
          // Critical: manual intervention needed
          console.error(`🚨 CRITICAL: Refund ALSO failed for user ${firebaseUser.uid}, order ${orderId}, amount R$${recalculatedTotal}`);
          await updateFirestoreDoc('orders', orderId, {
            payment_status: 'error_needs_refund',
            notes: `Auto-refund failed. Amount: R$${recalculatedTotal.toFixed(2)}`,
            updated_at: new Date().toISOString(),
          });
        }
        return new Response(JSON.stringify({ error: 'Payment processing failed, balance restored' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ══════════════════════════════════════════════
      // STEP 8: Idempotent coupon increment
      // ══════════════════════════════════════════════
      if (couponId) {
        try { await idempotentCouponIncrement(couponId, orderId); } catch {}
      }

      // ══════════════════════════════════════════════
      // STEP 9: Call process-delivery
      // ══════════════════════════════════════════════
      try {
        const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
        await fetch(`${SUPABASE_FUNCTIONS_URL}/process-delivery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': webhookSecret },
          body: JSON.stringify({ orderId }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
      } catch (e) {
        console.warn('⚠️ process-delivery call failed/timeout (will retry):', e);
      }

      // ══════════════════════════════════════════════
      // STEP 10: Server-side tracking (Analytics + Meta CAPI + UTMify)
      // ══════════════════════════════════════════════
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

      const customerName = orderFields.customer_name?.stringValue || '';
      const customerEmail = orderFields.customer_email?.stringValue || '';
      const customerPhone = orderFields.customer_phone?.stringValue || '';

      // Analytics event
      try {
        await addFirestoreDoc('analytics_events', {
          event_name: 'Purchase',
          event_time: new Date().toISOString(),
          user_id: firebaseUser.uid,
          value: recalculatedTotal,
          currency: 'BRL',
          order_id: orderId,
          page_url: 'https://www.valnix.com.br/checkout',
          content_name: productNamesList,
        });
        console.log(`📊 Analytics Purchase event registered for balance order ${orderId}`);
      } catch {}

      // Meta CAPI (idempotent via meta_purchase_events/{orderId})
      const nameParts = customerName.split(' ');
      try {
        const capiGuardRes = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'balance' });
        if (capiGuardRes) {
          await invokeEdgeFunction('meta-capi', {
            event_name: 'Purchase',
            event_id: `purchase_${orderId}`,
            order_id: orderId,
            value: recalculatedTotal,
            currency: 'BRL',
            content_name: productNamesList,
            email: customerEmail,
            phone: customerPhone || undefined,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(' ') || undefined,
            external_id: firebaseUser.uid,
            fbc: orderFields.fbc?.stringValue,
            fbp: orderFields.fbp?.stringValue,
          });
          console.log(`📡 Meta CAPI Purchase sent for balance order ${orderId}`);
        } else {
          console.log(`ℹ️ Meta CAPI Purchase already sent for balance order ${orderId}, skipping`);
        }
      } catch (e) { console.warn('⚠️ Meta CAPI balance error:', e); }

      // UTMify
      try {
        await invokeEdgeFunction('utmify-event', {
          order_id: orderId,
          event_type: 'Purchase',
          value: recalculatedTotal,
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
        console.log(`📡 UTMify Purchase sent for balance order ${orderId}`);
      } catch (e) { console.warn('⚠️ UTMify balance error:', e); }

      return new Response(JSON.stringify({
        success: true,
        orderId,
        deducted: recalculatedTotal,
        remainingBalance: currentBalance - recalculatedTotal,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } finally {
      // ALWAYS release lock
      await releaseLock(firebaseUser.uid);
    }

  } catch (error: unknown) {
    console.error('❌ checkout-balance error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
