import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: val.toString() };
    return { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
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

async function createDoc(col: string, docId: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ Failed ${col}/${docId}:`, err.substring(0, 200));
    return false;
  }
  console.log(`✅ Created ${col}/${docId}`);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const now = new Date().toISOString();
    const results: string[] = [];

    // ── Create Category: Valorant VP ──
    const categoryId = 'valorant-vp';
    const catResult = await createDoc('categories', categoryId, {
      name: 'Valorant VP',
      slug: 'valorant-vp',
      description: 'Pontos Valorant (VP) para comprar skins e itens no jogo',
      image_url: null,
      icon_url: null,
      is_active: true,
      display_order: 0,
      created_at: now,
      updated_at: now,
    });
    results.push(catResult ? '✅ Categoria: Valorant VP' : '❌ Categoria falhou');

    // ── Create Products ──
    const products = [
      {
        id: 'e15a35fa-584e-4b18-89c8-7d54abaf386a',
        name: '400 VP',
        price: 16,
        old_price: null,
        discount: null,
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770088478488-hqllcp.webp',
        display_order: 0,
        sold: 2,
      },
      {
        id: 'f35e878c-b880-4288-8d49-90f17f332d36',
        name: '1305 VP',
        price: 32,
        old_price: null,
        discount: null,
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089519590-gz0ugc.webp',
        display_order: 1,
        sold: 1,
      },
      {
        id: '10064493-61ac-4be8-a418-bac350d3fd90',
        name: '2050 VP',
        price: 60,
        old_price: null,
        discount: null,
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089555575-iaogmy.webp',
        display_order: 2,
        sold: 2,
      },
      {
        id: '6fc6be0a-4d0a-4d46-8347-8db02420130e',
        name: '5350 VP',
        price: 89,
        old_price: null,
        discount: null,
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089744380-5j3vql.webp',
        display_order: 3,
        sold: 3,
      },
      {
        id: '303d0e00-b68f-4e01-b513-ab0a2a2a3bbf',
        name: '11.000 VP',
        price: 150,
        old_price: null,
        discount: null,
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770090471159-89in2.webp',
        display_order: 4,
        sold: 10,
      },
    ];

    for (const p of products) {
      const result = await createDoc('products', p.id, {
        name: p.name,
        description: `${p.name} - Valorant Points`,
        rich_description: null,
        instructions: null,
        terms_conditions: null,
        video_url: null,
        price: p.price,
        old_price: p.old_price,
        discount: p.discount,
        category: 'valorant-vp',
        image_url: p.image_url,
        icon_url: null,
        stock: 999999,
        sold: p.sold,
        display_order: p.display_order,
        featured: true,
        is_active: true,
        is_featured_in_category: false,
        delivery_type: 'auto_fake',
        auto_delivery_codes: null,
        created_at: now,
        updated_at: now,
      });
      results.push(result ? `✅ Produto: ${p.name} (R$${p.price})` : `❌ Produto falhou: ${p.name}`);
    }

    return new Response(JSON.stringify({ success: true, results }), {
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
