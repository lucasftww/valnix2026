import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE, verifyFirebaseIdToken } from '../_shared/firebase.ts';
import { getFirestoreDoc, updateFirestoreDoc, queryFirestore, addFirestoreDoc, addFirestoreDocWithId } from '../_shared/firestore.ts';
import { timingSafeEqual } from '../_shared/auth.ts';
import { checkRateLimitFirestore, logRateLimitBlock } from '../_shared/rate-limit.ts';
import { invokeEdgeFunction, idempotentCouponIncrement } from '../_shared/utils.ts';

const FLOWPAY_BASE_URL = 'https://flowpayments.net/api/pix';

// ── Throwing wrapper for updateFirestoreDoc ──
async function updateDocOrThrow(col: string, docId: string, data: Record<string, unknown>) {
  const ok = await updateFirestoreDoc(col, docId, data);
  if (!ok) throw new Error(`Firestore update failed: ${col}/${docId}`);
  return true;
}

// ── Get doc fields (convenience) ──
async function getDocFields(col: string, docId: string): Promise<any> {
  const doc = await getFirestoreDoc(col, docId);
  return doc?.fields || null;
}

// ── Analytics → Firestore ──
async function registerAnalyticsEvent(orderId: string, value: number, userId?: string, customerEmail?: string, contentName?: string) {
  try {
    await addFirestoreDoc('analytics_events', { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value, currency: 'BRL', order_id: orderId, page_url: 'https://www.valnix.com.br/checkout', content_name: contentName || `Pedido #${orderId.substring(0, 8)}` });
    console.log(`📊 Analytics Purchase event registered for order ${orderId}`);
  } catch (error) { console.warn('⚠️ Analytics event registration failed:', error); }
}

// ── Process upsell addon payment ──
async function processAddonPayment(addonDoc: any, addonId: string): Promise<boolean> {
  const f = addonDoc.fields || addonDoc;
  const getVal = (field: any) => field?.stringValue || field?.doubleValue?.toString() || field?.integerValue?.toString() || null;
  const status = getVal(f.status);
  if (status === 'paid') { console.log(`ℹ️ Addon ${addonId} already paid, skipping`); return false; }
  await updateDocOrThrow('sale_addons', addonId, { status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() });
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
  await registerAnalyticsEvent(upsellOrderId, Number(amount), userId, customerEmail);
  let parentFbc: string | undefined, parentFbp: string | undefined, parentPhone: string | undefined, parentEventSourceUrl: string | undefined;
  try { const parentOrder = await getDocFields('ordens', orderId); if (parentOrder) { parentFbc = parentOrder.fbc?.stringValue; parentFbp = parentOrder.fbp?.stringValue; parentPhone = parentOrder.customer_phone?.stringValue; parentEventSourceUrl = parentOrder.event_source_url?.stringValue; } } catch {}
  const nameParts = customerName.split(' ');
  const upsellEventId = `purchase_upsell_${orderId}_${addonType}`;
  try { await invokeEdgeFunction('meta-capi', { event_name: 'Purchase', event_id: upsellEventId, order_id: `${orderId}_${addonType}`, value: Number(amount), currency: 'BRL', content_name: `Upsell ${addonType}`, email: customerEmail || undefined, phone: parentPhone, first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined, external_id: userId, fbc: parentFbc, fbp: parentFbp, event_source_url: parentEventSourceUrl }); } catch (e) { console.warn('⚠️ Meta CAPI upsell failed:', e); }
  try { await invokeEdgeFunction('utmify-event', { order_id: `${orderId}_${addonType}`, event_type: 'Purchase', value: Number(amount), customer_name: customerName, customer_email: customerEmail, product_name: `Upsell ${addonType}`, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign }); } catch (e) { console.warn('⚠️ UTMify upsell failed:', e); }
  return true;
}

