import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UTMIFY_EVENTS_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";
const LOCK_TTL_SECONDS = 30;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, serviceKey);

/** SHA-256 hash helper (returns lowercase hex) */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  if (now - lastCleanup < 3600_000) return;
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
  void cleanupOldPendings();

  // ── EQM FIX: Always use IP/UA from request headers, never trust body ──
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || "127.0.0.1";
  const clientUserAgent = req.headers.get('user-agent') || 'server';

  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  try {
    const body = await req.json();
    const { type, eventId, sourceUrl, pageTitle, value, currency, orderId, parameters, icCSSMatch,
      customerEmail, customerPhone, externalId, contentIds, contentNames, numItems } = body;

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
        .select('status, locked_at, attempt_count')
        .eq('event_id', dedupeKey)
        .maybeSingle();

      if (selectError) {
        console.warn('⚠️ Dedupe SELECT error (continuing):', selectError.message);
      }

      if (existing?.status === 'sent') {
        return new Response(JSON.stringify({ success: true, deduplicated: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (existing?.status === 'pending' && existing.locked_at) {
        const lockedAge = (Date.now() - new Date(existing.locked_at).getTime()) / 1000;
        if (lockedAge < LOCK_TTL_SECONDS) {
          return new Response(JSON.stringify({ success: true, in_flight: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (!existing) {
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

        if (insertError?.code === '23505') {
          const { data: recheck } = await supabase
            .from('utmify_event_log')
            .select('status, locked_at, attempt_count')
            .eq('event_id', dedupeKey)
            .maybeSingle();

          if (recheck?.status === 'sent') {
            return new Response(JSON.stringify({ success: true, deduplicated: true }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          if (recheck?.status === 'pending' && recheck.locked_at) {
            const lockedAge = (Date.now() - new Date(recheck.locked_at).getTime()) / 1000;
            if (lockedAge < LOCK_TTL_SECONDS) {
              return new Response(JSON.stringify({ success: true, in_flight: true }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          }

          if (recheck?.status === 'pending') {
            const lockThreshold = new Date(Date.now() - LOCK_TTL_SECONDS * 1000).toISOString();
            const { data: locked } = await supabase
              .from('utmify_event_log')
              .update({
                locked_at: new Date().toISOString(),
                attempt_count: (recheck.attempt_count || 0) + 1,
              })
              .eq('event_id', dedupeKey)
              .eq('status', 'pending')
              .or(`locked_at.is.null,locked_at.lt.${lockThreshold}`)
              .select('event_id')
              .maybeSingle();

            if (!locked) {
              return new Response(JSON.stringify({ success: true, in_flight: true }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          } else {
            return new Response(JSON.stringify({ success: true, deduplicated: true }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } else {
        const lockThreshold = new Date(Date.now() - LOCK_TTL_SECONDS * 1000).toISOString();
        const { data: locked } = await supabase
          .from('utmify_event_log')
          .update({
            locked_at: new Date().toISOString(),
            attempt_count: (existing.attempt_count || 0) + 1,
          })
          .eq('event_id', dedupeKey)
          .eq('status', 'pending')
          .or(`locked_at.is.null,locked_at.lt.${lockThreshold}`)
          .select('event_id')
          .maybeSingle();

        if (!locked) {
          console.log(`⚡ UTMify lock race: ${dedupeKey}, skipping`);
          return new Response(JSON.stringify({ success: true, in_flight: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ── Build PII hashes directly on lead (em/ph/external_id for UTMify/Meta EQM) ──
    const piiKeys: string[] = [];
    const leadPii: Record<string, string> = {};
    if (customerEmail) { leadPii.em = await sha256(customerEmail); piiKeys.push('em'); }
    if (customerPhone) { leadPii.ph = await sha256(customerPhone.replace(/\D/g, '')); piiKeys.push('ph'); }
    if (externalId) { leadPii.external_id = await sha256(externalId); piiKeys.push('external_id'); }

    // ── Build enriched payload ──
    const contentIdsArray = Array.isArray(contentIds) ? contentIds : undefined;
    const payload: Record<string, unknown> = {
      type,
      eventId: dedupeKey || undefined,
      lead: {
        pixelId: UTMIFY_PIXEL_ID,
        userAgent: clientUserAgent,
        ip: clientIp.trim() || null,
        parameters: parameters || "",
        icTextMatch: null,
        icCSSMatch: icCSSMatch || ".utmify-checkout",
        icURLMatch: null,
        leadTextMatch: null,
        addToCartTextMatch: null,
        // PII hashed directly on lead (UTMify/Meta format)
        ...leadPii,
      },
      event: {
        sourceUrl: sourceUrl || "",
        pageTitle: pageTitle || "",
        value: value || undefined,
        currency: currency || "BRL",
        orderId: orderId || undefined,
        // Content enrichment — both camelCase and snake_case for compatibility
        ...(contentIdsArray ? { contentIds: contentIdsArray, content_ids: contentIdsArray } : {}),
        ...(contentNames ? { contentName: contentNames, content_name: contentNames } : {}),
        ...(numItems != null ? { numItems: Number(numItems), num_items: Number(numItems) } : {}),
      },
      tikTokPageInfo: null,
    };

    console.log(`📊 UTMify proxy: ${type} | orderId=${orderId || 'none'} | ip=${clientIp} | ua=${clientUserAgent.substring(0, 50)} | pii=${piiKeys.join(',') || 'none'} | content=${contentIdsArray ? 'yes' : 'no'}`);

    const response = await fetch(UTMIFY_EVENTS_URL, {
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
