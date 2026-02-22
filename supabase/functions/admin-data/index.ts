import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { extractValue, queryCollectionSimple, queryCollectionFiltered, updateFirestoreDoc, deleteFirestoreDoc, createFirestoreDoc } from '../_shared/firestore.ts';
import { createInMemoryRateLimiter } from '../_shared/rate-limit.ts';

const ADMIN_SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase';

// ── Paginated collection query ──
async function queryCollectionPaginated(col: string, batchSize = 500): Promise<Record<string, unknown>[]> {
  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const allDocs: Record<string, unknown>[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: col }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: batchSize,
    };
    if (lastDocName) {
      structuredQuery.startAt = { values: [{ referenceValue: lastDocName }], before: false };
    }
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) { console.error(`❌ Paginated query ${col} page ${page} failed`); break; }
    const results = await res.json();
    const docs = Array.isArray(results) ? results.filter((r: Record<string, unknown>) => r.document) : [];
    if (docs.length === 0) break;
    for (const r of docs) {
      const doc = r.document as Record<string, unknown>;
      const fields = (doc.fields || {}) as Record<string, unknown>;
      const obj: Record<string, unknown> = { id: (doc.name as string).split('/').pop() };
      for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
      allDocs.push(obj);
    }
    const lastDoc = docs[docs.length - 1].document as Record<string, unknown>;
    lastDocName = lastDoc.name as string;
    if (docs.length < batchSize) break;
  }
  return allDocs;
}

// Query orders filtered by created_at >= cutoffISO
async function queryOrdersSince(cutoffISO: string): Promise<Record<string, unknown>[]> {
  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const allDocs: Record<string, unknown>[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: 'ordens' }],
      where: { fieldFilter: { field: { fieldPath: 'created_at' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: cutoffISO } } },
      orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
      limit: 500,
    };
    if (lastDocName) {
      const lastDoc = allDocs[allDocs.length - 1];
      structuredQuery.startAt = { values: [{ stringValue: (lastDoc?.created_at as string) || '' }, { referenceValue: lastDocName }], before: false };
    }
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) {
      console.warn(`⚠️ Paginated order query failed (page ${page}), falling back to simple query`);
      if (page === 0) return queryCollectionFiltered('ordens', [{ field: 'created_at', op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: cutoffISO } }]) as Promise<Record<string, unknown>[]>;
      break;
    }
    const results = await res.json();
    const docs = Array.isArray(results) ? results.filter((r: Record<string, unknown>) => r.document) : [];
    if (docs.length === 0) break;
    for (const r of docs) {
      const doc = r.document as Record<string, unknown>;
      const fields = (doc.fields || {}) as Record<string, unknown>;
      const obj: Record<string, unknown> = { id: (doc.name as string).split('/').pop() };
      for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
      allDocs.push(obj);
    }
    const lastDoc = docs[docs.length - 1].document as Record<string, unknown>;
    lastDocName = lastDoc.name as string;
    if (docs.length < 500) break;
  }
  return allDocs;
}

