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
  for (const [k, v] of Object.entries(data)) fields[k] = toFirestoreValue(v);
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

    // ════════════════════════════════════════
    // CATEGORIAS
    // ════════════════════════════════════════

    const categories = [
      {
        id: 'valorant-vp',
        name: 'Valorant VP',
        slug: 'valorant-vp',
        description: 'Pontos Valorant (VP) para comprar skins e itens no jogo',
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/categories/valorant.webp',
        show_on_homepage: true,
        display_order: 0,
      },
      {
        id: 'league-of-legends',
        name: 'League of Legends',
        slug: 'league-of-legends',
        description: 'Riot Points (RP) para League of Legends',
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/categories/lol.webp',
        show_on_homepage: true,
        display_order: 1,
      },
      {
        id: 'roblox',
        name: 'Roblox',
        slug: 'roblox',
        description: 'Robux para Roblox',
        image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/categories/roblox.webp',
        show_on_homepage: true,
        display_order: 2,
      },
    ];

    for (const cat of categories) {
      const r = await createDoc('categories', cat.id, {
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        image_url: cat.image_url,
        icon_url: null,
        is_active: true,
        show_on_homepage: cat.show_on_homepage,
        parent_id: null,
        display_order: cat.display_order,
        created_at: now,
        updated_at: now,
      });
      results.push(r ? `✅ Categoria: ${cat.name}` : `❌ Categoria falhou: ${cat.name}`);
    }

    // ════════════════════════════════════════
    // PRODUTOS VALORANT VP (já existem, atualizar)
    // ════════════════════════════════════════

    const valorantProducts = [
      { id: 'e15a35fa-584e-4b18-89c8-7d54abaf386a', name: '400 VP', price: 16, image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770088478488-hqllcp.webp', display_order: 0 },
      { id: 'f35e878c-b880-4288-8d49-90f17f332d36', name: '1305 VP', price: 32, image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089519590-gz0ugc.webp', display_order: 1 },
      { id: '10064493-61ac-4be8-a418-bac350d3fd90', name: '2050 VP', price: 60, image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089555575-iaogmy.webp', display_order: 2 },
      { id: '6fc6be0a-4d0a-4d46-8347-8db02420130e', name: '5350 VP', price: 89, image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770089744380-5j3vql.webp', display_order: 3 },
      { id: '303d0e00-b68f-4e01-b513-ab0a2a2a3bbf', name: '11.000 VP', price: 150, image_url: 'https://eaopplkduexntxukikke.supabase.co/storage/v1/object/public/product-images/products/main/1770090471159-89in2.webp', display_order: 4 },
    ];

    for (const p of valorantProducts) {
      const r = await createDoc('products', p.id, {
        name: p.name, description: `${p.name} - Valorant Points`, rich_description: null, instructions: null, terms_conditions: null, video_url: null,
        price: p.price, old_price: null, discount: null, category: 'valorant-vp', image_url: p.image_url, icon_url: null,
        stock: 999999, sold: 0, display_order: p.display_order, featured: true, is_active: true, is_featured_in_category: false,
        delivery_type: 'auto_fake', auto_delivery_codes: null, created_at: now, updated_at: now,
      });
      results.push(r ? `✅ VP: ${p.name} R$${p.price}` : `❌ VP falhou: ${p.name}`);
    }

    // ════════════════════════════════════════
    // PRODUTOS ROBLOX (do screenshot: 3600 R$90, 7000 R$140, 10000 R$160)
    // ════════════════════════════════════════

    const robloxProducts = [
      { id: 'rbx-400', name: '400 Robux', price: 22, display_order: 0 },
      { id: 'rbx-800', name: '800 Robux', price: 40, display_order: 1 },
      { id: 'rbx-1700', name: '1700 Robux', price: 60, display_order: 2 },
      { id: 'rbx-3600', name: '3600 Robux', price: 90, display_order: 3 },
      { id: 'rbx-7000', name: '7000 Robux', price: 140, display_order: 4 },
      { id: 'rbx-10000', name: '10.000 Robux', price: 160, display_order: 5 },
    ];

    for (const p of robloxProducts) {
      const r = await createDoc('products', p.id, {
        name: p.name, description: `${p.name} - Roblox`, rich_description: null, instructions: null, terms_conditions: null, video_url: null,
        price: p.price, old_price: null, discount: null, category: 'roblox', image_url: null, icon_url: null,
        stock: 999999, sold: 0, display_order: p.display_order, featured: true, is_active: true, is_featured_in_category: false,
        delivery_type: 'auto_fake', auto_delivery_codes: null, created_at: now, updated_at: now,
      });
      results.push(r ? `✅ Roblox: ${p.name} R$${p.price}` : `❌ Roblox falhou: ${p.name}`);
    }

    // ════════════════════════════════════════
    // PRODUTOS LOL (preços típicos BR)
    // ════════════════════════════════════════

    const lolProducts = [
      { id: 'lol-650rp', name: '650 RP', price: 25, display_order: 0 },
      { id: 'lol-1380rp', name: '1380 RP', price: 50, display_order: 1 },
      { id: 'lol-2800rp', name: '2800 RP', price: 100, display_order: 2 },
      { id: 'lol-5000rp', name: '5000 RP', price: 150, display_order: 3 },
      { id: 'lol-10800rp', name: '10800 RP', price: 300, display_order: 4 },
    ];

    for (const p of lolProducts) {
      const r = await createDoc('products', p.id, {
        name: p.name, description: `${p.name} - League of Legends Riot Points`, rich_description: null, instructions: null, terms_conditions: null, video_url: null,
        price: p.price, old_price: null, discount: null, category: 'league-of-legends', image_url: null, icon_url: null,
        stock: 999999, sold: 0, display_order: p.display_order, featured: true, is_active: true, is_featured_in_category: false,
        delivery_type: 'auto_fake', auto_delivery_codes: null, created_at: now, updated_at: now,
      });
      results.push(r ? `✅ LoL: ${p.name} R$${p.price}` : `❌ LoL falhou: ${p.name}`);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Restore error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
