import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UTMIFY_API_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";

/** Server-side dedupe: track recently processed eventIds (TTL 10 min) */
const processedEvents = new Map<string, number>();
const DEDUPE_TTL_MS = 10 * 60 * 1000;

/** Simple IP rate limiter: max 30 requests per minute per IP */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function cleanupMaps() {
  const now = Date.now();
  for (const [key, ts] of processedEvents) {
    if (now - ts > DEDUPE_TTL_MS) processedEvents.delete(key);
  }
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Periodic cleanup
  cleanupMaps();

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || "127.0.0.1";

  // Rate limit check
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { type, eventId, sourceUrl, pageTitle, value, currency, orderId, userAgent, parameters, icCSSMatch } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: 'Missing event type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Server-side dedupe by eventId
    if (eventId) {
      if (processedEvents.has(eventId)) {
        console.log(`⏭️ UTMify dedupe: ${eventId} already processed, skipping`);
        return new Response(JSON.stringify({ success: true, deduplicated: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      processedEvents.set(eventId, Date.now());
    }

    console.log(`📊 UTMify proxy: sending ${type} event`, { orderId, value, clientIp, eventId });

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