async function isAdminInFirestore(userId: string): Promise<boolean> {
  try {
    const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
    const url = `${FIRESTORE_BASE}/user_roles/${userId}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const doc = await res.json();
    return doc.fields?.role?.stringValue === 'admin';
  } catch { return false; }
}

const rateLimiter = createInMemoryRateLimiter({ max: 30, windowMs: 60_000, blockMs: 120_000 });

// Helper to normalize Firestore timestamps
function normalizeTimestamp(obj: Record<string, unknown>, field: string): void {
  const val = obj[field];
  if (val && typeof val === 'object' && (val as Record<string, unknown>).seconds) {
    obj[field] = new Date(((val as Record<string, unknown>).seconds as number) * 1000).toISOString();
  }
}

// Sanitize input
function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.keys(obj)) {
    if (dangerous.includes(key)) delete obj[key];
  }
  return obj;
}

// Filter fields by whitelist
function filterFields(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (allowed.includes(key)) safe[key] = body[key];
  }
  return safe;
}

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, {
    headers: "authorization, x-client-info, apikey, content-type, x-admin-token",
    methods: "GET, POST, PUT, DELETE, OPTIONS",
  });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  rateLimiter.maybeCleanup();
  const rl = rateLimiter.check(clientIp);
  if (!rl.allowed) {
    console.warn(`🚫 Rate limited admin-data: ip=${clientIp}`);
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 120) },
    });
  }

  try {
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) {
      return new Response(JSON.stringify({ error: "Admin token required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) {
      console.warn(`🚨 BLOCKED admin-data attempt | ip=${clientIp} | resource=${new URL(req.url).searchParams.get("resource")} | method=${req.method}`);
      return new Response(JSON.stringify({ error: "Invalid or expired admin token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");

    // ── GET: Fetch data ──
    if (req.method === "GET") {
      return await handleGet(resource, url, corsHeaders, clientIp);
    }

    // ── POST: Create ──
    if (req.method === "POST") {
      return await handlePost(resource, req, corsHeaders, clientIp);
    }

    // ── PUT: Update ──
    if (req.method === "PUT") {
      return await handlePut(resource, req, corsHeaders, clientIp);
    }

    // ── DELETE ──
    if (req.method === "DELETE") {
      return await handleDelete(resource, url, corsHeaders);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("admin-data error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// GET handler
// ════════════════════════════════════════════════════════════════════
async function handleGet(
  resource: string | null,
  url: URL,
  corsHeaders: Record<string, string>,
  _clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (resource === "check-admin") {
    const checkUserId = url.searchParams.get("userId");
    if (!checkUserId) return json({ isAdmin: false });
    const isAdmin = await isAdminInFirestore(checkUserId);
    return json({ isAdmin });
  }

  if (resource === "products") {
    const [products, allCodes] = await Promise.all([
      queryCollectionSimple("products"),
      queryCollectionSimple("product_codes"),
    ]);
    const codesMap = new Map<string, string[]>();
    for (const c of allCodes) codesMap.set(c.id as string, (c.codes as string[]) || []);
    for (const p of products) {
      p.auto_delivery_codes = codesMap.get(p.id as string) || (p.auto_delivery_codes as string[]) || [];
    }
    products.sort((a, b) => ((b.created_at as string) || '').localeCompare((a.created_at as string) || ''));
    return json({ products });
  }

  if (resource === "categories") {
    const categories = await queryCollectionSimple("categories");
    categories.sort((a, b) => ((a.display_order as number) || 0) - ((b.display_order as number) || 0));
    return json({ categories });
  }

  if (resource === "orders") {
    const orders = await queryCollectionSimple("ordens");
    console.log(`📦 orders resource: ${orders.length} orders found`);
    for (const o of orders) {
      normalizeTimestamp(o as Record<string, unknown>, 'created_at');
      normalizeTimestamp(o as Record<string, unknown>, 'updated_at');
    }
    orders.sort((a, b) => ((b.created_at as string) || '').localeCompare((a.created_at as string) || ''));
    return json({ orders });
  }

  if (resource === "order-items") {
    const orderId = url.searchParams.get("orderId");
    if (!orderId) return json({ error: "orderId required" }, 400);
    const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
    const itemsUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`;
    const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    let items: Record<string, unknown>[] = [];
    if (itemsRes.ok) {
      const data = await itemsRes.json();
      items = (data.documents || []).map((doc: Record<string, unknown>) => {
        const fields = (doc.fields || {}) as Record<string, unknown>;
        const obj: Record<string, unknown> = { id: (doc.name as string).split('/').pop() };
        for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
        return obj;
      });
    }
    return json({ items });
  }

  if (resource === "coupons") {
    const coupons = await queryCollectionSimple("coupons");
    for (const c of coupons) normalizeTimestamp(c as Record<string, unknown>, 'created_at');
    coupons.sort((a, b) => ((b.created_at as string) || '').localeCompare((a.created_at as string) || ''));
    return json({ coupons });
  }

  if (resource === "dashboard-stats") {
    return await handleDashboardStats(corsHeaders);
  }

  return json({ error: "Invalid resource" }, 400);
}

