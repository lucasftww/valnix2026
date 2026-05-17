import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { errorMessage, setCorsHeaders, rateLimit, clientIp, isUuid } from './_utils/helpers.js';

/**
 * Public, unauthenticated front-end telemetry endpoint. Inserts a row into
 * `store_metrics`. Heavy-handed validation + rate-limit because anyone on the
 * internet can call it.
 *
 * Allowed event_name values are an explicit whitelist (no free-form text →
 * trivial DB-bloat DoS otherwise).
 */

const ALLOWED_EVENTS = new Set([
  'page_view',
  'view_content',
  'add_to_cart',
  'remove_from_cart',
  'initiate_checkout',
  'purchase',
  'search',
  'click',
  'newsletter_signup',
  'error',
]);

function trim(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = clientIp(req);
  if (!rateLimit(`metrics:${ip}`, 120, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const eventName = typeof body.event_name === 'string' ? body.event_name : '';
    if (!ALLOWED_EVENTS.has(eventName)) {
      return res.status(400).json({ error: 'event_name not allowed' });
    }

    const orderIdRaw = typeof body.order_id === 'string' ? body.order_id : '';
    const orderId = orderIdRaw && isUuid(orderIdRaw) ? orderIdRaw : null;

    const valueRaw = body.value;
    let value: number | null = null;
    if (typeof valueRaw === 'number' && Number.isFinite(valueRaw) && valueRaw >= 0 && valueRaw < 1_000_000) {
      value = Math.round(valueRaw * 100) / 100;
    }

    const row = {
      event_name: eventName,
      user_id: trim(body.user_id, 80),
      page_url: trim(body.page_url, 500),
      device_type: (trim(body.device_type, 32) || 'unknown'),
      browser: (trim(body.browser, 64) || 'unknown'),
      value,
      currency: trim(body.currency, 8),
      order_id: orderId,
      content_name: trim(body.content_name, 200),
    };

    const { data, error } = await supabaseAdmin
      .from('store_metrics')
      .insert(row as never)
      .select('id')
      .single();
    if (error) {
      console.error('[store-metrics] insert error:', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ success: true, id: data?.id });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[store-metrics] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
