import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { toFirestoreValue, getFirestoreDoc, parseFirestoreDoc } from '../_shared/firestore.ts';
import { parsePublicIp, sha256, generateEventId } from '../_shared/utils.ts';

const META_API_VERSION = 'v22.0';

// ── Build user_data with hashed PII ────────────────────────────────
async function buildUserData(params: {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  clientIp?: string; userAgent?: string; fbc?: string; fbp?: string; externalId?: string;
}) {
  const userData: Record<string, string | undefined> = {};
  if (params.email) userData.em = await sha256(params.email);
  if (params.phone) {
    let phone = params.phone.replace(/\D/g, '');
    if (!phone.startsWith('55') && phone.length >= 10) phone = '55' + phone;
    userData.ph = await sha256(phone);
  }
  if (params.firstName) userData.fn = await sha256(params.firstName);
  if (params.lastName) userData.ln = await sha256(params.lastName);
  if (params.externalId) userData.external_id = await sha256(params.externalId);
  if (params.clientIp) userData.client_ip_address = params.clientIp;
  if (params.userAgent) userData.client_user_agent = params.userAgent;
  if (params.fbc) userData.fbc = params.fbc;
  if (params.fbp) userData.fbp = params.fbp;
  userData.country = await sha256('br');
  return userData;
}

async function getMetaCredentials() {
  try {
    const [tokenDoc, pixelDoc] = await Promise.all([
      getFirestoreDoc('system_credentials', 'META_ACCESS_TOKEN'),
      getFirestoreDoc('system_credentials', 'META_PIXEL_ID')
    ]);

    const token = tokenDoc ? parseFirestoreDoc(tokenDoc).value : Deno.env.get('META_ACCESS_TOKEN');
    const pixelId = pixelDoc ? parseFirestoreDoc(pixelDoc).value : Deno.env.get('META_PIXEL_ID');

    return { token, pixelId };
  } catch (e) {
    console.warn('⚠️ Failed to fetch credentials from Firestore, using Env variables:', e);
    return {
      token: Deno.env.get('META_ACCESS_TOKEN'),
      pixelId: Deno.env.get('META_PIXEL_ID')
    };
  }
}

async function sendToMeta(eventPayload: Record<string, unknown>, testEventCode?: string) {
  const { token: accessToken, pixelId } = await getMetaCredentials();
  
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
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
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

async function logCapiEvent(eventName: string, eventId: string, orderId: string | null, result: { success: boolean; error?: string; statusCode?: number; data?: any }) {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `${FIRESTORE_BASE}/capi_event_log`;
    const fbtrace = result.data?.fbtrace_id || null;
    const fields: Record<string, unknown> = {
      event_name: toFirestoreValue(eventName), 
      event_id: toFirestoreValue(eventId), 
      order_id: toFirestoreValue(orderId),
      source: toFirestoreValue('server'), 
      status: toFirestoreValue(result.success ? 'sent' : 'failed'),
      fbtrace_id: toFirestoreValue(fbtrace), 
      error_message: toFirestoreValue(result.error || null),
      status_code: toFirestoreValue(result.statusCode || null), 
      created_at: toFirestoreValue(new Date().toISOString()),
    };
    await fetch(url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, 
      body: JSON.stringify({ fields }) 
    });
  } catch (e) { console.warn('⚠️ CAPI log insert failed:', e); }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { event_name, event_id, order_id, value, currency = 'BRL', content_name, content_ids, contents, content_type = 'product', num_items, event_source_url, email, phone, first_name, last_name, external_id, client_ip, user_agent, fbc, fbp, test_event_code } = body;
    
    if (!event_name) return new Response(JSON.stringify({ error: 'event_name is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Restriction: Only InitiateCheckout and Purchase allowed
    if (event_name !== 'InitiateCheckout' && event_name !== 'Purchase') {
      console.log(`⏭️ Relay skipped ${event_name} due to CAPI-only minimal policy.`);
      return new Response(JSON.stringify({ success: true, message: 'Event ignored by policy' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resolvedIp = client_ip ? parsePublicIp(client_ip) : parsePublicIp(req.headers.get('x-forwarded-for') || undefined) || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || undefined;
    const resolvedUa = user_agent || req.headers.get('user-agent') || undefined;
    const resolvedEventId = event_id || generateEventId(event_name, order_id);
    const userData = await buildUserData({ email, phone, firstName: first_name, lastName: last_name, clientIp: resolvedIp, userAgent: resolvedUa, fbc, fbp, externalId: external_id });

    const eventPayload: Record<string, unknown> = { event_name, event_time: Math.floor(Date.now() / 1000), event_id: resolvedEventId, action_source: 'website', user_data: userData };
    eventPayload.event_source_url = event_source_url || 'https://www.valnix.com.br';

    const hasCustomData = value !== undefined || content_name || content_ids || (contents && Array.isArray(contents) && contents.length > 0) || num_items;
    if (hasCustomData) {
      const customData: Record<string, unknown> = { 
        ...(value !== undefined ? { value: Number(value) } : {}), 
        currency, 
        ...(content_name ? { content_name } : {}), 
        ...(content_ids ? { content_ids } : {}), 
        ...(contents && Array.isArray(contents) && contents.length > 0 ? { contents } : {}), 
        content_type, 
        ...(num_items ? { num_items: Number(num_items) } : {}) 
      };
      eventPayload.custom_data = customData;
    }

    const result = await sendToMeta(eventPayload, test_event_code);
    await logCapiEvent(event_name, resolvedEventId, order_id || null, result);

    return new Response(JSON.stringify({ success: result.success, event_id: resolvedEventId, ...(result.error ? { error: result.error } : {}) }), {
      status: result.success ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Meta CAPI edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

