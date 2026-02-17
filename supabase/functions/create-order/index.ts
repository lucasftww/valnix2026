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
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const FIREBASE_PROJECT_ID = 'valnix';

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
async function addFirestoreDoc(col: string, data: Record<string, unknown>): Promise<string | null> {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}`;
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
  if (!res.ok) {
    console.error(`❌ Firestore add failed for ${col}:`, await res.text());
    return null;
  }
  const result = await res.json();
  const name = result.name || '';
  const parts = name.split('/');
  return parts[parts.length - 1] || null;
}

// In-memory cache for product data (survives across requests in same isolate)
const productMemCache = new Map<string, { fields: Record<string, any>; expiresAt: number }>();
const PRODUCT_CACHE_TTL = 10 * 60_000; // 10 minutes

async function getFirestoreDoc(col: string, docId: string, retries = 3): Promise<Record<string, any> | null> {
  // Check memory cache for products (most common read)
  if (col === 'products') {
    const cached = productMemCache.get(docId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.fields;
    }
  }

  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.ok) {
      const data = await res.json();
      const fields = data.fields || null;
      // Cache product reads
      if (col === 'products' && fields) {
        productMemCache.set(docId, { fields, expiresAt: Date.now() + PRODUCT_CACHE_TTL });
      }
      return fields;
    }
    if (res.status === 429 && attempt < retries) {
      const delay = Math.min((attempt + 1) * 2000, 8000); // 2s, 4s, 6s
      console.warn(`⚠️ Firestore 429 for ${col}/${docId}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (res.status === 404) return null;
    console.error(`❌ getFirestoreDoc ${col}/${docId} failed: ${res.status}`);
    if (res.status === 429) throw new Error(`Firestore quota exceeded reading ${col}/${docId}`);
    return null;
  }
  return null;
}

// Periodic cleanup of product cache
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of productMemCache) {
    if (v.expiresAt <= now) productMemCache.delete(k);
  }
}, 300_000);

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

