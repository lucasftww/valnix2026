import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE, verifyFirebaseIdToken } from '../_shared/firebase.ts';
import { getFirestoreDoc, updateFirestoreDoc, queryFirestore, addFirestoreDoc, addFirestoreDocWithId } from '../_shared/firestore.ts';
import { timingSafeEqual } from '../_shared/auth.ts';
import { checkRateLimitFirestore, logRateLimitBlock } from '../_shared/rate-limit.ts';
import { invokeEdgeFunction, idempotentCouponIncrement, generateEventId } from '../_shared/utils.ts';

const FLOWPAY_CARD_URL = 'https://flowpayments.net/api/card';

async function updateDocOrThrow(col: string, docId: string, data: Record<string, unknown>) {
  const ok = await updateFirestoreDoc(col, docId, data);
  if (!ok) throw new Error(`Firestore update failed: ${col}/${docId}`);
  return true;
}

async function getDocFields(col: string, docId: string): Promise<any> {
  const doc = await getFirestoreDoc(col, docId);
  return doc?.fields || null;
}

/** Extract rich item data from order items subcollection for Meta CAPI */
async function extractOrderItems(orderId: string): Promise<{
  productNamesList: string;
  contentIds: string[];
  contents: { id: string; quantity: number; item_price?: number }[];
}> {
  let productNamesList = `Pedido #${orderId.substring(0, 8)}`;
  const contentIds: string[] = [];
  const contents: { id: string; quantity: number; item_price?: number }[] = [];
  try {
    const at = await getFirebaseAccessToken();
    const iUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`;
    const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${at}` } });
    if (iRes.ok) {
      const iData = await iRes.json();
      const names: string[] = [];
      for (const d of (iData.documents || [])) {
        const f = d.fields || {};
        if (f.product_name?.stringValue) names.push(f.product_name.stringValue);
        const pid = f.product_id?.stringValue;
        if (pid) {
          contentIds.push(pid);
          const qty = Number(f.quantity?.integerValue || 1);
          const price = Number(f.unit_price?.doubleValue || f.unit_price?.integerValue || 0);
          contents.push({ id: pid, quantity: qty, ...(price > 0 ? { item_price: price } : {}) });
        }
      }
      if (names.length > 0) productNamesList = names.join(', ');
    }
  } catch {}
  return { productNamesList, contentIds, contents };
}

/** Build enriched meta-capi payload for Purchase event */
function buildMetaCapiPurchasePayload(
  eventId: string, orderId: string, orderValue: number, items: Awaited<ReturnType<typeof extractOrderItems>>,
  orderFields: any, customerEmail?: string, customerPhone?: string, customerName?: string, userId?: string,
) {
  const nameParts = (customerName || '').split(' ');
  return {
    event_name: 'Purchase', event_id: eventId, order_id: orderId, value: orderValue, currency: 'BRL',
    content_name: items.productNamesList,
    content_ids: items.contentIds.length > 0 ? items.contentIds : undefined,
    contents: items.contents.length > 0 ? items.contents : undefined,
    num_items: items.contents.length > 0 ? items.contents.reduce((s, c) => s + c.quantity, 0) : undefined,
    content_type: 'product',
    email: customerEmail, phone: customerPhone || undefined,
    first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined,
    external_id: userId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue,
    event_source_url: orderFields?.event_source_url?.stringValue || 'https://www.valnix.com.br/checkout',
  };
}

