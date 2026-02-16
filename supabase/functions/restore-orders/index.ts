import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Restore orders — reads from Firestore guest_orders collection
// Now requires admin authentication via Firebase token

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-token',
};

const FIREBASE_PROJECT_ID = 'valnix';

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

// ── Auth helpers ──────────────────────────────────────────────────
async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email: string } | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${Deno.env.get('FIREBASE_WEB_API_KEY') || ''}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email || '' };
  } catch { return null; }
}

async function isAdminInFirestore(uid: string): Promise<boolean> {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const doc = await res.json();
    return doc.fields?.role?.stringValue === 'admin';
  } catch { return false; }
}

// ── Firestore helpers ──────────────────────────────────────────────
function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { doubleValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const mapFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) mapFields[k] = toFirestoreValue(v);
    return { mapValue: { fields: mapFields } };
  }
  return { stringValue: String(val) };
}

function extractVal(field: any): any {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.arrayValue) return (field.arrayValue.values || []).map(extractVal);
  if (field.mapValue) {
    const obj: any = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) obj[k] = extractVal(v);
    return obj;
  }
  return null;
}

async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 404 || !res.ok) return null;
  return await res.json();
}

async function createFirestoreDoc(col: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

async function queryAllFirestore(col: string, filters?: { field: string; op: string; value: unknown }[]) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const structuredQuery: any = { from: [{ collectionId: col }], limit: 10000 };
  if (filters && filters.length > 0) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: filters.map(f => ({
          fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toFirestoreValue(f.value) }
        }))
      }
    };
  }
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) return [];
  const results = await res.json();
  return Array.isArray(results) ? results.filter((r: any) => r.document) : [];
}

async function deleteFirestoreDoc(col: string, docId: string): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
  return res.ok || res.status === 404;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // ── Admin authentication required ──
    const firebaseToken = req.headers.get('x-firebase-token');
    if (!firebaseToken) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userData = await verifyFirebaseToken(firebaseToken);
    if (!userData) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isAdmin = await isAdminInFirestore(userData.uid);
    if (!isAdmin) {
      console.warn(`⚠️ Unauthorized restore attempt: ${userData.email} (${userData.uid})`);
      return new Response(JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get all guest_orders from Firestore
    const guestOrderDocs = await queryAllFirestore('guest_orders');

    // Query ONLY Purchase events (filtered server-side, not full table scan)
    const analyticsResults = await queryAllFirestore('analytics_events', [
      { field: 'event_name', op: 'EQUAL', value: 'Purchase' }
    ]);
    const paidOrderIds = new Set<string>();
    for (const r of analyticsResults) {
      const f = r.document?.fields;
      if (f?.order_id?.stringValue) {
        paidOrderIds.add(f.order_id.stringValue);
      }
    }

    // Deduplicate guest orders by order_id
    const uniqueOrders = new Map<string, any>();
    for (const r of guestOrderDocs) {
      const f = r.document.fields;
      const orderId = extractVal(f.order_id);
      if (orderId && !uniqueOrders.has(orderId)) {
        uniqueOrders.set(orderId, { fields: f, doc: r.document });
      }
    }

    let restored = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const [orderId, { fields: f }] of uniqueOrders) {
      const orderData = extractVal(f.order_data);
      const hasDeliveryCode = orderData?.items?.some((item: any) => item.delivery_code);
      const confirmedPaid = paidOrderIds.has(orderId);

      if (!hasDeliveryCode && !confirmedPaid) { skipped++; continue; }

      // Idempotency: check if order already exists
      const existing = await getFirestoreDoc('orders', orderId);
      if (existing) { details.push(`⏭️ ${orderId} já existe`); skipped++; continue; }

      const email = extractVal(f.email);
      const customerName = extractVal(f.customer_name);
      const customerPhone = extractVal(f.customer_phone);
      const userId = extractVal(f.user_id);

      const orderFields: Record<string, unknown> = {
        customer_name: toFirestoreValue(customerName || ''),
        customer_email: toFirestoreValue(email),
        customer_phone: toFirestoreValue(customerPhone),
        total_amount: toFirestoreValue(orderData?.total_amount || 0),
        status: toFirestoreValue('completed'),
        payment_status: toFirestoreValue('paid'),
        payment_method: toFirestoreValue(orderData?.payment_method || 'pix'),
        user_id: toFirestoreValue(userId || 'guest'),
        shipping_address: toFirestoreValue(null),
        shipping_method: toFirestoreValue(null),
        tracking_code: toFirestoreValue(null),
        notes: toFirestoreValue('Restaurado do guest_orders'),
        flowpay_charge_id: toFirestoreValue(null),
        created_at: toFirestoreValue(orderData?.created_at || new Date().toISOString()),
        updated_at: toFirestoreValue(new Date().toISOString()),
      };

      const orderCreated = await createFirestoreDoc('orders', orderId, orderFields);
      if (!orderCreated) { details.push(`❌ Falha ao criar pedido ${orderId}`); continue; }

      // Create order_items with rollback on failure
      const createdItemIds: string[] = [];
      let itemsFailed = false;

      for (const item of orderData?.items || []) {
        const itemId = `restored_${orderId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const itemFields: Record<string, unknown> = {
          order_id: toFirestoreValue(orderId),
          product_id: toFirestoreValue('unknown'),
          product_name: toFirestoreValue(item.product_name || ''),
          product_image: toFirestoreValue(item.product_image || null),
          quantity: toFirestoreValue(item.quantity || 1),
          unit_price: toFirestoreValue(item.unit_price || 0),
          total_price: toFirestoreValue(item.total_price || 0),
          delivery_code: toFirestoreValue(item.delivery_code || null),
          created_at: toFirestoreValue(orderData?.created_at || new Date().toISOString()),
        };
        const itemCreated = await createFirestoreDoc('order_items', itemId, itemFields);
        if (!itemCreated) {
          itemsFailed = true;
          details.push(`❌ Falha ao criar item ${itemId} do pedido ${orderId} — rollback`);
          break;
        }
        createdItemIds.push(itemId);
      }

      // Rollback: if any item failed, delete order + created items
      if (itemsFailed) {
        await deleteFirestoreDoc('orders', orderId);
        for (const iid of createdItemIds) await deleteFirestoreDoc('order_items', iid);
        continue;
      }

      restored++;
      details.push(`✅ ${orderId} → ${customerName || email} (R$ ${orderData?.total_amount})`);
    }

    return new Response(JSON.stringify({ success: true, restored, skipped, total: uniqueOrders.size, details }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Restore error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});