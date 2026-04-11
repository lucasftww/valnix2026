import type { DocumentData, QuerySnapshot } from 'firebase-admin/firestore';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase';
import { verifyAdminToken, setCorsHeaders } from './_utils/helpers';

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

function startOfTodayBrtMs(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return new Date().setHours(0, 0, 0, 0);
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`).getTime();
}

function inPeriod(ts: number, period: PeriodKey): boolean {
  const now = Date.now();
  if (period === 'today') return ts >= startOfTodayBrtMs() && ts <= now;
  if (period === '7d') return ts >= now - 7 * 86400000;
  return ts >= now - 30 * 86400000;
}

type OrderRow = {
  id: string;
  total_amount: number;
  payment_status: string;
  status: string;
  payment_method: string | null;
  customer_name?: string | null;
  created_at?: string;
};

function docToOrder(id: string, data: DocumentData): OrderRow {
  return {
    id,
    total_amount: Number(data.total_amount) || 0,
    payment_status: String(data.payment_status || 'pending'),
    status: String(data.status || 'pending'),
    payment_method: data.payment_method != null ? String(data.payment_method) : null,
    customer_name: data.customer_name ?? null,
    created_at: data.created_at ?? data.updated_at ?? '',
  };
}

async function fetchAllOrders(limit = 8000): Promise<OrderRow[]> {
  try {
    const snap = await db.collection('orders').orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map((d) => docToOrder(d.id, d.data()));
  } catch {
    const snap = await db.collection('orders').limit(limit).get();
    const rows = snap.docs.map((d) => docToOrder(d.id, d.data()));
    rows.sort((a, b) => parseOrderMs(b.created_at) - parseOrderMs(a.created_at));
    return rows;
  }
}

function parseOrderMs(created_at?: string): number {
  if (!created_at) return 0;
  const t = new Date(created_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function fetchOrderLineItems(orderId: string): Promise<Array<{ id: string; [k: string]: unknown }>> {
  const subPaths = ['items', 'order_items'];
  for (const sub of subPaths) {
    const snap = await db.collection('orders').doc(orderId).collection(sub).get();
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  }
  const q = await db.collection('order_items').where('order_id', '==', orderId).get();
  if (!q.empty) {
    return q.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return [];
}

async function updateOrderItemDelivery(orderId: string, itemId: string, delivery_code: string): Promise<void> {
  const now = new Date().toISOString();
  for (const sub of ['items', 'order_items']) {
    const ref = db.collection('orders').doc(orderId).collection(sub).doc(itemId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ delivery_code, updated_at: now });
      return;
    }
  }
  const top = await db.collection('order_items').doc(itemId).get();
  if (top.exists) {
    const data = top.data();
    if (data?.order_id === orderId || data?.orderId === orderId) {
      await top.ref.update({ delivery_code, updated_at: now });
      return;
    }
  }
  throw new Error('Order item not found');
}

function periodStats(orders: OrderRow[], period: PeriodKey) {
  const inP = orders.filter((o) => inPeriod(parseOrderMs(o.created_at), period));
  const paid = inP.filter((o) => o.payment_status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.total_amount, 0);
  const paidCount = paid.length;
  const failed = inP.filter(
    (o) => o.status === 'cancelled' || o.payment_status === 'failed' || o.payment_status === 'expired'
  ).length;
  const avgTicket = paidCount > 0 ? revenue / paidCount : 0;
  return {
    revenue,
    orders: inP.length,
    paidCount,
    avgTicket,
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
    days.push({
      key,
      name: WEEKDAY_SHORT[d.getDay()],
      receita: 0,
    });
  }
  const keySet = new Set(days.map((x) => x.key));
  for (const o of orders) {
    if (o.payment_status !== 'paid') continue;
    const t = parseOrderMs(o.created_at);
    if (!t) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    if (!keySet.has(key)) continue;
    const row = days.find((d) => d.key === key);
    if (row) row.receita += o.total_amount;
  }
  return days.map(({ name, receita }) => ({ name, receita }));
}

async function buildDashboardStats(): Promise<Record<string, unknown>> {
  const [orders, productsSnap] = await Promise.all([
    fetchAllOrders(),
    db.collection('products').get(),
  ]);

  const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const totalProducts = products.filter((p: { is_active?: boolean }) => p.is_active !== false).length;

  const periods: Record<PeriodKey, ReturnType<typeof periodStats>> = {
    today: periodStats(orders, 'today'),
    '7d': periodStats(orders, '7d'),
    '30d': periodStats(orders, '30d'),
  };

  const paidOrders = orders.filter((o) => o.payment_status === 'paid');
  const recentOrders = [...paidOrders]
    .sort((a, b) => parseOrderMs(b.created_at) - parseOrderMs(a.created_at))
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      customer_name: o.customer_name,
      created_at: o.created_at,
      total_amount: o.total_amount,
    }));

  const pendingDelivery = orders.filter(
    (o) => o.payment_status === 'paid' && (o.status === 'processing' || o.status === 'pending')
  ).length;

  const last30 = orders.filter((o) => inPeriod(parseOrderMs(o.created_at), '30d'));
  const paid30 = last30.filter((o) => o.payment_status === 'paid');

  const productAgg = new Map<string, { quantity: number; revenue: number }>();
  const sampleIds = paid30.slice(0, 400).map((o) => o.id);
  await Promise.all(
    sampleIds.map(async (oid) => {
      try {
        const items = await fetchOrderLineItems(oid);
        for (const it of items) {
          const name = String((it as { product_name?: string }).product_name || 'Produto');
          const qty = Number((it as { quantity?: number }).quantity) || 0;
          const line = Number((it as { total_price?: number }).total_price) || 0;
          const cur = productAgg.get(name) || { quantity: 0, revenue: 0 };
          cur.quantity += qty;
          cur.revenue += line;
          productAgg.set(name, cur);
        }
      } catch {
        /* skip */
      }
    })
  );

  const topProducts = [...productAgg.entries()]
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 8);

  const in30 = last30.length;
  const paidC = last30.filter((o) => o.payment_status === 'paid').length;
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

async function handleCleanupAnalytics(req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
  const after_date = String(body.after_date || '');
  const before_date = String(body.before_date || '');
  const dry_run = Boolean(body.dry_run);
  if (!after_date || !before_date) {
    return res.status(400).json({ error: 'after_date and before_date required', success: false });
  }
  let snap: QuerySnapshot;
  try {
    snap = await db
      .collection('analytics_events')
      .where('timestamp', '>=', after_date)
      .where('timestamp', '<=', before_date)
      .get();
  } catch {
    const all = await db.collection('analytics_events').get();
    const docs = all.docs.filter((d) => {
      const t = String(d.data().timestamp || '');
      return t >= after_date && t <= before_date;
    });
    if (dry_run) {
      return res.status(200).json({
        dry_run: true,
        would_delete: docs.length,
        preview_ids: docs.slice(0, 20).map((d) => d.id),
      });
    }
    let deleted = 0;
    const batchSize = 400;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + batchSize)) {
        batch.delete(d.ref);
        deleted++;
      }
      await batch.commit();
    }
    return res.status(200).json({ success: true, deleted });
  }

  if (dry_run) {
    return res.status(200).json({
      dry_run: true,
      would_delete: snap.size,
      preview_ids: snap.docs.slice(0, 20).map((d) => d.id),
    });
  }

  let deleted = 0;
  const batchSize = 400;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + batchSize)) {
      batch.delete(d.ref);
      deleted++;
    }
    await batch.commit();
  }
  return res.status(200).json({ success: true, deleted });
}

async function handleCleanupCapiLogs(res: VercelResponse) {
  const failed = await db.collection('analytics_events').where('status', '==', 'failed').get();
  let deleted = 0;
  const batchSize = 400;
  const docs = failed.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + batchSize)) {
      batch.delete(d.ref);
      deleted++;
    }
    await batch.commit();
  }
  return res.status(200).json({ success: true, deleted });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
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
          const snap = await db.collection('products').get();
          const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          return res.status(200).json({ products });
        }
        case 'categories': {
          const snap = await db.collection('categories').get();
          const categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          return res.status(200).json({ categories });
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
          const batch: Record<string, unknown[]> = {};
          await Promise.all(
            ids.map(async (oid) => {
              batch[oid] = await fetchOrderLineItems(oid);
            })
          );
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
      switch (resource) {
        case 'orders':
          await db.collection('orders').doc(id).delete();
          return res.status(200).json({ success: true });
        case 'products':
          await db.collection('products').doc(id).delete();
          return res.status(200).json({ success: true });
        case 'categories':
          await db.collection('categories').doc(id).delete();
          return res.status(200).json({ success: true });
        default:
          return res.status(400).json({ error: 'Unknown resource for DELETE' });
      }
    }

    // ── PUT ──────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const now = new Date().toISOString();
      switch (resource) {
        case 'verify-payment': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          await db
            .collection('orders')
            .doc(id)
            .update({
              payment_status: String(body.payment_status || 'paid'),
              status: String(body.status || 'processing'),
              updated_at: now,
            });
          return res.status(200).json({ success: true });
        }
        case 'orders': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          await db.collection('orders').doc(id).update({ ...rest, updated_at: now });
          return res.status(200).json({ success: true });
        }
        case 'products': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          await db.collection('products').doc(id).update({ ...rest, updated_at: now });
          return res.status(200).json({ success: true });
        }
        case 'categories': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          const { id: _i, ...rest } = body;
          await db.collection('categories').doc(id).update({ ...rest, updated_at: now });
          return res.status(200).json({ success: true });
        }
        case 'order-items': {
          const orderId = String(body.orderId || '');
          const itemId = String(body.id || '');
          const delivery_code = String(body.delivery_code ?? '');
          if (!orderId || !itemId) return res.status(400).json({ error: 'orderId and id required' });
          await updateOrderItemDelivery(orderId, itemId, delivery_code);
          return res.status(200).json({ success: true });
        }
        default:
          return res.status(400).json({ error: 'Unknown resource for PUT' });
      }
    }

    // ── POST ─────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (resource === 'cleanup-analytics') {
        return handleCleanupAnalytics(req, res, body);
      }
      if (resource === 'cleanup-capi-logs') {
        return handleCleanupCapiLogs(res);
      }

      switch (resource) {
        case 'products': {
          const id = String(body.id || '');
          if (!id) return res.status(400).json({ error: 'id required' });
          await db.collection('products').doc(id).set({ ...body, id });
          return res.status(200).json({ success: true, id });
        }
        case 'categories': {
          const { id: _unused, ...rest } = body;
          const ref = await db.collection('categories').add({
            ...rest,
            updated_at: new Date().toISOString(),
          });
          return res.status(200).json({ success: true, id: ref.id });
        }
        default:
          return res.status(400).json({ error: 'Unknown resource for POST' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin API error:', message);
    return res.status(500).json({ error: message });
  }
}