// ── Dashboard stats ──
async function handleDashboardStats(corsHeaders: Record<string, string>): Promise<Response> {
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const now = new Date();
  const todayCutoff = new Date(now);
  todayCutoff.setHours(0, 0, 0, 0);
  const d7Cutoff = new Date(now);
  d7Cutoff.setDate(now.getDate() - 7);
  const d30Cutoff = new Date(now);
  d30Cutoff.setDate(now.getDate() - 30);

  const [orders, products, productCodes, allAddons] = await Promise.all([
    queryOrdersSince(d30Cutoff.toISOString()),
    queryCollectionSimple("products"),
    queryCollectionSimple("product_codes"),
    queryCollectionSimple("sale_addons"),
  ]);
  console.log(`📊 dashboard-stats: ${orders.length} orders (last 30d), ${products.length} products, ${allAddons.length} addons`);
  
  // Normalize addon timestamps
  for (const a of allAddons) {
    normalizeTimestamp(a, 'paid_at');
    normalizeTimestamp(a, 'created_at');
  }
  const paidAddons = allAddons.filter((a) => a.status === 'paid');

  for (const o of orders) {
    normalizeTimestamp(o, 'created_at');
    normalizeTimestamp(o, 'updated_at');
  }

  const filterByDate = (items: Record<string, unknown>[], cutoff: Date) =>
    items.filter((i) => {
      const d = new Date(i.created_at as string);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

  const computePeriod = (periodOrders: Record<string, unknown>[], periodAddons: Record<string, unknown>[] = []) => {
    const paid = periodOrders.filter((o) => o.payment_status === 'paid');
    const orderRevenue = paid.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const upsellRevenue = periodAddons
      .filter((a) => a.status === 'paid')
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const revenue = Math.round((orderRevenue + upsellRevenue) * 100) / 100;
    return {
      orders: paid.length,
      paidCount: paid.length,
      revenue,
      avgTicket: paid.length > 0 ? Math.round((revenue / paid.length) * 100) / 100 : 0,
      failed: periodOrders.filter((o) => o.payment_status === 'failed').length,
      pending: periodOrders.filter((o) => o.payment_status === 'pending').length,
      totalAttempts: periodOrders.length,
      upsellRevenue: Math.round(upsellRevenue * 100) / 100,
    };
  };

  const filterAddonsByDate = (addons: Record<string, unknown>[], cutoff: Date) =>
    addons.filter((a) => {
      const d = new Date((a.paid_at || a.created_at) as string);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

  const periods = {
    today: computePeriod(filterByDate(orders, todayCutoff), filterAddonsByDate(paidAddons, todayCutoff)),
    '7d': computePeriod(filterByDate(orders, d7Cutoff), filterAddonsByDate(paidAddons, d7Cutoff)),
    '30d': computePeriod(orders, paidAddons),
  };

  const allPaid = orders.filter((o) => o.payment_status === 'paid');

  // Fetch items for paid orders
  const accessTokenItems = await getFirebaseAccessToken(ADMIN_SCOPE);
  const itemBatches = await Promise.all(
    allPaid.map(async (order) => {
      try {
        const iUrl = `${FIRESTORE_BASE}/ordens/${order.id}/items?pageSize=50`;
        const iRes = await fetch(iUrl, { headers: { Authorization: `Bearer ${accessTokenItems}` } });
        if (!iRes.ok) return [];
        const iData = await iRes.json();
        return (iData.documents || []).map((doc: Record<string, unknown>) => {
          const fields = (doc.fields || {}) as Record<string, unknown>;
          const obj: Record<string, unknown> = { id: (doc.name as string).split('/').pop(), order_id: order.id };
          for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
          return obj;
        });
      } catch {
        return [];
      }
    })
  );
  const orderItems = itemBatches.flat();

  // Top products
  const productSales: Record<string, { quantity: number; revenue: number }> = {};
  for (const item of orderItems) {
    const name = (item.product_name as string) || 'Desconhecido';
    if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
    productSales[name].quantity += Number(item.quantity) || 0;
    productSales[name].revenue += Number(item.total_price) || 0;
  }
  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 5);

  // Revenue by day (last 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const revenueByDay = last7Days.map((date) => {
    const dayPaid = orders.filter((o) => (o.created_at as string)?.startsWith(date) && o.payment_status === 'paid');
    const orderRev = dayPaid.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const dayUpsellRev = paidAddons
      .filter((a) => ((a.paid_at || a.created_at) as string)?.startsWith(date))
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const rev = Math.round((orderRev + dayUpsellRev) * 100) / 100;
    const dn = new Date(date).toLocaleDateString('pt-BR', { weekday: 'short' });
    return { name: dn.charAt(0).toUpperCase() + dn.slice(1, 3), receita: rev, pedidos: dayPaid.length };
  });

  // Payment distribution
  const paymentDistribution = [
    { name: 'Pago', value: allPaid.length, color: '#10b981' },
    { name: 'Pendente', value: orders.filter((o) => o.payment_status === 'pending').length, color: '#f59e0b' },
    { name: 'Falhou', value: orders.filter((o) => o.payment_status === 'failed').length, color: '#ef4444' },
  ].filter((i) => i.value > 0);

  // Alerts
  const alerts: { type: string; title: string; description: string }[] = [];
  const needsRefund = orders.filter((o) => o.payment_status === 'error_needs_refund');
  if (needsRefund.length > 0) {
    alerts.push({ type: 'error', title: `${needsRefund.length} pedido(s) com erro de reembolso`, description: 'Reembolso automático falhou. Ação manual necessária.' });
  }
  const codesMap = new Map<string, number>();
  for (const c of productCodes) codesMap.set(c.id as string, ((c.codes as unknown[]) || []).length);
  const lowStock = products.filter(
    (p) => p.delivery_type === 'auto_real' && p.is_active !== false && (codesMap.get(p.id as string) || 0) < 3
  );
  if (lowStock.length > 0) {
    alerts.push({
      type: 'warning',
      title: `${lowStock.length} produto(s) com estoque baixo`,
      description: `Produtos auto_real com < 3 códigos: ${lowStock.map((p) => p.name).join(', ')}`,
    });
  }

  // Recent orders
  const recentOrders = [...allPaid]
    .sort((a, b) => ((b.created_at as string) || '').localeCompare((a.created_at as string) || ''))
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      customer_name: o.customer_name || '',
      total_amount: Number(o.total_amount) || 0,
      created_at: o.created_at,
    }));

  const pendingDelivery = orders.filter(
    (o) => o.payment_status === 'paid' && o.status !== 'completed' && o.status !== 'cancelled'
  ).length;

  return json({
    periods,
    topProducts,
    revenueByDay,
    paymentDistribution,
    alerts,
    recentOrders,
    pendingDelivery,
    totalProducts: products.filter((p) => p.is_active !== false).length,
  });
}

