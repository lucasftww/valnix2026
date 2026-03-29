import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_API_VERSION = 'v22.0';
const ADMIN_SCOPE = 'https://www.googleapis.com/auth/datastore';
const PROJECT_ID = "tiupdhnjdcmgbqifwkrd";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Helpers ───────────────────────────────────────────────────

async function getFirebaseAccessToken(): Promise<string> {
  const sa = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const key = JSON.parse(sa);
  const jwt = await createSignedJWT(key, ADMIN_SCOPE);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  return data.access_token;
}

async function createSignedJWT(key: any, scope: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const keyBuffer = Uint8Array.from(atob(key.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '')), c => c.charCodeAt(0));
  const importedKey = await crypto.subtle.importKey('pkcs8', keyBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', importedKey, new TextEncoder().encode(`${encodedHeader}.${encodedClaim}`));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encodedHeader}.${encodedClaim}.${encodedSignature}`;
}

async function getFirestoreDoc(collection: string, docId: string, token: string) {
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const fields = data.fields || {};
  const obj: Record<string, any> = { id: docId };
  for (const [k, v] of Object.entries(fields)) {
    const val = (v as any).stringValue || (v as any).integerValue || (v as any).doubleValue || (v as any).booleanValue;
    obj[k] = val;
  }
  return obj;
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const getCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
});

// ── Main Handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('x-admin-token');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { event_name, event_id, order_id, value, currency = 'BRL', content_name, content_ids, email, phone, first_name, last_name, external_id, test_event_code, event_time } = body;

    // Fetch credentials internally
    const token = await getFirebaseAccessToken();
    const [metaTokenDoc, metaPixelDoc] = await Promise.all([
      getFirestoreDoc('system_credentials', 'META_ACCESS_TOKEN', token),
      getFirestoreDoc('system_credentials', 'META_PIXEL_ID', token)
    ]);

    const activeToken = metaTokenDoc?.value || Deno.env.get('META_ACCESS_TOKEN');
    const activePixel = metaPixelDoc?.value || Deno.env.get('META_PIXEL_ID');

    if (!activeToken || !activePixel) return new Response(JSON.stringify({ error: 'CAPI credentials missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Build User Data
    const userData: Record<string, any> = {
      client_ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '0.0.0.0',
      client_user_agent: req.headers.get('user-agent') || 'unknown',
      country: await sha256('br')
    };
    if (email) userData.em = await sha256(email);
    if (phone) {
      let ph = phone.replace(/\D/g, '');
      if (!ph.startsWith('55') && ph.length >= 10) ph = '55' + ph;
      userData.ph = await sha256(ph);
    }
    if (first_name) userData.fn = await sha256(first_name);
    if (last_name) userData.ln = await sha256(last_name);
    if (external_id) userData.external_id = await sha256(external_id);

    const eventPayload: Record<string, any> = {
      event_name,
      event_time: event_time ? Number(event_time) : Math.floor(Date.now() / 1000),
      event_id: event_id || `mig_${event_name}_${order_id || Date.now()}`,
      action_source: 'website',
      event_source_url: 'https://www.valnix.com.br',
      user_data: userData,
    };

    if (value !== undefined) {
      eventPayload.custom_data = { value: Number(value), currency, content_name, content_ids: Array.isArray(content_ids) ? content_ids : undefined };
    }

    const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${activePixel}/events?access_token=${activeToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventPayload], test_event_code })
    });

    const metaData = await metaRes.json();
    return new Response(JSON.stringify({ success: metaRes.ok, data: metaData, version: 'v1.1' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
