import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UTMIFY_API_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Capture client IP from request headers
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || req.headers.get('cf-connecting-ip') 
      || req.headers.get('x-real-ip') 
      || "127.0.0.1";

    const body = await req.json();
    const { type, sourceUrl, pageTitle, value, currency, orderId, customerEmail, userAgent, parameters, icCSSMatch } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: 'Missing event type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`📊 UTMify proxy: sending ${type} event`, { orderId, value, clientIp });

    const payload = {
      type,
      lead: {
        pixelId: UTMIFY_PIXEL_ID,
        userAgent: userAgent || "server",
        ip: clientIp,
        parameters: parameters || "",
        icTextMatch: null,
        icCSSMatch: icCSSMatch || ".utmify-checkout",
        icURLMatch: null,
        leadTextMatch: null,
        addToCartTextMatch: null,
      },
      event: {
        sourceUrl: sourceUrl || "",
        pageTitle: pageTitle || "",
        value: value || undefined,
        currency: currency || "BRL",
        orderId: orderId || undefined,
        customerEmail: customerEmail || undefined,
      },
      tikTokPageInfo: null,
    };

    const response = await fetch(UTMIFY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log(`📊 UTMify API response: ${response.status}`, responseText);

    return new Response(JSON.stringify({ 
      success: response.ok, 
      status: response.status,
      response: responseText,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ UTMify proxy error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
