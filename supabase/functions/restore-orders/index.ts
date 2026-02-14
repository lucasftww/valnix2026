import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIREBASE_PROJECT_ID = 'valnix';

// ── Firebase Auth ──────────────────────────────────────────────────
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
    iss: saKey.client_email,
    sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pemBody = saKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`Firebase auth failed: ${tokenRes.status}`);

  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  return cachedAccessToken!;
}

// ── Firestore helpers ──────────────────────────────────────────────
async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

async function createFirestoreDoc(col: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}?documentId=${docId}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ Firestore create failed ${col}/${docId}:`, err.substring(0, 200));
    return false;
  }
  return true;
}

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return { doubleValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'object' && val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const mapFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      mapFields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields: mapFields } };
  }
  return { stringValue: String(val) };
}

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all guest_orders that have delivery codes (= paid & delivered)
    const { data: guestOrders, error } = await supabase
      .from('guest_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Deduplicate by order_id (keep the most recent entry)
    const uniqueOrders = new Map<string, typeof guestOrders[0]>();
    for (const go of guestOrders || []) {
      if (!uniqueOrders.has(go.order_id)) {
        uniqueOrders.set(go.order_id, go);
      }
    }

    let restored = 0;
    let skipped = 0;
    const details: string[] = [];

    for (const [orderId, go] of uniqueOrders) {
      const orderData = go.order_data as any;
      
      // Only restore orders that have delivery codes (confirmed paid)
      const hasDeliveryCode = orderData?.items?.some((item: any) => item.delivery_code);
      if (!hasDeliveryCode) {
        skipped++;
        continue;
      }

      // Check if order already exists in Firestore
      const existing = await getFirestoreDoc('orders', orderId);
      if (existing) {
        skipped++;
        continue;
      }

      // Create order in Firestore
      const orderFields: Record<string, unknown> = {
        customer_name: toFirestoreValue(go.customer_name || ''),
        customer_email: toFirestoreValue(go.email),
        customer_phone: toFirestoreValue(go.customer_phone),
        total_amount: toFirestoreValue(orderData.total_amount || 0),
        status: toFirestoreValue('completed'),
        payment_status: toFirestoreValue('paid'),
        payment_method: toFirestoreValue(orderData.payment_method || 'pix'),
        user_id: toFirestoreValue(go.user_id || 'guest'),
        shipping_address: toFirestoreValue(null),
        shipping_method: toFirestoreValue(null),
        tracking_code: toFirestoreValue(null),
        notes: toFirestoreValue('Restaurado do guest_orders'),
        flowpay_charge_id: toFirestoreValue(null),
        created_at: toFirestoreValue(orderData.created_at || go.created_at),
        updated_at: toFirestoreValue(new Date().toISOString()),
      };

      const orderCreated = await createFirestoreDoc('orders', orderId, orderFields);
      if (!orderCreated) {
        details.push(`❌ Falha ao criar pedido ${orderId}`);
        continue;
      }

      // Create order items
      for (const item of orderData.items || []) {
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
          created_at: toFirestoreValue(orderData.created_at || go.created_at),
        };

        await createFirestoreDoc('order_items', itemId, itemFields);
      }

      restored++;
      details.push(`✅ ${orderId} → ${go.customer_name || go.email} (R$ ${orderData.total_amount})`);
    }

    console.log(`🔄 Restore complete: ${restored} restored, ${skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      restored,
      skipped,
      total: uniqueOrders.size,
      details,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Restore error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

