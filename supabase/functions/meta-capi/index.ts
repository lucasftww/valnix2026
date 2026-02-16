import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Meta Conversions API (CAPI) Edge Function
// Now logs to Firestore instead of Supabase

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

const META_API_VERSION = 'v22.0';
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
  if (typeof val === 'number') return { doubleValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  return { stringValue: String(val) };
}

// ── Parse first public IP from x-forwarded-for ────────────────────
function parsePublicIp(rawIp: string | undefined): string | undefined {
  if (!rawIp) return undefined;
  const ips = rawIp.split(',').map(ip => ip.trim()).filter(Boolean);
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^::1$/,
    /^fd[0-9a-f]{2}:/i,    // IPv6 ULA (fc00::/7)
    /^fc[0-9a-f]{2}:/i,    // IPv6 ULA (fc00::/7)
    /^fe80:/i,              // IPv6 link-local
  ];
  for (const ip of ips) {
    // Strip IPv4-mapped IPv6 prefix (::ffff:192.168.1.1 → 192.168.1.1)
    const normalized = ip.replace(/^::ffff:/i, '');
    if (!privateRanges.some(r => r.test(normalized))) return normalized;
  }
  return ips[0]?.replace(/^::ffff:/i, ''); // fallback to first IP if all are private
}

// ── SHA-256 hash helper ────────────────────────────────────────────
async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Build user_data with hashed PII ────────────────────────────────
async function buildUserData(params: {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  clientIp?: string; userAgent?: string; fbc?: string; fbp?: string; externalId?: string;
}) {
  const userData: Record<string, string | undefined> = {};
  if (params.email) userData.em = await sha256(params.email);
  if (params.phone) {
    let phone = params.phone.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) phone = '55' + phone;
    userData.ph = await sha256(phone);
  }
  if (params.firstName) userData.fn = await sha256(params.firstName);
  if (params.lastName) userData.ln = await sha256(params.lastName);
  if (params.externalId) userData.external_id = await sha256(params.externalId);
  if (params.clientIp) userData.client_ip_address = params.clientIp;
  if (params.userAgent) userData.client_user_agent = params.userAgent;
  if (params.fbc) userData.fbc = params.fbc;
  if (params.fbp) userData.fbp = params.fbp;
  userData.country = 'br';
  return userData;
}

// ── Send event to Meta CAPI ────────────────────────────────────────
async function sendToMeta(eventPayload: Record<string, unknown>, testEventCode?: string) {
  const pixelId = Deno.env.get('META_PIXEL_ID');
  const accessToken = Deno.env.get('META_ACCESS_TOKEN');
  if (!pixelId || !accessToken) {
    console.error('❌ META_PIXEL_ID or META_ACCESS_TOKEN not configured');
    return { success: false, error: 'Meta CAPI not configured' };
  }
  const body: Record<string, unknown> = { data: [eventPayload] };
  if (testEventCode) body.test_event_code = testEventCode;
  else {
    const envTestCode = Deno.env.get('META_TEST_EVENT_CODE');
    if (envTestCode) body.test_event_code = envTestCode;
  }
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('❌ Meta CAPI error:', JSON.stringify(data));
      return { success: false, error: data.error?.message || 'Meta API error', statusCode: response.status };
    }
    console.log('✅ Meta CAPI event sent:', JSON.stringify(data));
    return { success: true, data };
  } catch (error) {
    console.error('❌ Meta CAPI fetch error:', error);
    return { success: false, error: String(error) };
  }
}

// ── Log event to Firestore ─────────────────────────────────────────
async function logCapiEvent(
  eventName: string, eventId: string, orderId: string | null,
  result: { success: boolean; error?: string; statusCode?: number }
) {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/capi_event_log`;
    const fields: Record<string, unknown> = {
      event_name: toFirestoreValue(eventName),
      event_id: toFirestoreValue(eventId),
      order_id: toFirestoreValue(orderId),
      status: toFirestoreValue(result.success ? 'sent' : 'failed'),
      error_message: toFirestoreValue(result.error || null),
      status_code: toFirestoreValue(result.statusCode || null),
      created_at: toFirestoreValue(new Date().toISOString()),
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ fields }),
    });
  } catch (e) {
    console.warn('⚠️ CAPI log insert failed:', e);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      event_name, event_id, order_id, value, currency = 'BRL',
      content_name, content_ids, contents, content_type = 'product', num_items,
      event_source_url, email, phone, first_name, last_name,
      external_id, client_ip, user_agent, fbc, fbp, test_event_code,
    } = body;

    if (!event_name) {
      return new Response(JSON.stringify({ error: 'event_name is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resolvedIp = client_ip 
      ? parsePublicIp(client_ip) 
      : parsePublicIp(req.headers.get('x-forwarded-for') || undefined)
        || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || undefined;
    const resolvedUa = user_agent || req.headers.get('user-agent') || undefined;
    const resolvedEventId = event_id || `${order_id || 'evt'}_${Date.now()}`;

    const userData = await buildUserData({
      email, phone, firstName: first_name, lastName: last_name,
      clientIp: resolvedIp, userAgent: resolvedUa, fbc, fbp, externalId: external_id,
    });

    const eventPayload: Record<string, unknown> = {
      event_name, event_time: Math.floor(Date.now() / 1000),
      event_id: resolvedEventId, action_source: 'website', user_data: userData,
    };
    if (event_source_url) eventPayload.event_source_url = event_source_url;
    if (value !== undefined) {
      const customData: Record<string, unknown> = {
        value: Number(value), currency,
        ...(content_name ? { content_name } : {}),
        ...(content_ids ? { content_ids } : {}),
        ...(contents && Array.isArray(contents) && contents.length > 0 ? { contents } : {}),
        content_type,
        ...(num_items ? { num_items: Number(num_items) } : {}),
      };
      eventPayload.custom_data = customData;
    }

    console.log(`📡 Sending ${event_name} to Meta CAPI (event_id: ${resolvedEventId})`);
    const result = await sendToMeta(eventPayload, test_event_code);
    await logCapiEvent(event_name, resolvedEventId, order_id || null, result);

    return new Response(JSON.stringify({
      success: result.success, event_id: resolvedEventId,
      ...(result.error ? { error: result.error } : {}),
    }), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Meta CAPI edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
