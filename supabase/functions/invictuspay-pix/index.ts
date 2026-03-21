import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE, verifyFirebaseIdToken } from '../_shared/firebase.ts';
import { getFirestoreDoc, updateFirestoreDoc, queryFirestore, addFirestoreDoc, addFirestoreDocWithId } from '../_shared/firestore.ts';
import { timingSafeEqual } from '../_shared/auth.ts';
import { checkRateLimitFirestore, logRateLimitBlock } from '../_shared/rate-limit.ts';
import { invokeEdgeFunction, idempotentCouponIncrement, generateEventId } from '../_shared/utils.ts';

// ── InvictusPay API ──
const INVICTUSPAY_BASE = 'https://api.invictuspay.app.br/api/public/v1';
const INVICTUSPAY_OFFER_HASH = 'xr6oemys5x';
const INVICTUSPAY_PRODUCT_HASH = 'axddnlaasa';

function getApiToken(): string {
  return Deno.env.get('INVICTUSPAY_API_TOKEN') || '';
}

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

// ── Analytics → Firestore (idempotent by order_id) ──
async function registerAnalyticsEvent(orderId: string, value: number, userId?: string, customerEmail?: string, contentName?: string) {
  try {
    const created = await addFirestoreDocWithId('analytics_events', `purchase_${orderId}`, { event_name: 'Purchase', event_time: new Date().toISOString(), user_id: userId || null, value, currency: 'BRL', order_id: orderId, page_url: 'https://www.valnix.com.br/checkout', content_name: contentName || `Pedido #${orderId.substring(0, 8)}` });
    if (created) {
      console.log(`📊 Analytics Purchase event registered for order ${orderId}`);
    } else {
      console.log(`⏭️ Analytics Purchase event already exists for order ${orderId}`);
    }
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
  const upsellEventId = generateEventId('Purchase', `upsell_${orderId}_${addonType}`);
  try { await invokeEdgeFunction('meta-capi', { event_name: 'Purchase', event_id: upsellEventId, order_id: `${orderId}_${addonType}`, value: Number(amount), currency: 'BRL', content_name: `Upsell ${addonType}`, email: customerEmail || undefined, phone: parentPhone, first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined, external_id: userId, fbc: parentFbc, fbp: parentFbp, event_source_url: parentEventSourceUrl }); console.log(`📡 [Meta] CAPI Upsell Purchase sent — event_id=${upsellEventId}`); } catch (e) { console.warn('⚠️ Meta CAPI upsell failed:', e); }
  try { await invokeEdgeFunction('utmify-event', { order_id: `${orderId}_${addonType}`, event_type: 'Purchase', value: Number(amount), customer_name: customerName, customer_email: customerEmail, product_name: `Upsell ${addonType}`, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign }); } catch (e) { console.warn('⚠️ UTMify upsell failed:', e); }
  return true;
}

// ── Process paid order (shared between webhook and polling) ──
async function processOrderPaid(orderId: string, orderFields: any, chargeId: string, source: string) {
  if (orderFields?.payment_status?.stringValue === 'paid') {
    console.log(`ℹ️ Order ${orderId} already paid, skipping`);
    return;
  }
  const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET') || '';
  const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0;
  const customerEmail = orderFields?.customer_email?.stringValue;
  const userId = orderFields?.user_id?.stringValue;
  const customerName = orderFields?.customer_name?.stringValue || '';
  const customerPhone = orderFields?.customer_phone?.stringValue || '';

  await updateDocOrThrow('ordens', orderId, { payment_status: 'paid', status: 'processing', updated_at: new Date().toISOString() });
  console.log(`✅ Order ${orderId} marked as paid via ${source}`);

  try { await invokeEdgeFunction('process-delivery', { orderId }, { 'x-internal-key': webhookSecret }); console.log(`📦 process-delivery called for order ${orderId}`); } catch (e) { console.error(`⚠️ process-delivery call failed:`, e); }

  const couponId = orderFields?.coupon_id?.stringValue;
  if (couponId) { try { await idempotentCouponIncrement(orderId, couponId); } catch {} }

  let productNamesList = `Pedido #${orderId.substring(0, 8)}`;
  let contentIds: string[] = [];
  let contents: { id: string; quantity: number; item_price?: number }[] = [];
  let contentCategory: string | undefined;
  try {
    const at = await getFirebaseAccessToken();
    const iUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`;
    const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${at}` } });
    if (iRes.ok) {
      const iData = await iRes.json();
      const docs = iData.documents || [];
      const names: string[] = [];
      const categories = new Set<string>();
      for (const d of docs) {
        const f = d.fields || {};
        if (f.product_name?.stringValue) names.push(f.product_name.stringValue);
        const pid = f.product_id?.stringValue;
        if (pid) {
          contentIds.push(pid);
          const qty = Number(f.quantity?.integerValue || 1);
          const price = Number(f.unit_price?.doubleValue || f.unit_price?.integerValue || 0);
          contents.push({ id: pid, quantity: qty, ...(price > 0 ? { item_price: price } : {}) });
        }
        if (f.product_category?.stringValue) categories.add(f.product_category.stringValue);
      }
      if (names.length > 0) productNamesList = names.join(', ');
      if (categories.size > 0) contentCategory = [...categories].join(', ');
    }
  } catch {}

  const nameParts = customerName.split(' ');
  const purchaseEventId = generateEventId('Purchase', orderId);
  await Promise.allSettled([
    registerAnalyticsEvent(orderId, orderValue, userId, customerEmail, productNamesList),
    (async () => {
      const r = await addFirestoreDocWithId('meta_purchase_events', orderId, { sent_at: new Date().toISOString(), source, event_id: purchaseEventId, created_at: new Date().toISOString() });
      if (r) {
        await invokeEdgeFunction('meta-capi', {
          event_name: 'Purchase', event_id: purchaseEventId, order_id: orderId, value: orderValue, currency: 'BRL',
          content_name: productNamesList,
          content_category: contentCategory || undefined,
          content_ids: contentIds.length > 0 ? contentIds : undefined,
          contents: contents.length > 0 ? contents : undefined,
          num_items: contents.length > 0 ? contents.reduce((s, c) => s + c.quantity, 0) : undefined,
          content_type: 'product',
          email: customerEmail, phone: customerPhone || undefined,
          first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined,
          external_id: userId, fbc: orderFields?.fbc?.stringValue, fbp: orderFields?.fbp?.stringValue,
          event_source_url: orderFields?.event_source_url?.stringValue || `https://www.valnix.com.br/checkout`,
        });
        console.log(`📡 [Meta] CAPI Purchase sent — event_id=${purchaseEventId} (${source})`);
      } else {
        console.log(`⏭️ [Meta] CAPI Purchase skipped — already sent for order ${orderId}`);
      }
    })(),
    invokeEdgeFunction('utmify-event', { order_id: orderId, event_type: 'Purchase', value: orderValue, customer_name: customerName, customer_email: customerEmail, customer_phone: customerPhone || undefined, product_name: productNamesList, utm_source: orderFields?.utm_source?.stringValue, utm_medium: orderFields?.utm_medium?.stringValue, utm_campaign: orderFields?.utm_campaign?.stringValue, utm_content: orderFields?.utm_content?.stringValue, utm_term: orderFields?.utm_term?.stringValue }),
  ]);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: 'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-secret, x-api-key' });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiToken = getApiToken();

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // ==================== WEBHOOK (InvictusPay Postback) ====================
    if (req.method === 'POST' && action === 'webhook') {
      console.log('🔔 InvictusPay postback received');
      const body = await req.json();
      console.log('🔔 Postback payload:', JSON.stringify(body));

      const transactionHash = body.transaction_hash || body.hash;
      const status = body.status;
      const isPaid = status === 'paid' || status === 'approved';

      if (!isPaid) {
        console.log(`ℹ️ Ignoring postback status: ${status}`);
        return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (!transactionHash) {
        return new Response(JSON.stringify({ error: 'Missing transaction_hash' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      // Verify transaction with InvictusPay API to prevent spoofed postbacks
      try {
        const verifyRes = await fetch(`${INVICTUSPAY_BASE}/transactions/${transactionHash}?api_token=${apiToken}`, {
          headers: { 'Accept': 'application/json' },
        });
        const verifyData = await verifyRes.json();
        const verifiedStatus = verifyData?.data?.status || verifyData?.status;
        if (verifiedStatus !== 'paid' && verifiedStatus !== 'approved') {
          console.warn(`⚠️ Postback verification failed: API status is ${verifiedStatus}`);
          return new Response(JSON.stringify({ error: 'Payment not confirmed by API' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
      } catch (verifyErr) {
        console.error('❌ Failed to verify postback with API:', verifyErr);
        return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      console.log(`💰 Payment confirmed for transaction: ${transactionHash}`);

      // Find order by invictuspay_charge_id
      const queryResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', transactionHash);
      if (!queryResults || !queryResults[0]?.document) {
        console.log(`ℹ️ No order found for transactionHash: ${transactionHash}, checking sale_addons...`);
        const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', transactionHash);
        if (!addonResults || !addonResults[0]?.document) {
          console.error(`❌ No order or addon found for transactionHash: ${transactionHash}`);
          return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const addonDoc = addonResults[0].document;
        const addonId = addonDoc.name.split('/').pop()!;
        await processAddonPayment(addonDoc, addonId);
        return new Response(JSON.stringify({ success: true, addonId }), { headers: { 'Content-Type': 'application/json' } });
      }

      const orderDoc = queryResults[0].document;
      const orderId = orderDoc.name.split('/').pop()!;
      await processOrderPaid(orderId, orderDoc.fields, transactionHash, 'webhook');
      return new Response(JSON.stringify({ success: true, orderId }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ==================== CREATE PIX CHARGE (InvictusPay) ====================
    if (req.method === 'POST' && action === 'create') {
      const createIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const rlResult = await checkRateLimitFirestore(`pix_${createIp}`, 6, 60_000, 600_000);
      if (!rlResult.allowed) { logRateLimitBlock('invictuspay-pix', createIp, rlResult.attempts); return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

      const authHeader = req.headers.get('authorization');
      const idToken = authHeader?.replace(/^Bearer\s+/i, '');
      let firebaseUser: { uid: string; email?: string } | null = null;
      if (idToken) { firebaseUser = await verifyFirebaseIdToken(idToken); if (firebaseUser) console.log(`🔐 Authenticated user: ${firebaseUser.uid}`); else console.warn('⚠️ Invalid Firebase token, proceeding as guest'); }

      if (!apiToken) return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const clientIpAtCreate = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || null;
      const clientUaAtCreate = req.headers.get('user-agent') || null;
      const body = await req.json();
      const { orderId, customer, utmParameters } = body;
      let amount: number = body.amount;

      if (!orderId || typeof orderId !== 'string' || orderId.length > 100) return new Response(JSON.stringify({ error: 'orderId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const isUpsell = orderId.startsWith('upsell-');

      // ── Recalculate amount server-side for main orders ──
      if (!isUpsell) {
        const orderFields = await getDocFields('ordens', orderId);
        if (!orderFields) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const at3 = await getFirebaseAccessToken();
        const oiUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`;
        const oiRes = await fetch(oiUrl, { headers: { 'Authorization': `Bearer ${at3}` } });
        const oiData = oiRes.ok ? await oiRes.json() : { documents: [] };
        const orderItemsResults = (oiData.documents || []).map((doc: any) => ({ document: doc }));
        if (!orderItemsResults.length) return new Response(JSON.stringify({ error: 'Order items not found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const productCache = new Map<string, any>();
        const validItems: Array<{ productId: string; quantity: number; name: string }> = [];
        for (const result of orderItemsResults) {
          if (!result.document) continue;
          const itemFields = result.document.fields;
          const productId = itemFields?.product_id?.stringValue;
          const quantity = parseInt(itemFields?.quantity?.integerValue || '1');
          const name = itemFields?.product_name?.stringValue || 'Produto';
          if (!productId) return new Response(JSON.stringify({ error: 'Invalid order item' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          validItems.push({ productId, quantity, name });
        }

        const uniqueProductIds = [...new Set(validItems.map(i => i.productId))];
        const productResults = await Promise.all(uniqueProductIds.map(pid => getDocFields('products', pid).then(f => ({ pid, fields: f }))));
        for (const { pid, fields } of productResults) {
          if (!fields) return new Response(JSON.stringify({ error: `Product ${pid} not found` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          productCache.set(pid, fields);
        }

        let recalculatedTotal = 0;
        for (const { productId, quantity } of validItems) {
          const pf = productCache.get(productId)!;
          recalculatedTotal += Number(pf.price?.doubleValue || pf.price?.integerValue || 0) * quantity;
        }

        const couponId = orderFields.coupon_id?.stringValue;
        if (couponId) {
          const couponFields = await getDocFields('coupons', couponId);
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
        if (serverAmountCents < 100) return new Response(JSON.stringify({ error: 'Order amount too low' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const orderUserId = orderFields.user_id?.stringValue;
        if (orderUserId) {
          const floodRl = await checkRateLimitFirestore(`flood_${orderUserId}`, 10, 3600_000, 3600_000);
          if (!floodRl.allowed) { console.warn(`🚨 ORDER FLOOD (PIX): user ${orderUserId}`); return new Response(JSON.stringify({ error: 'Muitos pedidos pendentes.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
        }

        const clientTotal = Number(orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0);
        if (Math.abs(clientTotal - recalculatedTotal) > 0.01) console.warn(`🚨 PRICE MISMATCH! Client: R$${clientTotal}, Server: R$${recalculatedTotal}`);
        amount = serverAmountCents;
        console.log(`🔒 Server-recalculated: ${amount} cents (order ${orderId})`);
      } else {
        // Upsell: verify price from post_payment_pages
        const addonType = body.addonType;
        if (addonType) {
          const pageResults = await queryFirestore('post_payment_pages', 'addon_type', 'EQUAL', addonType);
          if (pageResults?.[0]?.document) {
            const pageFields = pageResults[0].document.fields;
            if (pageFields?.is_active?.booleanValue !== false) {
              const pagePrice = Number(pageFields?.price?.doubleValue || pageFields?.price?.integerValue || 0);
              const serverUpsellCents = Math.round(pagePrice * 100);
              if (serverUpsellCents >= 100) {
                amount = serverUpsellCents;
                console.log(`🔒 Upsell server-verified: ${amount} cents`);
              }
            }
          }
        }
        if (!amount || amount < 100) return new Response(JSON.stringify({ error: 'Amount must be at least 100' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const description = isUpsell ? `Upsell ${orderId.substring(7, 30)}` : `Pedido ${orderId.substring(0, 8).toUpperCase()}`;

      // ── Build postback URL ──
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const postbackUrl = `${supabaseUrl}/functions/v1/invictuspay-webhook`;

      // ── Build cart for InvictusPay ──
      const cart = [{
        product_hash: INVICTUSPAY_PRODUCT_HASH,
        title: description,
        price: amount,
        quantity: 1,
        operation_type: 1,
        tangible: false,
      }];

      // ── Build tracking ──
      const tracking: Record<string, string> = {};
      if (utmParameters) {
        if (utmParameters.utm_source) tracking.utm_source = utmParameters.utm_source;
        if (utmParameters.utm_medium) tracking.utm_medium = utmParameters.utm_medium;
        if (utmParameters.utm_campaign) tracking.utm_campaign = utmParameters.utm_campaign;
        if (utmParameters.utm_content) tracking.utm_content = utmParameters.utm_content;
        if (utmParameters.utm_term) tracking.utm_term = utmParameters.utm_term;
      }

      // ── Build customer for InvictusPay ──
      const invictusCustomer: Record<string, string> = {};
      if (customer?.name) invictusCustomer.name = customer.name;
      if (customer?.email) invictusCustomer.email = customer.email;
      if (customer?.phone) invictusCustomer.phone_number = customer.phone.replace(/\D/g, '');
      if (customer?.taxId) invictusCustomer.document = customer.taxId.replace(/\D/g, '');

      // For upsells, fetch customer data from the parent order if not provided
      if (isUpsell && Object.keys(invictusCustomer).length === 0) {
        // Extract parent orderId from "upsell-{orderId}-{addonType}"
        const upsellParts = orderId.replace(/^upsell-/, '');
        const lastDash = upsellParts.lastIndexOf('-');
        const parentOrderId = lastDash > 0 ? upsellParts.substring(0, lastDash) : upsellParts;
        try {
          const parentFields = await getDocFields('ordens', parentOrderId);
          if (parentFields) {
            const pName = parentFields.customer_name?.stringValue || '';
            const pEmail = parentFields.customer_email?.stringValue || '';
            const pPhone = parentFields.customer_phone?.stringValue || '';
            const pDoc = parentFields.customer_document?.stringValue || parentFields.customer_cpf?.stringValue || '';
            if (pName) invictusCustomer.name = pName;
            if (pEmail) invictusCustomer.email = pEmail;
            if (pPhone) invictusCustomer.phone_number = pPhone.replace(/\D/g, '');
            if (pDoc) invictusCustomer.document = pDoc.replace(/\D/g, '');
            console.log(`📋 Upsell customer fetched from parent order ${parentOrderId}`);
          }
        } catch (e) { console.warn('⚠️ Failed to fetch parent order customer:', e); }
      }

      const requestBody: Record<string, unknown> = {
        amount,
        offer_hash: INVICTUSPAY_OFFER_HASH,
        payment_method: 'pix',
        ...(Object.keys(invictusCustomer).length > 0 ? { customer: invictusCustomer } : {}),
        cart,
        transaction_origin: 'api',
        postback_url: postbackUrl,
      };
      if (Object.keys(tracking).length > 0) requestBody.tracking = tracking;

      console.log('🔵 Creating InvictusPay PIX transaction:', { amount, orderId });

      const response = await fetch(`${INVICTUSPAY_BASE}/transactions?api_token=${apiToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log('🔵 InvictusPay response:', JSON.stringify(data).substring(0, 500));

      if (!response.ok) {
        console.error('❌ InvictusPay error:', JSON.stringify(data));
        return new Response(JSON.stringify({ error: data.message || data.error || 'Failed to create PIX charge' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── Extract PIX data from InvictusPay response ──
      // InvictusPay may return data in various structures, try multiple paths
      const txData = data?.data || data?.transaction || data;
      const transactionHash = txData?.hash || txData?.transaction_hash || data?.hash || data?.transaction_hash || txData?.id || data?.id || '';

      // PIX QR code / brCode extraction — tolerate nested/wrapped gateway payloads
      const pixCandidates = [
        txData?.pix,
        data?.pix,
        data?.data?.pix,
        txData?.payment,
        data?.payment,
        txData,
        data?.data,
        data,
      ].filter(Boolean);
      const pixObj = pixCandidates.find((p: any) => p?.pix_qr_code || p?.qr_code || p?.qr_code_text || p?.pix_code || p?.brCode || p?.emv || p?.copy_paste || p?.qr_code_base64 || p?.pix_url || p?.qr_code_image || p?.qr_code_url || p?.qrcode) || {};
      const brCode = pixObj.pix_qr_code || pixObj.qr_code || pixObj.qr_code_text || pixObj.pix_code || pixObj.brCode || pixObj.emv || pixObj.copy_paste || pixObj.qrcode || '';
      const qrCodeImage = pixObj.qr_code_url || pixObj.qr_code_image || pixObj.qrCodeImage || pixObj.qr_code_base64 || pixObj.pix_url || '';

      if (!brCode && !qrCodeImage) {
        console.error('❌ No PIX code found in response. Full data:', JSON.stringify(data));
        return new Response(JSON.stringify({ error: 'PIX code not found in gateway response', debug_keys: Object.keys(txData) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Store transaction hash in order (reusing flowpay_charge_id field)
      if (orderId && !isUpsell) {
        try {
          await updateDocOrThrow('ordens', orderId, {
            flowpay_charge_id: transactionHash,
            ...(utmParameters ? { utm_parameters: utmParameters } : {}),
            ...(clientIpAtCreate ? { client_ip: clientIpAtCreate } : {}),
            ...(clientUaAtCreate ? { client_ua: clientUaAtCreate } : {}),
          });
        } catch (err) { console.warn('⚠️ Failed to store transactionHash:', err); }
      }

      // For upsells, store in sale_addon
      if (isUpsell) {
        try {
          // Parse "upsell-{uuid}-{addonType}" — use lastIndexOf to handle addonTypes with dashes
          const upsellBody = orderId.replace(/^upsell-/, '');
          const lastDash = upsellBody.lastIndexOf('-');
          const baseOrderId = lastDash > 0 ? upsellBody.substring(0, lastDash) : upsellBody;
          const upsellAddonType = lastDash > 0 ? upsellBody.substring(lastDash + 1) : '';
          const addonResults = await queryFirestore('sale_addons', 'order_id', 'EQUAL', baseOrderId);
          if (addonResults) {
            for (const r of addonResults) {
              if (r.document?.fields?.addon_type?.stringValue === upsellAddonType) {
                const addonDocId = r.document.name.split('/').pop()!;
                await updateDocOrThrow('sale_addons', addonDocId, { flowpay_charge_id: transactionHash });
                console.log(`🔗 Upsell transactionHash stored in sale_addon ${addonDocId}`);
                break;
              }
            }
          }
        } catch (err) { console.warn('⚠️ Failed to store upsell transactionHash:', err); }
      }

      // Return same format as before for frontend compatibility
      return new Response(JSON.stringify({
        success: true,
        chargeId: transactionHash,
        brCode: brCode,
        qrCodeImage: qrCodeImage,
        expiresAt: txData.expires_at || null,
      }), { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== CHECK STATUS (InvictusPay) ====================
    if (req.method === 'GET' && action === 'status') {
      if (!apiToken) return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const chargeId = url.searchParams.get('chargeId');
      if (!chargeId) return new Response(JSON.stringify({ error: 'chargeId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const expectedOrderId = url.searchParams.get('orderId');
      if (!expectedOrderId) return new Response(JSON.stringify({ error: 'orderId is required for status check' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // ── Ownership validation ──
      const statusAuthHeader = req.headers.get('authorization');
      const statusIdToken = statusAuthHeader?.replace(/^Bearer\s+/i, '');
      let statusCallerUid: string | null = null;
      let canAttemptSideEffects = false;
      if (statusIdToken) { const fbUser = await verifyFirebaseIdToken(statusIdToken); if (fbUser) statusCallerUid = fbUser.uid; }

      const isUpsellStatus = expectedOrderId.startsWith('upsell-');
      const ownershipCheck = isUpsellStatus ? null : await getDocFields('ordens', expectedOrderId);

      if (!isUpsellStatus && (!ownershipCheck || ownershipCheck.flowpay_charge_id?.stringValue !== chargeId)) {
        console.warn(`🚨 Ownership mismatch: orderId=${expectedOrderId} chargeId=${chargeId}`);
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (isUpsellStatus) {
        canAttemptSideEffects = true;
      } else if (ownershipCheck) {
        const ownerUid = ownershipCheck.user_id?.stringValue;
        if (statusCallerUid) { canAttemptSideEffects = (ownerUid === statusCallerUid); }
        else if (ownerUid?.startsWith('guest_')) { canAttemptSideEffects = true; }
      }

      // ── Query InvictusPay for transaction status ──
      const response = await fetch(`${INVICTUSPAY_BASE}/transactions/${chargeId}?api_token=${apiToken}`, {
        headers: { 'Accept': 'application/json' },
      });
      const data = await response.json();

      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || data.error || 'Failed to check status' }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const txData = data.data || data.transaction || data;
      const txStatus = txData.status;
      // Map InvictusPay status to our internal format
      const isPaid = txStatus === 'paid' || txStatus === 'approved';
      const mappedStatus = isPaid ? 'COMPLETED' : txStatus === 'pending' ? 'PENDING' : txStatus?.toUpperCase() || 'UNKNOWN';

      if (isPaid && canAttemptSideEffects) {
        try {
          const queryResults = await queryFirestore('ordens', 'flowpay_charge_id', 'EQUAL', chargeId);
          const orderDoc = queryResults?.[0]?.document;
          if (orderDoc) {
            const orderId = orderDoc.name.split('/').pop()!;
            await processOrderPaid(orderId, orderDoc.fields, chargeId, 'polling');
          } else {
            const addonResults = await queryFirestore('sale_addons', 'flowpay_charge_id', 'EQUAL', chargeId);
            if (addonResults?.[0]?.document) {
              const addonDoc2 = addonResults[0].document;
              const addonId = addonDoc2.name.split('/').pop()!;
              if (addonDoc2.fields?.status?.stringValue !== 'paid') {
                console.log(`🔄 Processing upsell addon ${addonId} via polling`);
                await processAddonPayment(addonDoc2, addonId);
              }
            }
          }
        } catch (fallbackError) { console.warn('⚠️ Purchase fallback error (non-blocking):', fallbackError); }
      }

      return new Response(JSON.stringify({
        success: true,
        status: mappedStatus,
        paidAt: txData.paid_at || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('❌ PIX edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