// ════════════════════════════════════════════════════════════════════
// POST handler
// ════════════════════════════════════════════════════════════════════
async function handlePost(
  resource: string | null,
  req: Request,
  corsHeaders: Record<string, string>,
  clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json();
  sanitize(body);

  if (resource === "products") {
    const ALLOWED = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'created_at', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
    const docId = body.id || crypto.randomUUID();
    delete body.id;
    const safeBody = filterFields(body, ALLOWED);
    safeBody.updated_at = new Date().toISOString();
    const success = await createFirestoreDoc("products", docId, safeBody);
    if (body.auto_delivery_codes && Array.isArray(body.auto_delivery_codes)) {
      await createFirestoreDoc("product_codes", docId, { codes: body.auto_delivery_codes, updated_at: new Date().toISOString() });
    }
    return json({ success, id: docId });
  }

  if (resource === "categories") {
    const ALLOWED = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'created_at', 'updated_at'];
    const docId = body.id || crypto.randomUUID();
    delete body.id;
    const safeBody = filterFields(body, ALLOWED);
    const success = await createFirestoreDoc("categories", docId, safeBody);
    return json({ success, id: docId });
  }

  if (resource === "coupons") {
    const ALLOWED = ['code', 'description', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'min_purchase_amount', 'expires_at', 'created_at', 'updated_at'];
    const docId = body.id || crypto.randomUUID();
    delete body.id;
    const safeBody = filterFields(body, ALLOWED);
    const success = await createFirestoreDoc("coupons", docId, safeBody);
    return json({ success, id: docId });
  }

  if (resource === "cleanup-analytics") {
    return await handleCleanupAnalytics(body, corsHeaders, clientIp);
  }

  if (resource === "cleanup-capi-logs") {
    return await handleCleanupCapiLogs(corsHeaders, clientIp);
  }

  if (resource === "cleanup-orders") {
    return await handleCleanupOrders(body, corsHeaders, clientIp);
  }

  return json({ error: "Invalid resource" }, 400);
}

