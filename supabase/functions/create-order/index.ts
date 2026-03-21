import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE, verifyFirebaseIdToken } from '../_shared/firebase.ts';
import { addFirestoreDoc } from '../_shared/firestore.ts';
import { checkRateLimitFirestore, logRateLimitBlock } from '../_shared/rate-limit.ts';

// In-memory cache for product data
const productMemCache = new Map<string, { fields: Record<string, any>; expiresAt: number }>();
const PRODUCT_CACHE_TTL = 10 * 60_000;

async function getFirestoreDoc(col: string, docId: string, retries = 3): Promise<Record<string, any> | null> {
  if (col === 'products') { const cached = productMemCache.get(docId); if (cached && Date.now() < cached.expiresAt) return cached.fields; }
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.ok) { const data = await res.json(); const fields = data.fields || null; if (col === 'products' && fields) productMemCache.set(docId, { fields, expiresAt: Date.now() + PRODUCT_CACHE_TTL }); return fields; }
    if (res.status === 429 && attempt < retries) { const delay = Math.min((attempt + 1) * 2000, 8000); console.warn(`⚠️ Firestore 429 for ${col}/${docId}, retrying in ${delay}ms`); await new Promise(r => setTimeout(r, delay)); continue; }
    if (res.status === 404) return null;
    console.error(`❌ getFirestoreDoc ${col}/${docId} failed: ${res.status}`);
    if (res.status === 429) throw new Error(`Firestore quota exceeded reading ${col}/${docId}`);
    return null;
  }
  return null;
}

