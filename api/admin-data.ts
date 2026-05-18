import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { verifyAdminToken, setCorsHeaders, signInternalRequest } from './_utils/helpers.js';
import axios from 'axios';

// ── Field allowlists for admin write operations ──────────────────────────────
// Never spread raw body into .update()/.upsert() — admins should be able to
// edit content fields, not silently overwrite system fields like
// payment_status, paid_at, guest_hash, flowpay_charge_id, etc.
const ORDER_EDITABLE = new Set([
  'customer_name', 'customer_email', 'customer_phone', 'customer_document',
  'status', 'notes',
]);
const PRODUCT_EDITABLE = new Set([
  'name', 'description', 'rich_description', 'price', 'old_price', 'discount',
  'image_url', 'icon_url', 'category', 'is_active', 'featured', 'is_featured_in_category',
  'display_order', 'stock', 'sold', 'delivery_type', 'delivery_info',
  'auto_delivery_codes', 'instructions', 'terms_conditions', 'video_url',
  'product_type', 'offer_hash',
]);
const CATEGORY_EDITABLE = new Set([
  'name', 'slug', 'description', 'image_url', 'icon_url', 'parent_id',
  'is_active', 'display_order', 'show_on_homepage',
]);

function filterFields<T extends Record<string, unknown>>(body: T, allow: Set<string>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (allow.has(k)) out[k] = body[k];
  }
  return out as Partial<T>;
}

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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