// ── Blocked emails ──
const BLOCKED_EMAILS = new Set([
  "rodrigofaro@gmail.com",
  "test_redteam@gmail.com",
  "silvacarolinem7@gmail.com",
  "lucky_pentester@example.com",
]);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const { order, items } = body;

    if (!order || !items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing order or items data' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ── PARALLEL: Rate limit + Auth verification + Product reads + Coupon read ──
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const authHeader = req.headers.get('Authorization');

    const [rlResult, callerUid, productResults, couponFields] = await Promise.all([
      // 1. Rate limit check
      checkRateLimitFirestore(`order_${clientIp}`, 15, 60_000, 300_000),
      // 2. Auth verification (parallel)
      (async (): Promise<string | null> => {
        if (authHeader?.startsWith('Bearer ')) {
          const verified = await verifyFirebaseIdToken(authHeader.slice(7));
          return verified?.uid || null;
        }
        return null;
      })(),
      // 3. ALL product reads in parallel (was sequential before!)
      Promise.all(items.map((item: any) => {
        const productId = String(item.product_id || '');
        return productId ? getFirestoreDoc('products', productId).then(fields => ({ productId, fields })) : Promise.resolve({ productId, fields: null });
      })),
      // 4. Coupon read in parallel
      order.coupon_id ? getFirestoreDoc('coupons', String(order.coupon_id)) : Promise.resolve(null),
    ]);

    // Rate limit gate
    if (!rlResult.allowed) {
      logRateLimitBlock('create-order', clientIp, rlResult.attempts);
      return new Response(JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Ensure user_id matches caller (if authenticated) or is a guest id
    const userId = order.user_id || '';
    if (callerUid && userId !== callerUid) {
      console.warn(`🚨 create-order: REJECTED user_id mismatch. caller=${callerUid}, order.user_id=${userId}`);
      return new Response(JSON.stringify({ error: 'User ID mismatch' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Basic input validation
    if (!order.customer_name || typeof order.customer_name !== 'string' || order.customer_name.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'Invalid customer name' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!order.customer_email || typeof order.customer_email !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid customer email' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 🔒 Block banned emails from placing orders
    if (BLOCKED_EMAILS.has(String(order.customer_email).toLowerCase().trim())) {
      console.warn(`🚨 BLOCKED order attempt from banned email: ${order.customer_email}`);
      return new Response(JSON.stringify({ error: 'Account suspended' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 🔒 Server-side price recalculation — NEVER trust client total_amount
    const productCache = new Map<string, Record<string, unknown>>();
    let recalculatedTotal = 0;
    for (const { productId, fields } of productResults) {
      if (!productId) {
        return new Response(JSON.stringify({ error: 'Invalid product_id in items' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (!fields) {
        return new Response(JSON.stringify({ error: `Product ${productId} not found` }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      productCache.set(productId, fields);
      const item = items.find((i: any) => String(i.product_id) === productId);
      const quantity = Number(item?.quantity) || 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        return new Response(JSON.stringify({ error: 'Invalid quantity (must be 1-100)' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const realPrice = Number(fields.price?.doubleValue || fields.price?.integerValue || 0);
      recalculatedTotal += realPrice * quantity;
    }

    // Apply coupon discount server-side (already fetched in parallel)
    let discountAmount = 0;
    if (order.coupon_id && couponFields) {
      const discountType = couponFields.discount_type?.stringValue;
      const discountValue = Number(couponFields.discount_value?.doubleValue || couponFields.discount_value?.integerValue || 0);
      const isActive = couponFields.is_active?.booleanValue !== false;
      const maxUses = couponFields.max_uses?.integerValue ? parseInt(couponFields.max_uses.integerValue) : null;
      const currentUses = couponFields.current_uses?.integerValue ? parseInt(couponFields.current_uses.integerValue) : 0;
      const expiresAt = couponFields.expires_at?.stringValue;
      if (isActive && (!maxUses || currentUses < maxUses) && (!expiresAt || new Date(expiresAt) > new Date())) {
        if (discountType === 'percentage') discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal);
        else discountAmount = Math.min(discountValue, recalculatedTotal);
        console.log(`🏷️ Coupon ${order.coupon_id}: -R$${discountAmount.toFixed(2)}`);
      }
    }

    const serverTotal = Math.round((recalculatedTotal - discountAmount) * 100) / 100;
    if (serverTotal < 0.01) {
      return new Response(JSON.stringify({ error: 'Order total too low' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const clientTotal = Number(order.total_amount) || 0;
    if (Math.abs(clientTotal - serverTotal) > 0.01) {
      console.warn(`🚨 CREATE-ORDER PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${serverTotal}`);
    }

    const now = new Date().toISOString();

    // Create order document with SERVER-CALCULATED total
    const orderData: Record<string, unknown> = {
      user_id: userId,
      customer_name: String(order.customer_name).trim().slice(0, 200),
      customer_email: String(order.customer_email).trim().slice(0, 255),
      customer_phone: order.customer_phone ? String(order.customer_phone).trim().slice(0, 30) : null,
      total_amount: serverTotal,
      subtotal_amount: Math.round(recalculatedTotal * 100) / 100,
      discount_amount: Math.round(discountAmount * 100) / 100,
      notes: order.notes ? String(order.notes).slice(0, 500) : null,
      status: 'pending',
      payment_status: 'pending',
      payment_method: order.payment_method ? String(order.payment_method).slice(0, 20) : null,
      fbc: order.fbc || null,
      fbp: order.fbp || null,
      event_source_url: order.event_source_url || null,
      utm_source: order.utm_source || null,
      utm_medium: order.utm_medium || null,
      utm_campaign: order.utm_campaign || null,
      utm_content: order.utm_content || null,
      utm_term: order.utm_term || null,
      shipping_address: null,
      shipping_method: null,
      tracking_code: null,
      created_at: now,
      updated_at: now,
    };

    const orderId = await addFirestoreDoc('orders', orderData);
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Failed to create order' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    console.log(`✅ Order created: ${orderId} for user ${userId}`);

    // Create order items in PARALLEL (use cached product data — no extra reads)
    await Promise.all(items.map((item: any) => {
      const cachedProduct = productCache.get(String(item.product_id));
      const realItemPrice = cachedProduct ? Number(cachedProduct.price?.doubleValue || cachedProduct.price?.integerValue || 0) : 0;
      const itemQty = Number(item.quantity) || 1;
      const itemData: Record<string, unknown> = {
        order_id: orderId,
        product_id: String(item.product_id || ''),
        product_name: String(item.product_name || '').slice(0, 200),
        product_image: item.product_image || null,
        quantity: itemQty,
        unit_price: realItemPrice,
        total_price: Math.round(realItemPrice * itemQty * 100) / 100,
        delivery_code: null,
        delivery_type: item.delivery_type || 'manual',
        created_at: now,
      };
      return addFirestoreDoc('order_items', itemData);
    }));

    console.log(`✅ ${items.length} order items created for order ${orderId}`);

    // ── PARALLEL: Coupon save + Guest order creation ──────────────────
    let guestHash: string | null = null;

    const [, guestResult] = await Promise.allSettled([
      // 1. Save coupon info (fire-and-forget style)
      (async () => {
        if (!order.coupon_id || !order.coupon_code) return;
        const accessToken = await getFirebaseAccessToken();
        const fieldPaths = 'updateMask.fieldPaths=coupon_id&updateMask.fieldPaths=coupon_code';
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${orderId}?${fieldPaths}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({
            fields: {
              coupon_id: { stringValue: String(order.coupon_id) },
              coupon_code: { stringValue: String(order.coupon_code) },
            },
          }),
        });
        if (!res.ok) console.warn('⚠️ Failed to save coupon info:', res.status);
      })(),

      // 2. Create guest_order for /order/:hash access
      (async () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let hash = '';
        for (let i = 0; i < 12; i++) hash += chars.charAt(Math.floor(Math.random() * chars.length));

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const serverItemPrices = new Map<string, number>();
        for (const item of items) {
          const cached = productCache.get(String(item.product_id));
          if (cached) {
            serverItemPrices.set(String(item.product_id), Number(cached.price?.doubleValue || cached.price?.integerValue || 0));
          }
        }

        const guestOrderData: Record<string, unknown> = {
          order_id: orderId,
          email: String(order.customer_email).trim().toLowerCase(),
          customer_name: order.customer_name || null,
          customer_phone: order.customer_phone || null,
          guest_session_id: userId.startsWith('guest_') ? userId : null,
          user_id: userId.startsWith('guest_') ? null : userId,
          linked: !userId.startsWith('guest_'),
          total_amount: serverTotal,
          payment_method: order.payment_method || 'pix',
          created_at: now,
          expires_at: expiresAt.toISOString(),
        };

        const accessToken = await getFirebaseAccessToken();
        const guestFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(guestOrderData)) {
          if (v === null || v === undefined) guestFields[k] = { nullValue: null };
          else if (typeof v === 'string') guestFields[k] = { stringValue: v };
          else if (typeof v === 'number') guestFields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
          else if (typeof v === 'boolean') guestFields[k] = { booleanValue: v };
          else guestFields[k] = { stringValue: String(v) };
        }
        const guestDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/guest_orders/${hash}`;
        const guestRes = await fetch(guestDocUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({ fields: guestFields }),
        });
        if (!guestRes.ok) throw new Error(`guest_orders write failed: ${guestRes.status}`);

        // Write items to subcollection IN PARALLEL
        await Promise.all(items.map(async (it: any, idx: number) => {
          const realPrice = serverItemPrices.get(String(it.product_id)) || 0;
          const qty = Number(it.quantity) || 1;
          const itemFields: Record<string, unknown> = {
            product_name: { stringValue: String(it.product_name || '') },
            product_image: it.product_image ? { stringValue: String(it.product_image) } : { nullValue: null },
            product_id: { stringValue: String(it.product_id || '') },
            quantity: { integerValue: String(qty) },
            unit_price: { doubleValue: realPrice },
            total_price: { doubleValue: Math.round(realPrice * qty * 100) / 100 },
            delivery_code: { nullValue: null },
            order_id: { stringValue: orderId },
          };
          const itemUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/guest_orders/${hash}/items/${idx}`;
          const itemRes = await fetch(itemUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ fields: itemFields }),
          });
          if (!itemRes.ok) console.warn(`⚠️ guest_orders/${hash}/items/${idx} write failed: ${itemRes.status}`);
        }));

        console.log(`✅ Guest order saved with hash as docId: ${hash} (${items.length} items in subcollection)`);
        return hash;
      })(),
    ]);

    // Extract guestHash from settled result
    if (guestResult.status === 'fulfilled' && guestResult.value) {
      guestHash = guestResult.value as string;
    } else if (guestResult.status === 'rejected') {
      console.warn('⚠️ Failed to save guest order:', guestResult.reason);
    }

    return new Response(JSON.stringify({ success: true, orderId, guestHash }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('❌ create-order error:', err);
    const isQuota = err?.message?.includes('quota') || err?.message?.includes('429');
    return new Response(JSON.stringify({ error: isQuota ? 'Serviço temporariamente indisponível. Tente novamente em alguns segundos.' : 'Internal server error' }), {
      status: isQuota ? 503 : 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
