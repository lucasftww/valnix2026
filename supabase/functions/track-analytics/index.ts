import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { addFirestoreDoc, toFirestoreValue } from '../_shared/firestore.ts';

const VALID_EVENTS = ['ViewContent', 'InitiateCheckout', 'Purchase'];

// ── Rate limiting ──
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (entry && entry.blockedUntil > now) return false;
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000, blockedUntil: 0 });
    return true;
  }
  entry.count++;
  if (entry.count > 30) { entry.blockedUntil = now + 300_000; return false; }
  return true;
}
function maybeCleanupRateLimit() {
  if (rateLimitMap.size < 200) return;
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (v.resetAt <= now && v.blockedUntil <= now) rateLimitMap.delete(k);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  maybeCleanupRateLimit();
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const { event_name, user_id, page_url, device_type, browser, value, currency, order_id, content_name, content_category } = body;

    if (!event_name || !VALID_EVENTS.includes(event_name)) {
      return new Response(JSON.stringify({ error: 'Invalid event_name' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (value !== undefined && value !== null && (typeof value !== 'number' || value < 0 || value > 1000000)) {
      return new Response(JSON.stringify({ error: 'Invalid value' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order_id && (typeof order_id !== 'string' || order_id.length > 100)) {
      return new Response(JSON.stringify({ error: 'Invalid order_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const docId = await addFirestoreDoc('analytics_events', {
      event_name,
      event_time: new Date().toISOString(),
      user_id: typeof user_id === 'string' ? user_id.slice(0, 100) : null,
      page_url: typeof page_url === 'string' ? page_url.slice(0, 500) : null,
      device_type: typeof device_type === 'string' ? device_type.slice(0, 20) : null,
      browser: typeof browser === 'string' ? browser.slice(0, 30) : null,
      value: value || null,
      currency: value ? (currency || 'BRL') : null,
      order_id: order_id || null,
      content_name: typeof content_name === 'string' ? content_name.slice(0, 200) : null,
      content_category: typeof content_category === 'string' ? content_category.slice(0, 100) : null,
    });

    if (!docId) {
      return new Response(JSON.stringify({ error: 'Failed to track event' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Track analytics error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
