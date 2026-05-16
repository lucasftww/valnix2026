import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { verifyAdminToken, setCorsHeaders } from './_utils/helpers.js';

type PeriodKey = 'today' | '7d' | '30d';

function qResource(req: VercelRequest): string {
  const r = req.query.resource;
  if (typeof r === 'string') return r;
  if (Array.isArray(r) && typeof r[0] === 'string') return r[0];
  return '';
}

function qString(req: VercelRequest, key: string): string {
  const v = req.query[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

function parseJsonBody(req: VercelRequest): Record<string, unknown> {
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  if (typeof b === 'string') {
    try {
      const p = JSON.parse(b);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function startOfTodayBrtISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`).toISOString();
}

function periodStartISO(period: PeriodKey): string {
  if (period === 'today') return startOfTodayBrtISO();
  const days = period === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

type OrderRow = {
  id: string;
  total_amount: number;
  payment_status: string;
  status: string;
  payment_method: string | null;
  customer_name: string | null;
  created_at: string;
};

async function fetchAllOrders(limit = 8000): Promise<OrderRow[]> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id,total_amount,payment_status,status,payment_method,customer_name,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

async function fetchOrderLineItems(orderId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

function periodStats(orders: OrderRow[], period: PeriodKey) {
  const startMs = new Date(periodStartISO(period)).getTime();
  const inP = orders.filter((o) => new Date(o.created_at).getTime() >= startMs);
  const paid = inP.filter((o) => o.payment_status === 'paid');
  const revenue = paid.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const paidCount = paid.length;
  const failed = inP.filter(
    (o) => o.status === 'cancelled' || o.payment_status === 'failed' || o.payment_status === 'expired',
  ).length;
  return {
    revenue,
    orders: inP.length,
    paidCount,
    avgTicket: paidCount > 0 ? revenue / paidCount : 0,
    failed,
  };
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function buildRevenueByDay(orders: OrderRow[]): Array<{ name: string; receita: number }> {
  const days: Array<{ name: string; receita: number; key: string }> = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, name: WEEKDAY_SHORT[d.getDay()], receita: 0 });
  }
  const keySet = new Set(days.map((x) => x.key));
  for (const o of orders) {
    if (o.payment_status !== 'paid') continue;
    const key = new Date(o.created_at).toISOString().slice(0, 10);
    if (!keySet.has(key)) continue;
    const row = days.find((d) => d.key === key);
    if (row) row.receita += Number(o.total_amount || 0);
  }
  return days.map(({ name, receita }) => ({ name, receita }));
}

async function buildDashboardStats(): Promise<Record<string, unknown>> {
  const [orders, productsCount] = await Promise.all([
    fetchAllOrders(),
    supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  const totalProducts = productsCount.count ?? 0;

  const periods: Record<PeriodKey, ReturnType<typeof periodStats>> = {
    today: periodStats(orders, 'today'),
    '7d': periodStats(orders, '7d'),
    '30d': periodStats(orders, '30d'),
  };

  const paidOrders = orders.filter((o) => o.payment_status === 'paid');
  const recentOrders = paidOrders.slice(0, 10).map((o) => ({
    id: o.id,
    customer_name: o.customer_name,
    created_at: o.created_at,
    total_amount: Number(o.total_amount || 0),
  }));

  const pendingDelivery = orders.filter(
    (o) => o.payment_status === 'paid' && (o.status === 'processing' || o.status === 'pending'),
  ).length;

  const last30Start = periodStartISO('30d');
  const last30 = orders.filter((o) => o.created_at >= last30Start);
  const paid30 = last30.filter((o) => o.payment_status === 'paid');

  // Top products: aggregate from line items (sample up to 400 paid orders)
  const sampleIds = paid30.slice(0, 400).map((o) => o.id);
  const productAgg = new Map<string, { quantity: number; revenue: number }>();
  if (sampleIds.length) {
    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('product_name,quantity,total_price,order_id')
      .in('order_id', sampleIds);
    for (const it of items ?? []) {
      const name = String(it.product_name || 'Produto');
      const cur = productAgg.get(name) || { quantity: 0, revenue: 0 };
      cur.quantity += Number(it.quantity || 0);
      cur.revenue += Number(it.total_price || 0);
      productAgg.set(name, cur);
    }
  }
  const topProducts = [...productAgg.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 8);

  const in30 = last30.length;
  const paidC = paid30.length;
  const pendC = last30.filter((o) => o.payment_status === 'pending').length;
  const otherC = Math.max(0, in30 - paidC - pendC);

  const paymentDistribution = [
    { name: 'Pagos', value: paidC, color: '#22c55e' },
    { name: 'Pendentes', value: pendC, color: '#eab308' },
    { name: 'Outros', value: otherC, color: '#6b7280' },
  ].filter((x) => x.value > 0);

  const alerts: Array<{ type: 'error' | 'warning'; title: string; description: string }> = [];
  if (pendC > 80) {
    alerts.push({
      type: 'warning',
      title: 'Muitos pagamentos pendentes',
      description: `Há ${pendC} pedidos não pagos nos últimos 30 dias.`,
    });
  }

  return {
    periods,
    totalProducts,
    topProducts,
    recentOrders,
    pendingDelivery,
    revenueByDay: buildRevenueByDay(orders),
    paymentDistribution,
    alerts,
  };
}

async function handleCleanupAnalytics(res: VercelResponse, body: Record<string, unknown>) {
  const after_date = String(body.after_date || '');
  const before_date = String(body.before_date || '');
  const dry_run = Boolean(body.dry_run);
  if (!after_date || !before_date) {
    return res.status(400).json({ error: 'after_date and before_date required', success: false });
  }

  if (dry_run) {
    const { data, count, error } = await supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact' })
      .gte('timestamp', after_date)
      .lte('timestamp', before_date)
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      dry_run: true,
      would_delete: count ?? 0,
      preview_ids: (data ?? []).map((d) => d.id),
    });
  }

  const { error, count } = await supabaseAdmin
    .from('analytics_events')
    .delete({ count: 'exact' })
    .gte('timestamp', after_date)
    .lte('timestamp', before_date);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, deleted: count ?? 0 });
}

async function handleCleanupCapiLogs(res: VercelResponse) {
  const { error, count } = await supabaseAdmin
    .from('analytics_events')
    .delete({ count: 'exact' })
    .eq('status', 'failed');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, deleted: count ?? 0 });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminToken = req.headers['x-admin-token'];
  if (!verifyAdminToken(adminToken as string)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resource = qResource(req);
  const body = parseJsonBody(req);

  try {
    // ── GET ─────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      switch (resource) {
        case 'orders': {
          const orders = await fetchAllOrders();
          return res.status(200).json({ orders });
        }
        case 'products': {
          const { data, error } = await supabaseAdmin.from('products').select('*');
          if (error) throw new Error(error.message);
          return res.status(200).json({ products: data ?? [] });
        }
        case 'categories': {
          const { data, error } = await supabaseAdmin.from('categories').select('*');
          if (error) throw new Error(error.message);
          return res.status(200).json({ categories: data ?? [] });
        }
        case 'dashboard-stats': {
          const stats = await buildDashboardStats();
          return res.status(200).json(stats);
        }
        case 'order-items': {
          const orderId = qString(req, 'orderId');
          if (!orderId) return res.status(400).json({ error: 'orderId required' });
          const items = await fetchOrderLineItems(orderId);
          return res.status(200).json({ items });
        }
        case 'batch-items': {
          const raw = qString(req, 'orderIds');
          if (!raw) return res.status(400).json({ error: 'orderIds required' });
          const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
          if (!ids.length) return res.status(200).json({ batch: {} });
          const { data, error } = await supabaseAdmin
            .from('order_items')
            .select('*')
            .in('order_id', ids);
          if (error) throw new Error(error.message);
          const batch: Record<string, unknown[]> = {};
          for (const id of ids) batch[id] = [];
          for (const item of data ?? []) {
            const oid = (item as { order_id: string }).order_id;
            (batch[oid] ||= []).push(item);
          }
          return res.status(200).json({ batch });
        }
        default:
          return res.status(400).json({ error: 'Unknown or missing resource for GET' });
      }
    }

    // ── DELETE ─────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = qString(req, 'id');
      if (!id) return res.status(400).json({ error: 'id required' });
      const table = resource as 'orders' | 'products' | 'categories';
      if (!['orders', 'products', 'categories'].includes(table)) {
        return res.status(400).json({ error: 'Unknown resource for DELETE' });
      }
      const { error } = await supabaseAdmin.from(table).delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true });
    }

    // ── PUT ──────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      switch (resource) {
        case 'verify-payment': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const payment_status = String(body.payment_status || 'paid');
          const status = String(body.status || 'processing');
          const update: Record<string, unknown> = { payment_status, status };
          if (payment_status === 'paid') update.paid_at = new Date().toISOString();
          const { error } = await supabaseAdmin.from('orders').update(update).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'orders': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const { error } = await supabaseAdmin.from('orders').update(rest as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'products': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const { error } = await supabaseAdmin.from('products').update(rest as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'categories': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const { error } = await supabaseAdmin.from('categories').update(rest as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'order-items': {
          const orderId = String(body.orderId || '');
          const itemId = String(body.id || '');
          const delivery_code = String(body.delivery_code ?? '');
          if (!orderId || !itemId) return res.status(400).json({ error: 'orderId and id required' });
          const { error } = await supabaseAdmin
            .from('order_items')
            .update({ delivery_code, delivered_at: delivery_code ? new Date().toISOString() : null })
            .eq('id', itemId)
            .eq('order_id', orderId);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        default:
          return res.status(400).json({ error: 'Unknown resource for PUT' });
      }
    }

    // ── POST ─────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (resource === 'cleanup-analytics') return handleCleanupAnalytics(res, body);
      if (resource === 'cleanup-capi-logs') return handleCleanupCapiLogs(res);

      switch (resource) {
        case 'products': {
          // Upsert (id may be provided for update or omitted for new product)
          const { error, data } = await supabaseAdmin
            .from('products')
            .upsert(body as never, { onConflict: 'id' })
            .select('id')
            .single();
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true, id: data?.id });
        }
        case 'categories': {
          const { id: _unused, ...rest } = body;
          const { data, error } = await supabaseAdmin
            .from('categories')
            .insert(rest as never)
            .select('id')
            .single();
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true, id: data?.id });
        }
        default:
          return res.status(400).json({ error: 'Unknown resource for POST' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (process.env.NODE_ENV !== 'production') console.error('Admin API error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
