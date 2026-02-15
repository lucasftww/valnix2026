import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FLOWPAY_CARD_URL = 'https://flowpayments.net/api/card';
const FIREBASE_PROJECT_ID = 'valnix';

// ── Firebase Service Account Auth (for Firestore price validation) ──
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

Deno.serve(async (req) => {
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

    // CREATE card charge
    if (action === 'create' && req.method === 'POST') {
      const body = await req.json();
      const { orderId, description, customer } = body;
      let amount: number;

      if (!orderId) {
        return new Response(
          JSON.stringify({ success: false, error: 'orderId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 🔒 CRITICAL: Recalculate total from REAL product prices (never trust client total_amount)
      const orderFields = await getFirestoreDoc('orders', orderId);
      if (!orderFields) {
        console.error(`❌ Order not found: ${orderId}`);
        return new Response(
          JSON.stringify({ success: false, error: 'Order not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch order_items to get product_ids and quantities
      const orderItemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
      if (!orderItemsResults || !Array.isArray(orderItemsResults) || orderItemsResults.length === 0 || !orderItemsResults[0]?.document) {
        console.error(`❌ No order items found for order ${orderId}`);
        return new Response(
          JSON.stringify({ success: false, error: 'Order items not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Recalculate total from real product prices
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
        console.log(`  📦 Product ${productId}: R$${realPrice} x ${quantity}`);
      }

      // Apply coupon discount if present (server-side validation)
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
            console.log(`🏷️ Coupon ${couponId}: -R$${discountAmount.toFixed(2)}`);
          }
        }
      }

      // Log if client total differs (potential manipulation)
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

      const flowpayResponse = await fetch(`${FLOWPAY_CARD_URL}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          value: amount,
          description: description || `Pedido ${orderId?.substring(0, 8) || 'VALNIX'}`,
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

      return new Response(
        JSON.stringify({
          success: true,
          paymentId: flowpayData.payment.id,
          paymentUrl: flowpayData.payment.paymentUrl,
          status: flowpayData.payment.status,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CHECK STATUS
    if (action === 'status' && req.method === 'GET') {
      const paymentId = url.searchParams.get('id');
      if (!paymentId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Payment ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action. Use ?action=create or ?action=status&id=...' }),
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
