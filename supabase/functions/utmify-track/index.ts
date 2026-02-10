import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UTMIFY_API_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";
const LOCK_TTL_SECONDS = 30;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, serviceKey);

/** In-memory rate limiter (best-effort) */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

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

function cleanupRateLimit() {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}

/** Cleanup old pending events (>7 days) — runs occasionally */
let lastCleanup = 0;
async function cleanupOldPendings() {
  const now = Date.now();
  if (now - lastCleanup < 3600_000) return; // max once per hour
  lastCleanup = now;
  try {
    await supabase
      .from('utmify_event_log')
      .update({ status: 'failed', last_error: 'TTL expired (7d)' })
      .eq('status', 'pending')
      .lt('created_at', new Date(now - 7 * 86400_000).toISOString());
    console.log('🧹 Cleaned up old pending events');
  } catch (e) {
    console.warn('⚠️ Cleanup error:', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  cleanupRateLimit();
  cleanupOldPendings(); // fire-and-forget

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || "127.0.0.1";

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

    const dedupeKey = eventId || (orderId ? `${type}_${orderId}` : null);

    if (dedupeKey) {
      // Check existing state
      const { data: existing, error: selectError } = await supabase
        .from('utmify_event_log')
        .select('status, locked_at')
        .eq('event_id', dedupeKey)
        .maybeSingle();

      if (selectError) {
        console.warn('⚠️ Dedupe SELECT error (continuing):', selectError.message);
      }

      // Already sent → dedupe
      if (existing?.status === 'sent') {
        return new Response(JSON.stringify({ success: true, deduplicated: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Pending + locked recently → someone else is sending, skip
      if (existing?.status === 'pending' && existing.locked_at) {
        const lockedAge = (Date.now() - new Date(existing.locked_at).getTime()) / 1000;
        if (lockedAge < LOCK_TTL_SECONDS) {
          console.log(`🔒 UTMify ${dedupeKey} locked ${lockedAge.toFixed(0)}s ago, skipping`);
          return new Response(JSON.stringify({ success: true, in_flight: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (!existing) {
        // New event → insert as pending + locked
        const { error: insertError } = await supabase
          .from('utmify_event_log')
          .insert({
            event_id: dedupeKey,
            event_type: type,
            order_id: orderId || null,
            status: 'pending',
            locked_at: new Date().toISOString(),
            attempt_count: 1,
          });

        if (insertError && insertError.code !== '23505') {
          console.warn('⚠️ Dedupe INSERT error:', insertError.message);
        }
      } else {
        // Existing pending (lock expired) → acquire lock atomically
        const { data: locked } = await supabase
          .from('utmify_event_log')
          .update({
            locked_at: new Date().toISOString(),
            attempt_count: (existing as any).attempt_count ? (existing as any).attempt_count + 1 : 1,
          })
          .eq('event_id', dedupeKey)
          .eq('status', 'pending')
          .select('event_id')
          .maybeSingle();

        if (!locked) {
          // Another instance grabbed it
          console.log(`⚡ UTMify lock race: ${dedupeKey}, skipping`);
          return new Response(JSON.stringify({ success: true, in_flight: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    console.log(`📊 UTMify proxy: sending ${type}`, { orderId, value, clientIp, dedupeKey });

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

    if (dedupeKey) {
      if (response.ok) {
        await supabase
          .from('utmify_event_log')
          .update({ status: 'sent', locked_at: null, updated_at: new Date().toISOString() })
          .eq('event_id', dedupeKey);
      } else {
        // Release lock, keep pending for retry
        await supabase
          .from('utmify_event_log')
          .update({ locked_at: null, last_error: `HTTP ${response.status}: ${responseText.slice(0, 200)}` })
          .eq('event_id', dedupeKey);
      }
    }

    if (!response.ok) {
      return new Response(JSON.stringify({ success: false, status: response.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, status: response.status }), {
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
