import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UTMIFY_API_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";

/** In-memory rate limiter (best-effort, resets on cold start) */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

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

// Cleanup old rate limit entries periodically
function cleanupRateLimit() {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  cleanupRateLimit();

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || "127.0.0.1";

  // Rate limit check
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
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

    // Build a dedupe key: prefer explicit eventId, fallback to type+orderId
    const dedupeKey = eventId || (orderId ? `${type}_${orderId}` : null);

    // Persistent dedupe via DB (unique constraint on event_id)
    if (dedupeKey) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { error: insertError } = await supabase
        .from('utmify_event_log')
        .insert({ event_id: dedupeKey, event_type: type, order_id: orderId || null });

      if (insertError) {
        // Unique constraint violation = already processed
        if (insertError.code === '23505') {
          console.log(`⏭️ UTMify dedupe (DB): ${dedupeKey} already processed`);
          return new Response(JSON.stringify({ success: true, deduplicated: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Other DB error — log but continue (don't block tracking)
        console.warn('⚠️ Dedupe DB insert error:', insertError.message);
      }
    }

    console.log(`📊 UTMify proxy: sending ${type} event`, { orderId, value, clientIp, dedupeKey });

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

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        status: response.status,
        response: responseText,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
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
