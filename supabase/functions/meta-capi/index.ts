import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Meta Conversions API (CAPI) Edge Function
// Receives events and sends them to Meta with enriched user data

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const META_API_VERSION = 'v22.0';

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
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  clientIp?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
  externalId?: string;
}) {
  const userData: Record<string, string | undefined> = {};

  if (params.email) {
    userData.em = await sha256(params.email);
  }
  if (params.phone) {
    // Normalize phone: remove non-digits, add BR prefix if needed
    let phone = params.phone.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) phone = '55' + phone;
    userData.ph = await sha256(phone);
  }
  if (params.firstName) {
    userData.fn = await sha256(params.firstName);
  }
  if (params.lastName) {
    userData.ln = await sha256(params.lastName);
  }
  if (params.externalId) {
    userData.external_id = await sha256(params.externalId);
  }
  if (params.clientIp) {
    userData.client_ip_address = params.clientIp;
  }
  if (params.userAgent) {
    userData.client_user_agent = params.userAgent;
  }
  if (params.fbc) {
    userData.fbc = params.fbc;
  }
  if (params.fbp) {
    userData.fbp = params.fbp;
  }

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

  const body: Record<string, unknown> = {
    data: [eventPayload],
  };

  if (testEventCode) {
    body.test_event_code = testEventCode;
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// ── Log event to Supabase for monitoring ───────────────────────────
async function logCapiEvent(
  eventName: string,
  eventId: string,
  orderId: string | null,
  result: { success: boolean; error?: string; statusCode?: number }
) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase.from('capi_event_log').insert({
      event_name: eventName,
      event_id: eventId,
      order_id: orderId,
      status: result.success ? 'sent' : 'failed',
      error_message: result.error || null,
      status_code: result.statusCode || null,
    });
  } catch (e) {
    console.warn('⚠️ CAPI log insert failed:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      event_name,
      event_id,
      order_id,
      value,
      currency = 'BRL',
      content_name,
      content_ids,
      content_type = 'product',
      num_items = 1,
      event_source_url,
      // User data (raw, will be hashed)
      email,
      phone,
      first_name,
      last_name,
      external_id,
      client_ip,
      user_agent,
      fbc,
      fbp,
      // Optional test mode
      test_event_code,
    } = body;

    if (!event_name) {
      return new Response(JSON.stringify({ error: 'event_name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fallback IP/UA from request headers if not provided
    const resolvedIp = client_ip 
      || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || undefined;
    const resolvedUa = user_agent || req.headers.get('user-agent') || undefined;

    // Generate unique event_id for deduplication
    const resolvedEventId = event_id || `${order_id || 'evt'}_${Date.now()}`;

    // Build user data with SHA-256 hashes
    const userData = await buildUserData({
      email,
      phone,
      firstName: first_name,
      lastName: last_name,
      clientIp: resolvedIp,
      userAgent: resolvedUa,
      fbc,
      fbp,
      externalId: external_id,
    });

    // Build event payload
    const eventPayload: Record<string, unknown> = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: resolvedEventId,
      action_source: 'website',
      user_data: userData,
    };

    if (event_source_url) {
      eventPayload.event_source_url = event_source_url;
    }

    // Add custom data for Purchase/InitiateCheckout
    if (value !== undefined) {
      eventPayload.custom_data = {
        value: Number(value),
        currency,
        ...(content_name ? { content_name } : {}),
        ...(content_ids ? { content_ids } : {}),
        content_type,
        num_items,
      };
    }

    console.log(`📡 Sending ${event_name} to Meta CAPI (event_id: ${resolvedEventId})`);

    const result = await sendToMeta(eventPayload, test_event_code);

    // Log to Supabase
    await logCapiEvent(event_name, resolvedEventId, order_id || null, result);

    return new Response(JSON.stringify({
      success: result.success,
      event_id: resolvedEventId,
      ...(result.error ? { error: result.error } : {}),
    }), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Meta CAPI edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
