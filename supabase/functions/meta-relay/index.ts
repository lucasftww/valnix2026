import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_API_VERSION = 'v22.0';

// ── SHA-256 helper (built-in) ──────────────────────────────────
async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Robust CORS ────────────────────────────────────────────────
const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
};

// ── Main Handler ──────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('x-admin-token');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { 
      event_name, event_id, order_id, value, currency = 'BRL', content_name, content_ids, 
      email, phone, first_name, last_name, external_id, 
      test_event_code, event_time, pixel_id, access_token 
    } = body;

    if (!event_name) {
      return new Response(JSON.stringify({ error: 'event_name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Prepare User Data
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
      eventPayload.custom_data = {
        value: Number(value),
        currency,
        content_name,
        content_ids: Array.isArray(content_ids) ? content_ids : undefined,
      };
    }

    // Credentials (prioritize body for migration ease)
    const effectiveToken = access_token || Deno.env.get('META_ACCESS_TOKEN');
    const effectivePixel = pixel_id || Deno.env.get('META_PIXEL_ID');

    if (!effectiveToken || !effectivePixel) {
      return new Response(JSON.stringify({ error: 'Meta credentials missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${effectivePixel}/events?access_token=${effectiveToken}`;
    const metaBody: any = { data: [eventPayload] };
    if (test_event_code) metaBody.test_event_code = test_event_code;

    const metaRes = await fetch(metaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaBody)
    });

    const metaData = await metaRes.json();
    
    return new Response(JSON.stringify({ 
      success: metaRes.ok, 
      data: metaData, 
      version: 'v1.0.meta-relay',
      status: metaRes.status
    }), { 
      status: metaRes.ok ? 200 : 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
