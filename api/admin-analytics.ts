import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, verifyAdminToken, errorMessage } from './_utils/helpers.js';

/**
 * Admin analytics dashboard data — funnel + recent events.
 *
 * GET /api/admin-analytics?period=7d|30d|today
 *   → { funnel: {...}, byEvent: {...}, recent: [...] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-admin-token'];
  if (!verifyAdminToken(typeof token === 'string' ? token : '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = String(req.query.period || '30d');
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();

  try {
    const [eventsRes, ordersRes] = await Promise.all([
      supabaseAdmin
        .from('analytics_events')
        .select('event_name,status,timestamp,custom_data')
        .gte('timestamp', sinceISO)
        .order('timestamp', { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from('orders')
        .select('id,payment_status,total_amount,created_at')
        .gte('created_at', sinceISO),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (ordersRes.error) throw new Error(ordersRes.error.message);

    const events = eventsRes.data ?? [];
    const orders = ordersRes.data ?? [];

    const counts: Record<string, number> = {};
    const byEventStatus: Record<string, { sent: number; failed: number }> = {};
    for (const e of events) {
      const name = String((e as { event_name: string }).event_name || 'Unknown');
      counts[name] = (counts[name] || 0) + 1;
      if (!byEventStatus[name]) byEventStatus[name] = { sent: 0, failed: 0 };
      const status = String((e as { status: string }).status || '');
      if (status === 'relayed') byEventStatus[name].sent++;
      if (status === 'failed') byEventStatus[name].failed++;
    }

    const paid = orders.filter((o) => o.payment_status === 'paid');
    const revenue = paid.reduce((s, o) => s + Number(o.total_amount || 0), 0);

    const funnel = {
      pageView: counts['PageView'] || 0,
      viewContent: counts['ViewContent'] || 0,
      addToCart: counts['AddToCart'] || 0,
      initiateCheckout: counts['InitiateCheckout'] || 0,
      purchase: counts['Purchase'] || 0,
      orderRevenue: revenue,
      orderCount: paid.length,
    };

    const recent = events.slice(0, 100).map((e) => ({
      event_name: e.event_name,
      status: e.status,
      timestamp: e.timestamp,
      order_id: (e as { custom_data?: { order_id?: string } }).custom_data?.order_id ?? null,
    }));

    return res.status(200).json({ period, funnel, byEvent: byEventStatus, recent });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[admin-analytics] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