async function checkPendingOrderFlood(userId: string): Promise<boolean> {
  const rl = await checkRateLimitFirestore(`flood_${userId}`, 10, 3600_000, 3600_000);
  if (!rl.allowed) { console.warn(`🚨 ORDER FLOOD: user ${userId} exceeded 10 pending orders/hour`); return false; }
  return true;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-delivery-token, x-admin-token" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const apiKey = Deno.env.get('FLOWPAY_API_KEY');
    if (!apiKey) return new Response(JSON.stringify({ success: false, error: 'FlowPay API key not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // ==================== WEBHOOK ====================
    if (req.method === 'POST' && action === 'webhook') {
      console.log('🔔 FlowPay card webhook received');
      const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
      if (!webhookSecret) { console.error('❌ FLOWPAY_WEBHOOK_SECRET not configured'); return new Response(JSON.stringify({ error: 'Webhook authentication not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
      const receivedSecret = req.headers.get('x-webhook-secret') || req.headers.get('x-secret') || req.headers.get('authorization')?.replace('Bearer ', '') || req.headers.get('x-api-key');
      if (!receivedSecret || !timingSafeEqual(receivedSecret, webhookSecret)) { console.error('❌ Invalid card webhook secret'); return new Response(JSON.stringify({ error: 'Invalid webhook authentication' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); }
      const body = await req.json(); console.log('🔔 Card webhook payload:', JSON.stringify(body));
      const event = body.event || body.type || body.status; const chargeData = body.data || body.charge || body;
      const paidEvents = ['charge.completed', 'card.paid', 'charge.paid', 'COMPLETED', 'paid', 'approved'];
      const isPaidEvent = paidEvents.includes(event) || chargeData?.status === 'COMPLETED' || chargeData?.status === 'paid';
      if (!isPaidEvent) { console.log(`ℹ️ Ignoring card webhook event: ${event}`); return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), { headers: { 'Content-Type': 'application/json' } }); }
      const chargeId = chargeData.chargeId || chargeData.id;
      if (!chargeId) return new Response(JSON.stringify({ error: 'Missing chargeId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      console.log(`💳 Card payment confirmed via webhook for charge: ${chargeId}`);
      const queryResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', chargeId);
      if (!queryResults || !queryResults[0]?.document) { console.error(`❌ No order found for card chargeId: ${chargeId}`); return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); }
      const orderDoc = queryResults[0].document; const orderId = orderDoc.name.split('/').pop()!; const orderFields = orderDoc.fields;
      if (orderFields?.payment_status?.stringValue === 'paid') { console.log(`ℹ️ Card order ${orderId} already paid`); return new Response(JSON.stringify({ success: true, message: 'Already processed' }), { headers: { 'Content-Type': 'application/json' } }); }
      try { const sr = await fetch(`${FLOWPAY_CARD_URL}/status?id=${chargeId}`, { headers: { 'x-api-key': apiKey } }); const sd = await sr.json(); if (!sr.ok || sd.payment?.status !== 'COMPLETED') { console.warn(`⚠️ Card webhook: FlowPay status not COMPLETED`); return new Response(JSON.stringify({ success: false, error: 'Payment not confirmed by FlowPay API' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } } catch (verifyErr) { console.error(`❌ Failed to verify with FlowPay API:`, verifyErr); return new Response(JSON.stringify({ error: 'Failed to verify payment' }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
      const orderValue = Number(orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0); const customerEmail = orderFields?.customer_email?.stringValue; const userId = orderFields?.user_id?.stringValue;
      await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
      console.log(`✅ Card order ${orderId} marked as paid via webhook`);
      try { await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret }); } catch (e) { console.error(`⚠️ process-delivery failed:`, e); }
      const couponId = orderFields?.coupon_id?.stringValue; if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
      const items = await extractOrderItems(orderId);
      const customerName = orderFields?.customer_name?.stringValue || ''; const customerPhone = orderFields?.customer_phone?.stringValue || '';
      const cardEventId = generateEventId('Purchase', orderId);
      await Promise.allSettled([
        addFirestoreDocWithId('analytics_events', `purchase_${orderId}`, { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value: orderValue, currency: 'BRL', order_id: orderId, content_name: items.productNamesList, source: 'card_webhook' }),
        (async () => { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'card_webhook', event_id: cardEventId, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', buildMetaCapiPurchasePayload(cardEventId, orderId, orderValue, items, orderFields, customerEmail, customerPhone, customerName, userId)); console.log(`📡 [Meta] CAPI Purchase sent — event_id=${cardEventId} (card_webhook)`); } else { console.log(`⏭️ [Meta] CAPI Purchase skipped — already sent for order ${orderId}`); } })(),
        invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: items.productNamesList, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }),
      ]);
      return new Response(JSON.stringify({ success: true, orderId }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ==================== CREATE card charge ====================
    if (action === 'create' && req.method === 'POST') {
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`card_${clientIp}`, 5, 60_000, 600_000);
      if (!rlResult.allowed) { logRateLimitBlock('flowpay-card', clientIp, rlResult.attempts); return new Response(JSON.stringify({ success: false, error: 'Muitas tentativas.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const body = await req.json(); const { orderId, customer } = body; let amount: number;
      if (!orderId || typeof orderId !== 'string' || orderId.length > 50) return new Response(JSON.stringify({ success: false, error: 'orderId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const orderFields = await getDocFields('ordens', orderId);
      if (!orderFields) return new Response(JSON.stringify({ success: false, error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const at4 = await getFirebaseAccessToken(); const oiUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`; const oiRes = await fetch(oiUrl, { headers: { 'Authorization': `Bearer ${at4}` } }); const oiData = oiRes.ok ? await oiRes.json() : { documents: [] }; const orderItemsResults = (oiData.documents || []).map((doc: any) => ({ document: doc }));
      if (!orderItemsResults.length) return new Response(JSON.stringify({ success: false, error: 'Order items not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const parsedItems = orderItemsResults.filter((r: any) => r.document).map((r: any) => { const f = r.document.fields; return { productId: f?.product_id?.stringValue || '', quantity: parseInt(f?.quantity?.integerValue || '1') }; });
      if (parsedItems.find((i: any) => !i.productId)) return new Response(JSON.stringify({ success: false, error: 'Invalid order item' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const uniqueProductIds = [...new Set(parsedItems.map((i: any) => i.productId))];
      const productResults = await Promise.all(uniqueProductIds.map(pid => getDocFields('products', pid).then(fields => ({ pid, fields }))));
      const productCache = new Map<string, any>();
      for (const { pid, fields } of productResults) { if (!fields) return new Response(JSON.stringify({ success: false, error: `Product ${pid} not found` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); productCache.set(pid, fields); }
      let recalculatedTotal = 0;
      for (const item of parsedItems) { const pf = productCache.get(item.productId)!; recalculatedTotal += Number(pf.price?.doubleValue || pf.price?.integerValue || 0) * item.quantity; }
      const couponId = orderFields.coupon_id?.stringValue;
      if (couponId) { const cf = await getDocFields('coupons', couponId); if (cf) { const dt = cf.discount_type?.stringValue; const dv = Number(cf.discount_value?.doubleValue || cf.discount_value?.integerValue || 0); const ia = cf.is_active?.booleanValue !== false; const mu = cf.max_uses?.integerValue ? parseInt(cf.max_uses.integerValue) : null; const cu = cf.current_uses?.integerValue ? parseInt(cf.current_uses.integerValue) : 0; if (ia && (!mu || cu < mu)) { let da = 0; if (dt === 'percentage') da = Math.min(recalculatedTotal * (dv / 100), recalculatedTotal); else da = Math.min(dv, recalculatedTotal); recalculatedTotal -= da; } } }
      const orderUserId = orderFields.user_id?.stringValue;
      if (orderUserId && !(await checkPendingOrderFlood(orderUserId))) return new Response(JSON.stringify({ success: false, error: 'Muitos pedidos pendentes.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
      if (Math.abs(clientTotal - recalculatedTotal) > 0.01) console.warn(`🚨 PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${recalculatedTotal}`);
      amount = Math.round(recalculatedTotal * 100);
      if (amount < 100) return new Response(JSON.stringify({ success: false, error: 'Valor mínimo é R$ 1,00' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const safeDescription = `Pedido ${orderId.substring(0, 8).toUpperCase()}`;
      const flowpayResponse = await fetch(`${FLOWPAY_CARD_URL}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ value: amount, description: safeDescription, customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone, taxId: customer.taxId } : undefined }) });
      const flowpayData = await flowpayResponse.json();
      if (!flowpayResponse.ok || !flowpayData.success) { console.error('FlowPay card create error:', flowpayData); return new Response(JSON.stringify({ success: false, error: flowpayData.error || 'Erro ao criar cobrança' }), { status: flowpayResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const deliveryToken = crypto.randomUUID();
      try { await updateDocOrThrow('ordens', orderId, { flowpay_charge_id: flowpayData.payment.id, delivery_token: deliveryToken, delivery_token_created_at: new Date().toISOString() }); } catch (err) { console.warn('⚠️ Failed to save chargeId/deliveryToken:', err); }
      return new Response(JSON.stringify({ success: true, paymentId: flowpayData.payment.id, paymentUrl: flowpayData.payment.paymentUrl, status: flowpayData.payment.status, deliveryToken }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CREATE UPSELL card charge (no Firestore order needed) ====================
    if (action === 'create-upsell' && req.method === 'POST') {
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`upsell_card_${clientIp}`, 10, 60_000, 300_000);
      if (!rlResult.allowed) { logRateLimitBlock('flowpay-card-upsell', clientIp, rlResult.attempts); return new Response(JSON.stringify({ success: false, error: 'Muitas tentativas.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const body = await req.json();
      const { amount, orderId, addonType, description, customer } = body;
      if (!amount || !orderId || !addonType) return new Response(JSON.stringify({ success: false, error: 'amount, orderId, and addonType are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const amountNum = Number(amount);
      if (amountNum < 100) return new Response(JSON.stringify({ success: false, error: 'Valor mínimo é R$ 1,00' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const safeDescription = String(description || `Upsell ${addonType}`).substring(0, 100);
      const flowpayResponse = await fetch(`${FLOWPAY_CARD_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ value: amountNum, description: safeDescription, customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone, taxId: customer.taxId } : undefined }),
      });
      const flowpayData = await flowpayResponse.json();
      if (!flowpayResponse.ok || !flowpayData.success) { console.error('FlowPay card upsell create error:', flowpayData); return new Response(JSON.stringify({ success: false, error: flowpayData.error || 'Erro ao criar cobrança' }), { status: flowpayResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      // Save upsell charge in sale_addons
      const upsellDocId = `upsell-${orderId}-${addonType}`;
      try {
        await addFirestoreDocWithId('sale_addons', upsellDocId, {
          order_id: orderId, addon_type: addonType, status: 'pending', amount: amountNum / 100,
          payment_method: 'card', flowpay_charge_id: flowpayData.payment.id,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
      } catch (e) { console.warn('⚠️ Failed to save upsell addon doc:', e); }
      console.log(`💳 Card upsell charge created: ${flowpayData.payment.id} for ${addonType} on order ${orderId}`);
      return new Response(JSON.stringify({ success: true, paymentId: flowpayData.payment.id, paymentUrl: flowpayData.payment.paymentUrl, status: flowpayData.payment.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== UPSELL STATUS (no order ownership check) ====================
    if (action === 'upsell-status' && req.method === 'GET') {
      const paymentId = url.searchParams.get('id');
      if (!paymentId) return new Response(JSON.stringify({ success: false, error: 'Payment ID required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, { headers: { 'x-api-key': apiKey } });
      const statusData = await statusResponse.json();
      if (!statusResponse.ok) return new Response(JSON.stringify({ success: false, error: statusData.error || 'Erro ao consultar status' }), { status: statusResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      // If paid, process order or addon
      if (statusData.payment?.status === 'COMPLETED') {
        // First check main orders
        const orderResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', paymentId);
        if (orderResults?.[0]?.document) {
          const orderDoc = orderResults[0].document;
          const orderId = orderDoc.name.split('/').pop()!;
          const orderFields = orderDoc.fields;
          if (orderFields?.payment_status?.stringValue !== 'paid') {
            console.log(`🔄 Processing card order ${orderId} via upsell-status polling`);
            const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
            const orderValue = Number(orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0);
            const customerEmail = orderFields?.customer_email?.stringValue;
            const userId = orderFields?.user_id?.stringValue;
            const customerName = orderFields?.customer_name?.stringValue || '';
            const customerPhone = orderFields?.customer_phone?.stringValue || '';
            await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
            console.log(`✅ Card order ${orderId} marked as paid via upsell-status`);
            try { await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret }); } catch (e) { console.warn('⚠️ process-delivery failed:', e); }
            const couponId = orderFields?.coupon_id?.stringValue;
            if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
            const items2 = await extractOrderItems(orderId);
            const pollingEventId = generateEventId('Purchase', orderId);
            await Promise.allSettled([
              addFirestoreDocWithId('analytics_events', `purchase_${orderId}`, { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value: orderValue, currency: 'BRL', order_id: orderId, content_name: items2.productNamesList, source: 'card_auto_verify' }),
              (async () => { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'card_auto_verify', event_id: pollingEventId, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', buildMetaCapiPurchasePayload(pollingEventId, orderId, orderValue, items2, orderFields, customerEmail, customerPhone, customerName, userId)); console.log(`📡 [Meta] CAPI Purchase sent — event_id=${pollingEventId} (card_auto_verify)`); } })(),
              invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: items2.productNamesList, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }),
            ]);
          }
        } else {
          // Check sale_addons (upsells)
          const upsellResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', paymentId);
          if (upsellResults?.[0]?.document) {
            const docName = upsellResults[0].document.name;
            const docId = docName.split('/').pop()!;
            try { await updateFirestoreDoc('sale_addons', docId, { status: 'paid', payment_status: 'paid', updated_at: new Date().toISOString() }); console.log(`✅ Upsell ${docId} marked as paid`); } catch (e) { console.warn('⚠️ Failed to update upsell addon:', e); }
          }
        }
      }
      return new Response(JSON.stringify({ success: true, status: statusData.payment?.status, paidAt: statusData.payment?.paidAt || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CHECK STATUS ====================
    if (action === 'status' && req.method === 'GET') {
      const paymentId = url.searchParams.get('id');
      if (!paymentId) return new Response(JSON.stringify({ success: false, error: 'Payment ID required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const statusAuth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); const deliveryTokenHeader = req.headers.get('x-delivery-token');
      let statusCallerUid: string | null = null;
      if (statusAuth) { const fbUser = await verifyFirebaseIdToken(statusAuth); if (!fbUser) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); statusCallerUid = fbUser.uid; }
      if (!statusCallerUid && !deliveryTokenHeader) return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const ownerResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', paymentId);
      if (ownerResults?.[0]?.document) { const ownerFields = ownerResults[0].document.fields; const ownerUid = ownerFields?.user_id?.stringValue; const ownerDeliveryToken = ownerFields?.delivery_token?.stringValue; if (statusCallerUid) { if (ownerUid && ownerUid !== statusCallerUid) { console.warn(`🚨 Card status ownership mismatch`); return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } } else if (deliveryTokenHeader) { if (ownerDeliveryToken !== deliveryTokenHeader) return new Response(JSON.stringify({ success: false, error: 'Invalid delivery token' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, { headers: { 'x-api-key': apiKey } });
      const statusData = await statusResponse.json();
      if (!statusResponse.ok) return new Response(JSON.stringify({ success: false, error: statusData.error || 'Erro ao consultar status' }), { status: statusResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      
      // If paid, process order if not already paid
      if (statusData.payment?.status === 'COMPLETED' && ownerResults?.[0]?.document) {
        const orderDoc = ownerResults[0].document;
        const orderId = orderDoc.name.split('/').pop()!;
        const orderFields = orderDoc.fields;
        if (orderFields?.payment_status?.stringValue !== 'paid') {
          console.log(`🔄 Processing card order ${orderId} via status polling`);
          const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
          const orderValue = Number(orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0);
          const customerEmail = orderFields?.customer_email?.stringValue;
          const userId = orderFields?.user_id?.stringValue;
          const customerName = orderFields?.customer_name?.stringValue || '';
          const customerPhone = orderFields?.customer_phone?.stringValue || '';
          await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
          console.log(`✅ Card order ${orderId} marked as paid via status check`);
          try { await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret }); } catch (e) { console.warn('⚠️ process-delivery failed:', e); }
          const couponId = orderFields?.coupon_id?.stringValue;
          if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
          const items2 = await extractOrderItems(orderId);
          const pollingEventId = generateEventId('Purchase', orderId);
          await Promise.allSettled([
            addFirestoreDocWithId('analytics_events', `purchase_${orderId}`, { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value: orderValue, currency: 'BRL', order_id: orderId, content_name: items2.productNamesList, source: 'card_auto_verify' }),
            (async () => { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'card_auto_verify', event_id: pollingEventId, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', buildMetaCapiPurchasePayload(pollingEventId, orderId, orderValue, items2, orderFields, customerEmail, customerPhone, customerName, userId)); console.log(`📡 [Meta] CAPI Purchase sent — event_id=${pollingEventId} (card_auto_verify)`); } })(),
            invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: items2.productNamesList, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }),
          ]);
        }
      }

      return new Response(JSON.stringify({ success: true, status: statusData.payment?.status, paidAt: statusData.payment?.paidAt || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CONFIRM ====================
    if (action === 'confirm' && req.method === 'POST') {
      const body = await req.json(); const { orderId, paymentId } = body;
      if (!orderId || !paymentId) return new Response(JSON.stringify({ success: false, error: 'orderId and paymentId are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const authHeader = req.headers.get('authorization'); const idToken = authHeader?.replace(/^Bearer\s+/i, ''); const deliveryTokenHeader = req.headers.get('x-delivery-token');
      let authSource = 'none'; let callerUid: string | null = null; let isAdmin = false;
      if (idToken) { const user = await verifyFirebaseIdToken(idToken); if (user) { callerUid = user.uid; authSource = 'user'; try { const roleDoc = await getDocFields('user_roles', user.uid); if (roleDoc?.role?.stringValue === 'admin') isAdmin = true; } catch {} } }
      if (authSource === 'none' && deliveryTokenHeader && deliveryTokenHeader.length >= 20) authSource = 'delivery_token';
      if (authSource === 'none') return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, { headers: { 'x-api-key': apiKey } }); const statusData = await statusResponse.json();
      if (!statusResponse.ok || statusData.payment?.status !== 'COMPLETED') return new Response(JSON.stringify({ success: false, error: 'Payment not confirmed', status: statusData.payment?.status || 'unknown' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const orderFields = await getDocFields('ordens', orderId);
      if (!orderFields) return new Response(JSON.stringify({ success: false, error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (authSource === 'user' && !isAdmin) { const ouid = orderFields.user_id?.stringValue; if (ouid && !ouid.startsWith('guest_') && ouid !== callerUid) return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your order' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      else if (authSource === 'delivery_token') { const st = orderFields.delivery_token?.stringValue; if (!st || st !== deliveryTokenHeader) return new Response(JSON.stringify({ success: false, error: 'Forbidden: invalid delivery token' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); try { await updateDocOrThrow('ordens', orderId, { delivery_token: null, delivery_token_created_at: null, delivery_token_consumer: `card_confirm_${crypto.randomUUID()}` }); } catch (consumeErr) { console.error(`❌ [${orderId}] Failed to consume delivery_token`, consumeErr); return new Response(JSON.stringify({ success: false, error: 'Internal error: token consumption failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
      if (orderFields.flowpay_charge_id?.stringValue !== paymentId) { console.warn(`🚨 chargeId mismatch`); return new Response(JSON.stringify({ success: false, error: 'Payment ID mismatch' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      if (orderFields.payment_status?.stringValue === 'paid') { console.log(`ℹ️ Card order ${orderId} already paid`); return new Response(JSON.stringify({ success: true, message: 'Already processed' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
      console.log(`✅ Card order ${orderId} marked as paid (server-side confirm)`);
      try { const ws = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || ''; await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': ws }); } catch (e) { console.warn('⚠️ process-delivery failed:', e); }
      const couponId = orderFields.coupon_id?.stringValue; if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
      const items3 = await extractOrderItems(orderId);
      const orderValue = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0); const userId = orderFields.user_id?.stringValue; const customerEmail = orderFields.customer_email?.stringValue; const customerName = orderFields.customer_name?.stringValue || ''; const customerPhone = orderFields.customer_phone?.stringValue || '';
      const confirmEventId = generateEventId('Purchase', orderId);
      await Promise.allSettled([
        addFirestoreDocWithId('analytics_events', `purchase_${orderId}`, { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value: orderValue, currency: 'BRL', order_id: orderId, page_url: 'https://www.valnix.com.br/card-callback', content_name: items3.productNamesList }),
        (async () => { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'card_confirm', event_id: confirmEventId, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', buildMetaCapiPurchasePayload(confirmEventId, orderId, orderValue, items3, orderFields, customerEmail, customerPhone, customerName, userId)); console.log(`📡 [Meta] CAPI Purchase sent — event_id=${confirmEventId} (card_confirm)`); } else { console.log(`⏭️ [Meta] CAPI Purchase skipped — already sent for order ${orderId}`); } })(),
        invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: items3.productNamesList, utm_source: orderFields.utm_source?.stringValue, utm_medium: orderFields.utm_medium?.stringValue, utm_campaign: orderFields.utm_campaign?.stringValue, utm_content: orderFields.utm_content?.stringValue, utm_term: orderFields.utm_term?.stringValue }),
      ]);
      return new Response(JSON.stringify({ success: true, orderId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { console.error('FlowPay card error:', error); return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