async function handleCleanupAnalytics(res: VercelResponse, body: Record<string, unknown>) {
  const after_date = String(body.after_date || '');
  const before_date = String(body.before_date || '');
  const dry_run = Boolean(body.dry_run);
  if (!ISO_DATE_RE.test(after_date) || !ISO_DATE_RE.test(before_date)) {
    return res.status(400).json({ error: 'after_date and before_date must be ISO timestamps', success: false });
  }

  if (dry_run) {
    const { data, count, error } = await supabaseAdmin
      .from('analytics_events')
      .select('id', { count: 'exact' })
      .gte('timestamp', after_date)
      .lte('timestamp', before_date)
      .limit(20);
    if (error) {
      console.error('[admin-data] cleanup dry-run error:', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
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
  if (error) {
    console.error('[admin-data] cleanup error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(200).json({ success: true, deleted: count ?? 0 });
}

async function handleCleanupCapiLogs(res: VercelResponse) {
  const { error, count } = await supabaseAdmin
    .from('analytics_events')
    .delete({ count: 'exact' })
    .eq('status', 'failed');
  if (error) {
    console.error('[admin-data] cleanup capi logs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(200).json({ success: true, deleted: count ?? 0 });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  // Admin responses must NEVER hit a CDN/proxy cache — order data, dashboard
  // stats, analytics, capi-replay results are all private/per-admin.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
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
        // ── Merged from admin-analytics.ts ─────────────────────────
        case 'analytics': {
          const period = qString(req, 'period') || qString(req, 'dateRange') || '30d';
          const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
          const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
          const [eventsRes, ordersRes] = await Promise.all([
            supabaseAdmin.from('analytics_events').select('event_name,status,timestamp,custom_data').gte('timestamp', sinceISO).order('timestamp', { ascending: false }).limit(5000),
            supabaseAdmin.from('orders').select('id,payment_status,total_amount,created_at').gte('created_at', sinceISO),
          ]);
          if (eventsRes.error) throw new Error(eventsRes.error.message);
          if (ordersRes.error) throw new Error(ordersRes.error.message);
          const evts = eventsRes.data ?? [];
          const ords = ordersRes.data ?? [];
          const counts: Record<string, number> = {};
          const byEventStatus: Record<string, { sent: number; failed: number }> = {};
          for (const e of evts) {
            const name = String((e as { event_name: string }).event_name || 'Unknown');
            counts[name] = (counts[name] || 0) + 1;
            if (!byEventStatus[name]) byEventStatus[name] = { sent: 0, failed: 0 };
            const st = String((e as { status: string }).status || '');
            if (st === 'relayed') byEventStatus[name].sent++;
            if (st === 'failed') byEventStatus[name].failed++;
          }
          const paid = ords.filter((o) => o.payment_status === 'paid');
          const revenue = paid.reduce((s, o) => s + Number(o.total_amount || 0), 0);
          const funnel = {
            pageView: counts['PageView'] || 0, viewContent: counts['ViewContent'] || 0,
            addToCart: counts['AddToCart'] || 0, initiateCheckout: counts['InitiateCheckout'] || 0,
            purchase: counts['Purchase'] || 0, orderRevenue: revenue, orderCount: paid.length,
          };
          const recent = evts.slice(0, 100).map((e) => ({
            event_name: e.event_name, status: e.status, timestamp: e.timestamp,
            order_id: (e as { custom_data?: { order_id?: string } }).custom_data?.order_id ?? null,
          }));
          return res.status(200).json({ period, funnel, byEvent: byEventStatus, recent, events: recent });
        }
        // ── Merged from monitor-tracking.ts ────────────────────────
        case 'monitor-tracking': {
          const hours = Number.parseInt(qString(req, 'hours')) || 24;
          const sinceISO = new Date(Date.now() - hours * 3600_000).toISOString();
          const { data, error } = await supabaseAdmin.from('analytics_events')
            .select('id,status,event_name,event_id,error,status_code,timestamp,source,custom_data')
            .gte('timestamp', sinceISO).order('timestamp', { ascending: false }).limit(5000);
          if (error) throw new Error(error.message);
          type EvtRow = { id: string; status?: string | null; event_name?: string | null; event_id?: string | null; error?: string | null; status_code?: number | null; timestamp?: string | null; source?: string | null; custom_data?: { order_id?: string } | null };
          const events = (data ?? []) as EvtRow[];
          const capiStats = { total: events.length, sent: events.filter((e) => e.status === 'relayed').length, failed: events.filter((e) => e.status === 'failed').length, byEvent: {} as Record<string, { sent: number; failed: number }>, recentErrors: events.filter((e) => e.status === 'failed').slice(0, 10).map((e) => ({ event_name: e.event_name, event_id: e.event_id, error: e.error || 'Unknown error', status_code: e.status_code || 500, time: e.timestamp })) };
          for (const e of events) { const name = e.event_name || 'unknown'; if (!capiStats.byEvent[name]) capiStats.byEvent[name] = { sent: 0, failed: 0 }; if (e.status === 'relayed') capiStats.byEvent[name].sent++; if (e.status === 'failed') capiStats.byEvent[name].failed++; }
          const idMap = new Map<string, { count: number; sources: Set<string>; orderId?: string }>();
          for (const e of events) { if (!e.event_id) continue; const ex = idMap.get(e.event_id) || { count: 0, sources: new Set<string>(), orderId: e.custom_data?.order_id }; ex.count++; ex.sources.add(e.source || 'unknown'); idMap.set(e.event_id, ex); }
          const duplicates = [...idMap.entries()].filter(([, d]) => d.count > 1).map(([id, d]) => ({ eventId: id, orderId: d.orderId || 'N/A', count: d.count, sources: [...d.sources] })).slice(0, 5);
          let currentStreak = 0, maxStreak = 0;
          for (const e of events) { if (e.status === 'failed') { currentStreak++; } else if (e.status === 'relayed') { maxStreak = Math.max(maxStreak, currentStreak); currentStreak = 0; } }
          maxStreak = Math.max(maxStreak, currentStreak);
          type Alert = { level: 'critical' | 'warning'; message: string; detail: string };
          const alerts: Alert[] = [];
          const errorRate = capiStats.total > 0 ? (capiStats.failed / capiStats.total) * 100 : 0;
          if (errorRate > 15) alerts.push({ level: 'critical', message: 'Taxa de erro CAPI elevada', detail: `${errorRate.toFixed(1)}% de falhas.` });
          else if (errorRate > 5) alerts.push({ level: 'warning', message: 'Erros intermitentes no CAPI', detail: 'Verifique os logs recentes.' });
          if (maxStreak > 3) alerts.push({ level: 'critical', message: 'Múltiplas falhas consecutivas', detail: `Ocorreu uma sequência de ${maxStreak} erros.` });
          return res.status(200).json({ period: `${hours}h`, timestamp: new Date().toISOString(), capi: { total: capiStats.total, sent: capiStats.sent, failed: capiStats.failed, errorRate, byEvent: capiStats.byEvent, recentErrors: capiStats.recentErrors }, dedup: { totalMetaPurchaseEvents: events.filter((e) => e.event_name === 'Purchase').length, sourceDistribution: events.reduce<Record<string, number>>((acc, e) => { const src = e.source || 'unknown'; acc[src] = (acc[src] || 0) + 1; return acc; }, {}), eventIdIssues: [...idMap.values()].filter((d) => d.count > 1).length, duplicates }, consecutiveErrors: { maxStreak, currentStreak: events[0]?.status === 'failed' ? currentStreak : 0, isOngoing: events[0]?.status === 'failed' }, coverage: { paidOrders: 0, withCapi: 0, missingCapi: 0, coverageRate: 100, missingDetails: [] }, alerts });
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

          // Only set paid_at when first transitioning to paid (idempotent re-calls
          // don't overwrite the original timestamp).
          if (payment_status === 'paid') {
            const { data: cur } = await supabaseAdmin
              .from('orders')
              .select('paid_at')
              .eq('id', id)
              .maybeSingle();
            if (cur && !cur.paid_at) update.paid_at = new Date().toISOString();
          }
          const { error } = await supabaseAdmin.from('orders').update(update as never).eq('id', id);
          if (error) throw new Error(error.message);

          // Trigger auto-delivery in the background (best-effort). Uses an internal
          // signature so process-delivery doesn't require an admin token here.
          if (payment_status === 'paid') {
            try {
              const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
              const host = req.headers.host;
              if (host) {
                const payload = JSON.stringify({ orderId: id });
                const sig = signInternalRequest(payload);
                await axios.post(`${proto}://${host}/api/process-delivery`, { orderId: id }, {
                  headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': sig },
                  timeout: 15_000,
                }).catch(() => null); // best-effort
              }
            } catch { /* noop */ }
          }
          return res.status(200).json({ success: true });
        }
        case 'orders': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const clean = filterFields(rest as Record<string, unknown>, ORDER_EDITABLE);
          const { error } = await supabaseAdmin.from('orders').update(clean as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'products': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const clean = filterFields(rest as Record<string, unknown>, PRODUCT_EDITABLE);
          const { error } = await supabaseAdmin.from('products').update(clean as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'categories': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          const clean = filterFields(rest as Record<string, unknown>, CATEGORY_EDITABLE);
          const { error } = await supabaseAdmin.from('categories').update(clean as never).eq('id', id);
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true });
        }
        case 'order-items': {
          const orderId = String(body.orderId || '');
          const itemId = String(body.id || '');
          const delivery_code = typeof body.delivery_code === 'string' ? body.delivery_code.slice(0, 500) : '';
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

      // ── Image upload (replaces the never-built /api/upload-r2) ──
      // Body: { fileBase64, fileName, contentType }
      // Uploads to Supabase Storage bucket "product-images" via service_role
      // and returns the public URL. Bucket is provisioned in migration
      // 20260517040000_storage_product_images.sql.
      if (resource === 'upload-image') {
        const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
        const fileName = typeof body.fileName === 'string' ? body.fileName : '';
        const contentType = typeof body.contentType === 'string' ? body.contentType : 'image/webp';

        if (!fileBase64 || !fileName) {
          return res.status(400).json({ error: 'fileBase64 and fileName required' });
        }
        const allowedTypes = ['image/webp', 'image/avif', 'image/png', 'image/jpeg', 'image/jpg'];
        if (!allowedTypes.includes(contentType)) {
          return res.status(400).json({ error: 'unsupported contentType' });
        }
        // Path sanitization — only allow safe chars, no leading slashes, no ".."
        if (!/^[A-Za-z0-9/_.-]+$/.test(fileName) || fileName.includes('..') || fileName.startsWith('/')) {
          return res.status(400).json({ error: 'invalid fileName' });
        }
        let buffer: Buffer;
        try {
          buffer = Buffer.from(fileBase64, 'base64');
        } catch {
          return res.status(400).json({ error: 'invalid base64' });
        }
        // 5 MB hard cap (storage bucket also enforces this).
        if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
          return res.status(413).json({ error: 'file too large or empty (max 5 MB)' });
        }

        const { error: upErr } = await supabaseAdmin.storage
          .from('product-images')
          .upload(fileName, buffer, {
            contentType,
            upsert: true,
            cacheControl: '31536000',
          });
        if (upErr) {
          console.error('[admin-data] upload-image error:', upErr.message);
          return res.status(500).json({ error: 'Upload failed' });
        }
        const { data: publicData } = supabaseAdmin.storage
          .from('product-images')
          .getPublicUrl(fileName);
        return res.status(200).json({ success: true, url: publicData.publicUrl, path: fileName });
      }

      // ── Merged from capi-replay.ts ──────────────────────────────
      if (resource === 'capi-replay') {
        const { eventIds } = body as { eventIds?: unknown };
        if (!Array.isArray(eventIds) || eventIds.length === 0) {
          return res.status(400).json({ error: 'eventIds array required' });
        }
        const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
        const host = req.headers.host;
        const baseUrl = `${protocol}://${host}`;
        const stringIds = eventIds.filter((x): x is string => typeof x === 'string');
        const { data: rows, error } = await supabaseAdmin.from('analytics_events').select('event_id,event_name,user_data,custom_data,url').in('event_id', stringIds);
        if (error) throw new Error(error.message);
        const byId = new Map<string, (typeof rows)[number]>();
        for (const r of rows ?? []) if (r.event_id) byId.set(r.event_id, r);
        const results = await Promise.all(stringIds.map(async (id) => {
          const row = byId.get(id);
          if (!row) return { id, status: 'not_found' };
          try {
            await axios.post(`${baseUrl}/api/server-relay?action=lite`, { event: row.event_name, userData: row.user_data, customData: row.custom_data, event_id: row.event_id, url: row.url });
            return { id, status: 'success' };
          } catch (err: unknown) {
            const ax = err as { message?: string; response?: { data?: unknown } };
            return { id, status: 'error', message: ax.message, details: ax.response?.data };
          }
        }));
        return res.status(200).json({ results });
      }

      switch (resource) {
        case 'products': {
          const incoming = body as Record<string, unknown>;
          const clean = filterFields(incoming, PRODUCT_EDITABLE) as Record<string, unknown>;
          // Preserve id when present (for upsert) — it's NOT in the editable set
          // because that set protects against PUT-overwrite of system fields.
          if (typeof incoming.id === 'string') clean.id = incoming.id;
          const { error, data } = await supabaseAdmin
            .from('products')
            .upsert(clean as never, { onConflict: 'id' })
            .select('id')
            .single();
          if (error) throw new Error(error.message);
          return res.status(200).json({ success: true, id: data?.id });
        }
        case 'categories': {
          const { id: _unused, ...rest } = body;
          const clean = filterFields(rest as Record<string, unknown>, CATEGORY_EDITABLE);
          const { data, error } = await supabaseAdmin
            .from('categories')
            .insert(clean as never)
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
    console.error('[admin-data] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
