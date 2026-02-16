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
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
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
  // Extract doc ID from name like "projects/valnix/databases/(default)/documents/orders/abc123"
  const name = result.name || '';
  const parts = name.split('/');
  return parts[parts.length - 1] || null;
}

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

    // Validate user if authenticated
    let callerUid: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const verified = await verifyFirebaseIdToken(token);
      callerUid = verified?.uid || null;
    }

    // Ensure user_id matches caller (if authenticated) or is a guest id
    const userId = order.user_id || '';
    if (callerUid && userId !== callerUid) {
      console.warn(`⚠️ create-order: user_id mismatch. caller=${callerUid}, order.user_id=${userId}`);
    }

    // Basic input validation
    if (!order.customer_name || typeof order.customer_name !== 'string' || order.customer_name.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'Invalid customer name' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!order.customer_email || typeof order.customer_email !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid customer email' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (typeof order.total_amount !== 'number' || order.total_amount < 0.01) {
      return new Response(JSON.stringify({ error: 'Invalid total amount' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const now = new Date().toISOString();

    // Create order document
    const orderData: Record<string, unknown> = {
      user_id: userId,
      customer_name: String(order.customer_name).trim().slice(0, 200),
      customer_email: String(order.customer_email).trim().slice(0, 255),
      customer_phone: order.customer_phone ? String(order.customer_phone).trim().slice(0, 30) : null,
      total_amount: Number(order.total_amount),
      notes: order.notes ? String(order.notes).slice(0, 500) : null,
      status: 'pending',
      payment_status: 'pending',
      payment_method: order.payment_method ? String(order.payment_method).slice(0, 20) : null,
      fbc: order.fbc || null,
      fbp: order.fbp || null,
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

    // Create order items
    for (const item of items) {
      const itemData: Record<string, unknown> = {
        order_id: orderId,
        product_id: String(item.product_id || ''),
        product_name: String(item.product_name || '').slice(0, 200),
        product_image: item.product_image || null,
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total_price: Number(item.total_price) || 0,
        delivery_code: null,
        delivery_type: item.delivery_type || 'manual',
        created_at: now,
      };
      await addFirestoreDoc('order_items', itemData);
    }

    console.log(`✅ ${items.length} order items created for order ${orderId}`);

    // Save coupon info if present
    if (order.coupon_id && order.coupon_code) {
      try {
        const accessToken = await getFirebaseAccessToken();
        const fieldPaths = 'updateMask.fieldPaths=coupon_id&updateMask.fieldPaths=coupon_code';
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${orderId}?${fieldPaths}`;
        await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({
            fields: {
              coupon_id: { stringValue: String(order.coupon_id) },
              coupon_code: { stringValue: String(order.coupon_code) },
            },
          }),
        });
      } catch (err) {
        console.warn('⚠️ Failed to save coupon info:', err);
      }
    }

    return new Response(JSON.stringify({ success: true, orderId }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('❌ create-order error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