// ── Cleanup analytics ──
async function handleCleanupAnalytics(
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
  clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { before_date, after_date, event_names, dry_run } = body;
  if (!before_date && !after_date) return json({ error: "before_date or after_date required (ISO format)" }, 400);

  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const filters: Record<string, unknown>[] = [];
  if (after_date) filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: after_date } } });
  if (before_date) filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'LESS_THAN', value: { stringValue: before_date } } });
  const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'analytics_events' }], where, limit: 10000 } }),
  });
  if (!res.ok) return json({ error: "Failed to query analytics events" }, 500);

  const results = await res.json();
  const docs = Array.isArray(results) ? results.filter((r: Record<string, unknown>) => r.document) : [];
  const validNames = event_names && Array.isArray(event_names) && (event_names as string[]).length > 0 ? new Set(event_names as string[]) : null;
  const toDelete = docs.filter((r: Record<string, unknown>) => {
    if (!validNames) return true;
    const doc = r.document as Record<string, unknown>;
    const fields = (doc.fields || {}) as Record<string, Record<string, unknown>>;
    return validNames.has(fields?.event_name?.stringValue as string);
  });

  if (dry_run) {
    const counts: Record<string, number> = {};
    for (const r of toDelete) {
      const doc = r.document as Record<string, unknown>;
      const fields = (doc.fields || {}) as Record<string, Record<string, unknown>>;
      const name = (fields?.event_name?.stringValue as string) || 'unknown';
      counts[name] = (counts[name] || 0) + 1;
    }
    return json({ dry_run: true, total: toDelete.length, by_event: counts });
  }

  let deleted = 0;
  const errors: string[] = [];
  for (const r of toDelete) {
    const doc = r.document as Record<string, unknown>;
    const docPath = doc.name as string;
    try {
      const delRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (delRes.ok || delRes.status === 404) deleted++;
      else errors.push(`Failed: ${docPath}`);
    } catch (err: unknown) {
      errors.push(`Error: ${docPath}: ${(err as Error).message}`);
    }
  }
  console.log(`🧹 Analytics cleanup: deleted ${deleted}/${toDelete.length} events`);
  await createFirestoreDoc("admin_audit_logs", crypto.randomUUID(), {
    admin_uid: "hmac_admin", admin_email: "admin@hmac", action: "cleanup_analytics",
    details: `Deleted ${deleted} analytics events (${after_date || '*'} to ${before_date || '*'})`,
    ip: clientIp, created_at: new Date().toISOString(),
  });
  return json({ success: true, deleted, total: toDelete.length, errors: errors.length > 0 ? errors.slice(0, 10) : undefined });
}

// ── Cleanup CAPI logs ──
async function handleCleanupCapiLogs(corsHeaders: Record<string, string>, clientIp: string): Promise<Response> {
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const collections = ["capi_event_log", "meta_purchase_events"];
  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  let totalDeleted = 0;
  const details: Record<string, number> = {};

  for (const col of collections) {
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], limit: 10000 } }),
    });
    if (!res.ok) { details[col] = 0; continue; }
    const results = await res.json();
    const docs = Array.isArray(results) ? results.filter((r: Record<string, unknown>) => r.document) : [];
    let deleted = 0;
    for (const r of docs) {
      const doc = r.document as Record<string, unknown>;
      const docPath = doc.name as string;
      try {
        const delRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
        if (delRes.ok || delRes.status === 404) deleted++;
      } catch { /* ignore */ }
    }
    details[col] = deleted;
    totalDeleted += deleted;
  }

  console.log(`🧹 CAPI logs cleanup: deleted ${totalDeleted} docs`);
  await createFirestoreDoc("admin_audit_logs", crypto.randomUUID(), {
    admin_uid: "hmac_admin", admin_email: "admin@hmac", action: "cleanup_capi_logs",
    details: `Deleted ${totalDeleted} CAPI logs`, ip: clientIp, created_at: new Date().toISOString(),
  });
  return json({ success: true, deleted: totalDeleted, details });
}