const BLOCKED_EMAILS = new Set(["rodrigofaro@gmail.com", "test_redteam@gmail.com", "silvacarolinem7@gmail.com", "lucky_pentester@example.com"]);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req, { methods: "POST, OPTIONS" });
  if (!cors) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
    const { order, items } = body;
    if (!order || !items || !Array.isArray(items) || items.length === 0) return new Response(JSON.stringify({ error: 'Missing order or items data' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const authHeader = req.headers.get('Authorization');

    const [rlResult, callerUid, productResults, couponFields] = await Promise.all([
      checkRateLimitFirestore(`order_${clientIp}`, 15, 60_000, 300_000),
      (async (): Promise<string | null> => { if (authHeader?.startsWith('Bearer ')) { const verified = await verifyFirebaseIdToken(authHeader.slice(7)); return verified?.uid || null; } return null; })(),
      Promise.all(items.map((item: any) => { const productId = String(item.product_id || ''); return productId ? getFirestoreDoc('products', productId).then(fields => ({ productId, fields })) : Promise.resolve({ productId, fields: null }); })),
      order.coupon_id ? getFirestoreDoc('coupons', String(order.coupon_id)) : Promise.resolve(null),
    ]);

    if (!rlResult.allowed) { logRateLimitBlock('create-order', clientIp, rlResult.attempts); return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    const userId = order.user_id || '';
    if (callerUid && userId !== callerUid) { console.warn(`🚨 create-order: REJECTED user_id mismatch`); return new Response(JSON.stringify({ error: 'User ID mismatch' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    if (!order.customer_name || typeof order.customer_name !== 'string' || order.customer_name.trim().length < 2) return new Response(JSON.stringify({ error: 'Invalid customer name' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (!order.customer_email || typeof order.customer_email !== 'string') return new Response(JSON.stringify({ error: 'Invalid customer email' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (BLOCKED_EMAILS.has(String(order.customer_email).toLowerCase().trim())) { console.warn(`🚨 BLOCKED order from banned email: ${order.customer_email}`); return new Response(JSON.stringify({ error: 'Account suspended' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }); }

    const productCache = new Map<string, Record<string, unknown>>();
    let recalculatedTotal = 0;
    for (const { productId, fields } of productResults) {
      if (!productId) return new Response(JSON.stringify({ error: 'Invalid product_id in items' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      if (!fields) return new Response(JSON.stringify({ error: `Product ${productId} not found` }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      productCache.set(productId, fields);
      const item = items.find((i: any) => String(i.product_id) === productId);
      const quantity = Number(item?.quantity) || 1;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return new Response(JSON.stringify({ error: 'Invalid quantity (must be 1-100)' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      recalculatedTotal += Number(fields.price?.doubleValue || fields.price?.integerValue || 0) * quantity;
    }

    let discountAmount = 0;
    if (order.coupon_id && couponFields) {
      const discountType = couponFields.discount_type?.stringValue; const discountValue = Number(couponFields.discount_value?.doubleValue || couponFields.discount_value?.integerValue || 0);
      const isActive = couponFields.is_active?.booleanValue !== false; const maxUses = couponFields.max_uses?.integerValue ? parseInt(couponFields.max_uses.integerValue) : null; const currentUses = couponFields.current_uses?.integerValue ? parseInt(couponFields.current_uses.integerValue) : 0; const expiresAt = couponFields.expires_at?.stringValue;
      if (isActive && (!maxUses || currentUses < maxUses) && (!expiresAt || new Date(expiresAt) > new Date())) {
        if (discountType === 'percentage') discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal);
        else discountAmount = Math.min(discountValue, recalculatedTotal);
      }
    }
    const serverTotal = Math.round((recalculatedTotal - discountAmount) * 100) / 100;
    if (serverTotal < 0.01) return new Response(JSON.stringify({ error: 'Order total too low' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    const clientTotal = Number(order.total_amount) || 0;
    if (Math.abs(clientTotal - serverTotal) > 0.01) console.warn(`🚨 CREATE-ORDER PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${serverTotal}`);

    const now = new Date().toISOString(); const orderId = crypto.randomUUID();
    const hashChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let guestHash = ''; for (let i = 0; i < 12; i++) guestHash += hashChars.charAt(Math.floor(Math.random() * hashChars.length));
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 30);
    const customerDocument = order.customer_document
      ? String(order.customer_document).replace(/\D/g, '').slice(0, 14)
      : order.customer_cpf
        ? String(order.customer_cpf).replace(/\D/g, '').slice(0, 14)
        : null;

    const orderData: Record<string, unknown> = {
      user_id: userId, customer_name: String(order.customer_name).trim().slice(0, 200), customer_email: String(order.customer_email).trim().slice(0, 255),
      customer_phone: order.customer_phone ? String(order.customer_phone).trim().slice(0, 30) : null, total_amount: serverTotal,
      customer_document: customerDocument,
      subtotal_amount: Math.round(recalculatedTotal * 100) / 100, discount_amount: Math.round(discountAmount * 100) / 100,
      notes: order.notes ? String(order.notes).slice(0, 500) : null, status: 'pending', payment_status: 'pending',
      payment_method: order.payment_method ? String(order.payment_method).slice(0, 20) : null, hash: guestHash,
      expires_at: expiresAt.toISOString(), guest_session_id: userId.startsWith('guest_') ? userId : null,
      linked: !userId.startsWith('guest_'), coupon_id: order.coupon_id ? String(order.coupon_id) : null,
      coupon_code: order.coupon_code ? String(order.coupon_code) : null,
      fbc: order.fbc || null, fbp: order.fbp || null, event_source_url: order.event_source_url || null,
      utm_source: order.utm_source || null, utm_medium: order.utm_medium || null, utm_campaign: order.utm_campaign || null,
      utm_content: order.utm_content || null, utm_term: order.utm_term || null,
      shipping_address: null, shipping_method: null, tracking_code: null, created_at: now, updated_at: now,
    };

    const accessToken = await getFirebaseAccessToken();
    const guestFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(orderData)) {
      if (v === null || v === undefined) guestFields[k] = { nullValue: null };
      else if (typeof v === 'string') guestFields[k] = { stringValue: v };
      else if (typeof v === 'number') guestFields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
      else if (typeof v === 'boolean') guestFields[k] = { booleanValue: v };
      else guestFields[k] = { stringValue: String(v) };
    }
    const orderDocUrl = `${FIRESTORE_BASE}/ordens/${orderId}`;
    const orderRes = await fetch(orderDocUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields: guestFields }) });
    if (!orderRes.ok) { console.error(`❌ Failed to create order ${orderId}:`, await orderRes.text()); return new Response(JSON.stringify({ error: 'Failed to create order' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
    console.log(`✅ Order created: ${orderId} (hash: ${guestHash}) for user ${userId}`);

    await Promise.all(items.map(async (item: any, idx: number) => {
      const cachedProduct = productCache.get(String(item.product_id));
      const realItemPrice = cachedProduct ? Number(cachedProduct.price?.doubleValue || cachedProduct.price?.integerValue || 0) : 0;
      const productCategory = cachedProduct?.category?.stringValue || '';
      const itemQty = Number(item.quantity) || 1;
      const itemFields: Record<string, unknown> = {
        product_name: { stringValue: String(item.product_name || '').slice(0, 200) }, product_image: item.product_image ? { stringValue: String(item.product_image) } : { nullValue: null },
        product_id: { stringValue: String(item.product_id || '') }, quantity: { integerValue: String(itemQty) },
        unit_price: { doubleValue: realItemPrice }, total_price: { doubleValue: Math.round(realItemPrice * itemQty * 100) / 100 },
        product_category: productCategory ? { stringValue: productCategory } : { nullValue: null },
        delivery_code: { nullValue: null }, delivery_type: { stringValue: item.delivery_type || 'manual' },
        order_id: { stringValue: orderId }, created_at: { stringValue: now },
      };
      const itemUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items/${idx}`;
      const itemRes = await fetch(itemUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields: itemFields }) });
      if (!itemRes.ok) console.warn(`⚠️ ordens/${orderId}/items/${idx} write failed: ${itemRes.status}`);
    }));
    console.log(`✅ ${items.length} items created for order ${orderId}`);
    return new Response(JSON.stringify({ success: true, orderId, guestHash }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('❌ create-order error:', err);
    const isQuota = err?.message?.includes('quota') || err?.message?.includes('429');
    return new Response(JSON.stringify({ error: isQuota ? 'Serviço temporariamente indisponível.' : 'Internal server error' }), { status: isQuota ? 503 : 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