// ── Pending order flood protection ──
async function checkPendingOrderFlood(userId: string): Promise<boolean> {
  const rl = await checkRateLimitFirestore(`flood_${userId}`, 10, 3600_000, 3600_000);
  if (!rl.allowed) { console.warn(`🚨 ORDER FLOOD: user ${userId} exceeded 10 pending orders/hour`); return false; }
  return true;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-secret, x-api-key' });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const apiKey = Deno.env.get('FLOWPAY_API_KEY');

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // ==================== WEBHOOK ====================
    if (req.method === 'POST' && action === 'webhook') {
      console.log('🔔 FlowPay webhook received');
      const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
      if (!webhookSecret) { console.error('❌ FLOWPAY_WEBHOOK_SECRET not configured'); return new Response(JSON.stringify({ error: 'Webhook authentication not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
      const receivedSecret = req.headers.get('x-webhook-secret') || req.headers.get('x-secret') || req.headers.get('authorization')?.replace('Bearer ', '') || req.headers.get('x-api-key');
      if (!receivedSecret || !timingSafeEqual(receivedSecret, webhookSecret)) { console.error('❌ Invalid webhook secret'); return new Response(JSON.stringify({ error: 'Invalid webhook authentication' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); }
      const body = await req.json();
      console.log('🔔 Webhook payload:', JSON.stringify(body));
      const event = body.event || body.type || body.status;
      const chargeData = body.data || body.charge || body;
      const paidEvents = ['pix.received', 'charge.paid', 'COMPLETED', 'paid', 'approved', 'pix_paid'];
      const isPaidEvent = paidEvents.includes(event) || chargeData?.status === 'COMPLETED' || chargeData?.status === 'paid';
      if (!isPaidEvent) { console.log(`ℹ️ Ignoring webhook event: ${event}`); return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), { headers: { 'Content-Type': 'application/json' } }); }
      const chargeId = chargeData.chargeId || chargeData.id;
      if (!chargeId) return new Response(JSON.stringify({ error: 'Missing chargeId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      console.log(`💰 Payment confirmed for charge: ${chargeId}`);
      const queryResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', chargeId);
      if (!queryResults || !queryResults[0]?.document) {
        console.log(`ℹ️ No order found for chargeId: ${chargeId}, checking sale_addons...`);
        const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', chargeId);
        if (!addonResults || !addonResults[0]?.document) { console.error(`❌ No order or addon found for chargeId: ${chargeId}`); return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); }
        const addonDoc = addonResults[0].document; const addonId = addonDoc.name.split('/').pop()!;
        await processAddonPayment(addonDoc, addonId);
        return new Response(JSON.stringify({ success: true, addonId }), { headers: { 'Content-Type': 'application/json' } });
      }
      const orderDoc = queryResults[0].document; const orderId = orderDoc.name.split('/').pop()!; const orderFields = orderDoc.fields;
      if (orderFields?.payment_status?.stringValue === 'paid') { console.log(`ℹ️ Order ${orderId} already paid, skipping`); return new Response(JSON.stringify({ success: true, message: 'Already processed' }), { headers: { 'Content-Type': 'application/json' } }); }
      const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0;
      const customerEmail = orderFields?.customer_email?.stringValue; const userId = orderFields?.user_id?.stringValue;
      await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
      console.log(`✅ Order ${orderId} marked as paid via webhook`);
      try { const ws = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || ''; await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': ws }); console.log(`📦 process-delivery called for order ${orderId}`); } catch (e) { console.error(`⚠️ process-delivery call failed:`, e); }
      const couponId = orderFields?.coupon_id?.stringValue;
      if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
      let productNamesList = `Pedido #${orderId.substring(0, 8)}`;
      try { const at2 = await getFirebaseAccessToken(); const iUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`; const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${at2}` } }); if (iRes.ok) { const iData = await iRes.json(); const names = (iData.documents || []).filter((d: any) => d.fields?.product_name?.stringValue).map((d: any) => d.fields.product_name.stringValue); if (names.length > 0) productNamesList = names.join(', '); } } catch {}
      const customerName = orderFields?.customer_name?.stringValue || ''; const customerPhone = orderFields?.customer_phone?.stringValue || ''; const nameParts = customerName.split(' ');
      await Promise.allSettled([
        registerAnalyticsEvent(orderId, orderValue, userId, customerEmail, productNamesList),
        (async () => { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'webhook', event_id: `purchase_${orderId}`, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', { event_name: 'Purchase', event_id: `purchase_${orderId}`, order_id: orderId, value: orderValue, currency: 'BRL', content_name: productNamesList, email: customerEmail, phone: customerPhone || undefined, first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined, external_id: userId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue, event_source_url: orderFields?.event_source_url?.stringValue || undefined }); } })(),
        invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: productNamesList, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }),
      ]);
      return new Response(JSON.stringify({ success: true, orderId }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ==================== CREATE PIX CHARGE ====================
    if (req.method === 'POST' && action === 'create') {
      const createIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`pix_${createIp}`, 6, 60_000, 600_000);
      if (!rlResult.allowed) { logRateLimitBlock('flowpay-pix', createIp, rlResult.attempts); return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const authHeader = req.headers.get('authorization'); const idToken = authHeader?.replace(/^Bearer\s+/i, '');
      let firebaseUser: { uid: string; email?: string } | null = null;
      if (idToken) { firebaseUser = await verifyFirebaseIdToken(idToken); if (firebaseUser) console.log(`🔐 Authenticated user: ${firebaseUser.uid}`); else console.warn('⚠️ Invalid Firebase token, proceeding as guest'); }
      if (!apiKey) return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const clientIpAtCreate = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || null;
      const clientUaAtCreate = req.headers.get('user-agent') || null;
      const body = await req.json(); const { orderId, customer, utmParameters } = body; let { amount } = body;
      if (!orderId || typeof orderId !== 'string' || orderId.length > 100) return new Response(JSON.stringify({ error: 'orderId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const isUpsell = orderId.startsWith('upsell-');
      if (!isUpsell) {
        const orderFields = await getDocFields('ordens', orderId);
        if (!orderFields) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const at3 = await getFirebaseAccessToken(); const oiUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`; const oiRes = await fetch(oiUrl, { headers: { 'Authorization': `Bearer ${at3}` } }); const oiData = oiRes.ok ? await oiRes.json() : { documents: [] }; const orderItemsResults = (oiData.documents || []).map((doc: any) => ({ document: doc }));
        if (!orderItemsResults.length) return new Response(JSON.stringify({ error: 'Order items not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const productCache = new Map<string, any>(); let recalculatedTotal = 0;
        for (const result of orderItemsResults) {
          if (!result.document) continue; const itemFields = result.document.fields; const productId = itemFields?.product_id?.stringValue; const quantity = parseInt(itemFields?.quantity?.integerValue || '1');
          if (!productId) return new Response(JSON.stringify({ error: 'Invalid order item' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          let productFields = productCache.get(productId);
          if (!productFields) { productFields = await getDocFields('products', productId); if (!productFields) return new Response(JSON.stringify({ error: `Product ${productId} not found` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); productCache.set(productId, productFields); }
          recalculatedTotal += Number(productFields.price?.doubleValue || productFields.price?.integerValue || 0) * quantity;
        }
        const couponId = orderFields.coupon_id?.stringValue;
        if (couponId) { const couponFields = await getDocFields('coupons', couponId); if (couponFields) { const discountType = couponFields.discount_type?.stringValue; const discountValue = Number(couponFields.discount_value?.doubleValue || couponFields.discount_value?.integerValue || 0); const isActive = couponFields.is_active?.booleanValue !== false; const maxUses = couponFields.max_uses?.integerValue ? parseInt(couponFields.max_uses.integerValue) : null; const currentUses = couponFields.current_uses?.integerValue ? parseInt(couponFields.current_uses.integerValue) : 0; if (isActive && (!maxUses || currentUses < maxUses)) { let discountAmount = 0; if (discountType === 'percentage') discountAmount = Math.min(recalculatedTotal * (discountValue / 100), recalculatedTotal); else discountAmount = Math.min(discountValue, recalculatedTotal); recalculatedTotal -= discountAmount; console.log(`🏷️ Coupon ${couponId}: -R$${discountAmount.toFixed(2)}`); } } }
        const serverAmountCents = Math.round(recalculatedTotal * 100);
        if (serverAmountCents < 100) return new Response(JSON.stringify({ error: 'Order amount too low' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const orderUserId = orderFields.user_id?.stringValue;
        if (orderUserId) { const floodRl = await checkRateLimitFirestore(`flood_${orderUserId}`, 10, 3600_000, 3600_000); if (!floodRl.allowed) { console.warn(`🚨 ORDER FLOOD (PIX): user ${orderUserId}`); return new Response(JSON.stringify({ error: 'Muitos pedidos pendentes.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
        const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
        if (Math.abs(clientTotal - recalculatedTotal) > 0.01) console.warn(`🚨 PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${recalculatedTotal}`);
        amount = serverAmountCents;
        console.log(`🔒 Server-recalculated: ${amount} cents (order ${orderId})`);
      } else {
        const addonType = body.addonType;
        if (addonType) { const pageResults = await queryFirestore('post_payment_pages', 'addon_type', 'EQUAL', addonType); if (pageResults?.[0]?.document) { const pageFields = pageResults[0].document.fields; if (pageFields?.is_active?.booleanValue !== false) { const pagePrice = Number(pageFields?.price?.doubleValue || pageFields?.price?.integerValue || 0); const serverUpsellCents = Math.round(pagePrice * 100); if (serverUpsellCents >= 100) { amount = serverUpsellCents; console.log(`🔒 Upsell server-verified: ${amount} cents`); } } } }
        if (!amount || amount < 100) return new Response(JSON.stringify({ error: 'Amount must be at least 100' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const isUpsellCharge = orderId.startsWith('upsell-');
      const description = isUpsellCharge ? `Upsell ${orderId.substring(7, 30)}` : `Pedido ${orderId.substring(0, 8).toUpperCase()}`;
      console.log('🔵 Creating FlowPay PIX charge:', { amount, orderId });
      const response = await fetch(`${FLOWPAY_BASE_URL}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ value: amount, description, expiresIn: 900, customer: customer || undefined }) });
      const data = await response.json();
      if (!response.ok || !data.success) return new Response(JSON.stringify({ error: data.error || 'Failed to create PIX charge' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (orderId && !isUpsell) { try { await updateDocOrThrow('ordens', orderId, { flowpay_charge_id: data.charge.id, ...(utmParameters ? { utm_parameters: utmParameters } : {}), ...(clientIpAtCreate ? { client_ip: clientIpAtCreate } : {}), ...(clientUaAtCreate ? { client_ua: clientUaAtCreate } : {}) }); } catch (err) { console.warn('⚠️ Failed to store chargeId:', err); } }
      return new Response(JSON.stringify({ success: true, chargeId: data.charge.id, brCode: data.charge.brCode, qrCodeImage: data.charge.qrCodeImage, expiresAt: data.charge.expiresAt }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CHECK STATUS ====================
    if (req.method === 'GET' && action === 'status') {
      const webhookSecretForStatus = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
      if (!apiKey) return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const chargeId = url.searchParams.get('chargeId');
      if (!chargeId) return new Response(JSON.stringify({ error: 'chargeId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const expectedOrderId = url.searchParams.get('orderId');
      if (!expectedOrderId) return new Response(JSON.stringify({ error: 'orderId is required for status check' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const statusAuthHeader = req.headers.get('authorization'); const statusIdToken = statusAuthHeader?.replace(/^Bearer\s+/i, '');
      let statusCallerUid: string | null = null; let canAttemptSideEffects = false;
      if (statusIdToken) { const fbUser = await verifyFirebaseIdToken(statusIdToken); if (fbUser) statusCallerUid = fbUser.uid; }
      const ownershipCheck = await getDocFields('ordens', expectedOrderId);
      if (!ownershipCheck || ownershipCheck.flowpay_charge_id?.stringValue !== chargeId) { const isUpsellOwner = expectedOrderId.startsWith('upsell-'); if (!isUpsellOwner) { console.warn(`🚨 Ownership mismatch: orderId=${expectedOrderId} chargeId=${chargeId}`); return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
      if (ownershipCheck) { const ownerUid = ownershipCheck.user_id?.stringValue; if (statusCallerUid) { canAttemptSideEffects = (ownerUid === statusCallerUid); } else if (ownerUid?.startsWith('guest_')) { canAttemptSideEffects = true; } }
      const response = await fetch(`${FLOWPAY_BASE_URL}/status?id=${chargeId}`, { headers: { 'x-api-key': apiKey } });
      const data = await response.json();
      if (!response.ok || !data.success) return new Response(JSON.stringify({ error: data.error || 'Failed to check status' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      if (data.charge?.status === 'COMPLETED' && canAttemptSideEffects) {
        try {
          const queryResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', chargeId);
          const orderDoc = queryResults?.[0]?.document;
          if (orderDoc) {
            const orderId = orderDoc.name.split('/').pop()!; const orderFields = orderDoc.fields;
            if (orderFields?.payment_status?.stringValue !== 'paid') {
              console.log(`🔄 Processing order ${orderId} via polling`);
              const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0;
              const fbUserId = orderFields?.user_id?.stringValue; const fbEmail = orderFields?.customer_email?.stringValue;
              const fbName = orderFields?.customer_name?.stringValue || ''; const fbPhone = orderFields?.customer_phone?.stringValue || '';
              await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
              try { await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecretForStatus }); } catch {}
              const couponId = orderFields?.coupon_id?.stringValue;
              if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }
              let pollingProductNames = `Pedido #${orderId.substring(0, 8)}`;
              try { const at4 = await getFirebaseAccessToken(); const piUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`; const piRes = await fetch(piUrl, { headers: { 'Authorization': `Bearer ${at4}` } }); if (piRes.ok) { const piData = await piRes.json(); const names = (piData.documents || []).filter((d: any) => d.fields?.product_name?.stringValue).map((d: any) => d.fields.product_name.stringValue); if (names.length > 0) pollingProductNames = names.join(', '); } } catch {}
              await registerAnalyticsEvent(orderId, Number(orderValue), fbUserId, fbEmail, pollingProductNames);
              const nameParts = fbName.split(' ');
              try { const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source: 'polling', event_id: `purchase_${orderId}`, created_at: new Date().toISOString() }); if (r) { await invokeEdgeFunction('meta-capi', { event_name: 'Purchase', event_id: `purchase_${orderId}`, order_id: orderId, value: Number(orderValue), currency: 'BRL', content_name: pollingProductNames, email: fbEmail, phone: fbPhone || undefined, first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined, external_id: fbUserId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue, event_source_url: orderFields?.event_source_url?.stringValue || undefined }); } } catch {}
              try { await invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: Number(orderValue), customer_name: fbName, customer_email: fbEmail, customer_phone: fbPhone || undefined, product_name: pollingProductNames, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }); } catch {}
            }
          } else {
            const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', chargeId);
            if (addonResults?.[0]?.document) { const addonDoc2 = addonResults[0].document; const addonId = addonDoc2.name.split('/').pop()!; if (addonDoc2.fields?.status?.stringValue !== 'paid') { console.log(`🔄 Processing upsell addon ${addonId} via polling`); await processAddonPayment(addonDoc2, addonId); } }
          }
        } catch (fallbackError) { console.warn('⚠️ Purchase fallback error (non-blocking):', fallbackError); }
      }
      return new Response(JSON.stringify({ success: true, status: data.charge.status, paidAt: data.charge.paidAt || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { console.error('❌ FlowPay edge function error:', error); return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