// ── Cleanup orders by email ──
async function handleCleanupOrders(
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
  clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const rawEmail = ((body.email as string) || '').trim();
  const email = rawEmail.toLowerCase();
  if (!email) return json({ error: "email required" }, 400);

  const ordersLower = await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email } }]);
  const ordersOriginal = rawEmail !== email ? await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: rawEmail } }]) : [];
  const ordersUpper = await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email.toUpperCase() } }]);

  const seenIds = new Set<string>();
  const orders: Record<string, unknown>[] = [];
  for (const o of [...ordersLower, ...ordersOriginal, ...ordersUpper]) {
    if (!seenIds.has(o.id as string)) { seenIds.add(o.id as string); orders.push(o as Record<string, unknown>); }
  }

  if (orders.length === 0) {
    return json({ success: true, deletedOrders: 0, deletedItems: 0, message: "Nenhum pedido encontrado para este email." });
  }

  let deletedItems = 0;
  const errors: string[] = [];
  for (const order of orders) {
    try {
      const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
      const itemsUrl = `${FIRESTORE_BASE}/ordens/${order.id}/items`;
      const itemsRes = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        for (const item of (itemsData.documents || [])) {
          const itemId = (item.name as string).split('/').pop()!;
          await deleteFirestoreDoc(`ordens/${order.id}/items`, itemId);
          deletedItems++;
        }
      }
      await deleteFirestoreDoc("ordens", order.id as string);
    } catch (err: unknown) {
      errors.push(`order ${order.id}: ${(err as Error).message || err}`);
    }
  }

  // Also clean guest orders
  let deletedGuest = 0;
  try {
    const guestLower = await queryCollectionFiltered("ordens", [{ field: "email", op: "EQUAL", value: { stringValue: email } }]);
    for (const g of guestLower) {
      try {
        const at = await getFirebaseAccessToken(ADMIN_SCOPE);
        const iUrl = `${FIRESTORE_BASE}/ordens/${g.id}/items`;
        const iRes = await fetch(iUrl, { headers: { Authorization: `Bearer ${at}` } });
        if (iRes.ok) {
          const iData = await iRes.json();
          for (const item of (iData.documents || [])) {
            await deleteFirestoreDoc(`ordens/${g.id}/items`, (item.name as string).split('/').pop()!);
          }
        }
      } catch { /* ignore */ }
      await deleteFirestoreDoc("ordens", g.id as string);
      deletedGuest++;
    }
  } catch { /* ignore */ }

  // Clean addons
  let deletedAddons = 0;
  try {
    const addonsLower = await queryCollectionFiltered("sale_addons", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email } }]);
    for (const a of addonsLower) { await deleteFirestoreDoc("sale_addons", a.id as string); deletedAddons++; }
  } catch { /* ignore */ }

  console.log(`🧹 Cleanup orders for ${email}: ${orders.length} orders, ${deletedItems} items`);
  return json({
    success: true,
    deletedOrders: orders.length,
    deletedItems,
    deletedGuest,
    deletedAddons,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ════════════════════════════════════════════════════════════════════
// PUT handler
// ════════════════════════════════════════════════════════════════════
async function handlePut(
  resource: string | null,
  req: Request,
  corsHeaders: Record<string, string>,
  clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json();
  const docId = body.id as string;
  if (!docId) return json({ error: "id required" }, 400);
  delete body.id;
  sanitize(body);

  if (resource === "products") {
    const ALLOWED = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
    const safeBody = filterFields(body, ALLOWED);
    safeBody.updated_at = new Date().toISOString();
    const success = await updateFirestoreDoc("products", docId, safeBody);
    if (body.auto_delivery_codes !== undefined) {
      await createFirestoreDoc("product_codes", docId, {
        codes: Array.isArray(body.auto_delivery_codes) ? body.auto_delivery_codes : [],
        updated_at: new Date().toISOString(),
      });
    }
    return json({ success });
  }

  if (resource === "orders") {
    const EDITABLE = ['status', 'customer_name', 'customer_email', 'customer_phone', 'notes', 'admin_notes', 'tracking_code'];
    const IMMUTABLE = ['payment_status', 'payment_method', 'total_amount', 'subtotal', 'discount_amount', 'flowpay_charge_id', 'coupon_id', 'user_id', 'created_at'];
    const rejected = Object.keys(body).filter((k) => IMMUTABLE.includes(k));
    if (rejected.length > 0) return json({ error: `Cannot modify immutable fields: ${rejected.join(', ')}` }, 400);
    const safeBody = filterFields(body, EDITABLE);
    safeBody.updated_at = new Date().toISOString();
    const success = await updateFirestoreDoc("ordens", docId, safeBody);
    return json({ success });
  }

  if (resource === "order-items") {
    const ALLOWED = ['delivery_code', 'delivered_at', 'admin_notes'];
    const orderId = body.orderId as string;
    if (!orderId) return json({ error: "orderId required for order-items update" }, 400);
    const safeBody = filterFields(body, ALLOWED);
    if (safeBody.delivery_code && !safeBody.delivered_at) safeBody.delivered_at = new Date().toISOString();
    const success = await updateFirestoreDoc(`ordens/${orderId}/items`, docId, safeBody);
    return json({ success });
  }

  if (resource === "categories") {
    const ALLOWED = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'updated_at'];
    const safeBody = filterFields(body, ALLOWED);
    safeBody.updated_at = new Date().toISOString();
    const success = await updateFirestoreDoc("categories", docId, safeBody);
    return json({ success });
  }

  if (resource === "coupons") {
    const ALLOWED = ['code', 'description', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'min_purchase_amount', 'expires_at', 'updated_at'];
    const safeBody = filterFields(body, ALLOWED);
    safeBody.updated_at = new Date().toISOString();
    const success = await updateFirestoreDoc("coupons", docId, safeBody);
    return json({ success });
  }

  if (resource === "verify-payment") {
    return await handleVerifyPayment(docId, body, corsHeaders, clientIp);
  }

  return json({ error: "Invalid resource" }, 400);
}

// ── Verify payment ──
async function handleVerifyPayment(
  docId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
  clientIp: string
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const newPaymentStatus = body.payment_status as string;
  const newStatus = body.status as string | undefined;
  if (!newPaymentStatus) return json({ error: "payment_status required" }, 400);
  const ALLOWED_STATUSES = ['paid', 'pending', 'failed', 'refunded'];
  if (!ALLOWED_STATUSES.includes(newPaymentStatus)) {
    return json({ error: `Invalid payment_status. Allowed: ${ALLOWED_STATUSES.join(', ')}` }, 400);
  }

  try {
    const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
    const orderUrl = `${FIRESTORE_BASE}/ordens/${docId}`;
    const orderRes = await fetch(orderUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const orderData = orderRes.ok ? await orderRes.json() : null;
    const prevPaymentStatus = orderData?.fields?.payment_status?.stringValue ?? 'unknown';
    const prevStatus = orderData?.fields?.status?.stringValue ?? 'unknown';

    const auditId = crypto.randomUUID();
    const auditUrl = `${FIRESTORE_BASE}/admin_audit_logs/${auditId}`;
    await fetch(auditUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fields: {
          action: { stringValue: 'verify_payment' },
          order_id: { stringValue: docId },
          admin_uid: { stringValue: 'hmac_admin' },
          admin_email: { stringValue: 'admin@hmac' },
          previous_payment_status: { stringValue: prevPaymentStatus },
          new_payment_status: { stringValue: newPaymentStatus },
          previous_status: { stringValue: prevStatus },
          new_status: { stringValue: newStatus || prevStatus },
          ip: { stringValue: clientIp },
          created_at: { stringValue: new Date().toISOString() },
        },
      }),
    });
    console.log(`📝 AUDIT: Verify payment for order ${docId}: ${prevPaymentStatus} → ${newPaymentStatus}`);
  } catch (auditErr) {
    console.error('⚠️ Audit log failed:', auditErr);
  }

  const updateData: Record<string, unknown> = { payment_status: newPaymentStatus, updated_at: new Date().toISOString() };
  if (newStatus) updateData.status = newStatus;
  const success = await updateFirestoreDoc("ordens", docId, updateData);
  return json({ success });
}

// ════════════════════════════════════════════════════════════════════
// DELETE handler
// ════════════════════════════════════════════════════════════════════
async function handleDelete(
  resource: string | null,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const docId = url.searchParams.get("id");
  if (!docId) return json({ error: "id required" }, 400);

  if (resource === "products") {
    await Promise.all([deleteFirestoreDoc("products", docId), deleteFirestoreDoc("product_codes", docId).catch(() => {})]);
    return json({ success: true });
  }

  if (resource === "orders") {
    const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
    const itemsUrl = `${FIRESTORE_BASE}/ordens/${docId}/items`;
    const itemsRes = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (itemsRes.ok) {
      const itemsData = await itemsRes.json();
      for (const item of (itemsData.documents || [])) {
        const itemId = (item.name as string).split('/').pop()!;
        await deleteFirestoreDoc(`ordens/${docId}/items`, itemId);
      }
    }
    await deleteFirestoreDoc("ordens", docId);
    return json({ success: true });
  }

  if (resource === "categories") {
    const success = await deleteFirestoreDoc("categories", docId);
    return json({ success });
  }

  if (resource === "coupons") {
    const success = await deleteFirestoreDoc("coupons", docId);
    return json({ success });
  }

  return json({ error: "Invalid resource" }, 400);
}
