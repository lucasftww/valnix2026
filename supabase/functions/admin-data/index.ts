import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { extractValue, queryCollectionSimple, queryCollectionFiltered, updateFirestoreDoc, deleteFirestoreDoc, createFirestoreDoc } from '../_shared/firestore.ts';
import { createInMemoryRateLimiter } from '../_shared/rate-limit.ts';

const ADMIN_SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase';

// ── Paginated collection query ──
async function queryCollectionPaginated(col: string, batchSize = 500): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const allDocs: any[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) {
    const structuredQuery: any = {
      from: [{ collectionId: col }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: batchSize,
    };
    if (lastDocName) {
      structuredQuery.startAt = { values: [{ referenceValue: lastDocName }], before: false };
    }
    const res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) { console.error(`❌ Paginated query ${col} page ${page} failed`); break; }
    const results = await res.json();
    const docs = Array.isArray(results) ? results.filter((r: any) => r.document) : [];
    if (docs.length === 0) break;
    for (const r of docs) {
      const fields = r.document.fields || {};
      const obj: any = { id: r.document.name.split('/').pop() };
      for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
      allDocs.push(obj);
    }
    lastDocName = docs[docs.length - 1].document.name;
    if (docs.length < batchSize) break;
  }
  return allDocs;
}

// Query orders filtered by created_at >= cutoffISO
async function queryOrdersSince(cutoffISO: string): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const allDocs: any[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) {
    const structuredQuery: any = {
      from: [{ collectionId: 'ordens' }],
      where: { fieldFilter: { field: { fieldPath: 'created_at' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: cutoffISO } } },
      orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
      limit: 500,
    };
    if (lastDocName) {
      const lastDoc = allDocs[allDocs.length - 1];
      structuredQuery.startAt = { values: [{ stringValue: lastDoc?.created_at || '' }, { referenceValue: lastDocName }], before: false };
    }
    const res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) {
      console.warn(`⚠️ Paginated order query failed (page ${page}), falling back to simple query`);
      if (page === 0) return queryCollectionFiltered('ordens', [{ field: 'created_at', op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: cutoffISO } }]);
      break;
    }
    const results = await res.json();
    const docs = Array.isArray(results) ? results.filter((r: any) => r.document) : [];
    if (docs.length === 0) break;
    for (const r of docs) {
      const fields = r.document.fields || {};
      const obj: any = { id: r.document.name.split('/').pop() };
      for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
      allDocs.push(obj);
    }
    lastDocName = docs[docs.length - 1].document.name;
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

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token", methods: "GET, POST, PUT, DELETE, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  rateLimiter.maybeCleanup();
  const rl = rateLimiter.check(clientIp);
  if (!rl.allowed) {
    console.warn(`🚫 Rate limited admin-data: ip=${clientIp}`);
    return new Response(JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 120) } });
  }

  try {
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) return new Response(JSON.stringify({ error: "Admin token required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) {
      console.warn(`🚨 BLOCKED admin-data attempt | ip=${clientIp} | resource=${new URL(req.url).searchParams.get("resource")} | method=${req.method}`);
      return new Response(JSON.stringify({ error: "Invalid or expired admin token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");

    // ── GET: Fetch data ──
    if (req.method === "GET") {
      if (resource === "check-admin") {
        const checkUserId = url.searchParams.get("userId");
        if (!checkUserId) return new Response(JSON.stringify({ isAdmin: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const isAdmin = await isAdminInFirestore(checkUserId);
        return new Response(JSON.stringify({ isAdmin }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "products") {
        const [products, allCodes] = await Promise.all([queryCollectionSimple("products"), queryCollectionSimple("product_codes")]);
        const codesMap = new Map<string, string[]>();
        for (const c of allCodes) codesMap.set(c.id, c.codes || []);
        for (const p of products) p.auto_delivery_codes = codesMap.get(p.id) || p.auto_delivery_codes || [];
        products.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
        return new Response(JSON.stringify({ products }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "categories") {
        const categories = await queryCollectionSimple("categories");
        categories.sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
        return new Response(JSON.stringify({ categories }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "orders") {
        const orders = await queryCollectionSimple("ordens");
        for (const o of orders) {
          if (o.created_at && typeof o.created_at === 'object' && o.created_at.seconds) o.created_at = new Date(o.created_at.seconds * 1000).toISOString();
          if (o.updated_at && typeof o.updated_at === 'object' && o.updated_at.seconds) o.updated_at = new Date(o.updated_at.seconds * 1000).toISOString();
        }
        orders.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
        return new Response(JSON.stringify({ orders }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "order-items") {
        const orderId = url.searchParams.get("orderId");
        if (!orderId) return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
        const itemsUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`;
        const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        let items: any[] = [];
        if (itemsRes.ok) {
          const data = await itemsRes.json();
          items = (data.documents || []).map((doc: any) => {
            const fields = doc.fields || {};
            const obj: any = { id: doc.name.split('/').pop() };
            for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
            return obj;
          });
        }
        return new Response(JSON.stringify({ items }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "coupons") {
        const coupons = await queryCollectionSimple("coupons");
        for (const c of coupons) { if (c.created_at && typeof c.created_at === 'object' && c.created_at.seconds) c.created_at = new Date(c.created_at.seconds * 1000).toISOString(); }
        coupons.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
        return new Response(JSON.stringify({ coupons }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "dashboard-stats") {
        const now = new Date();
        const todayCutoff = new Date(now); todayCutoff.setHours(0, 0, 0, 0);
        const d7Cutoff = new Date(now); d7Cutoff.setDate(now.getDate() - 7);
        const d30Cutoff = new Date(now); d30Cutoff.setDate(now.getDate() - 30);
        const [orders, products, productCodes] = await Promise.all([queryOrdersSince(d30Cutoff.toISOString()), queryCollectionSimple("products"), queryCollectionSimple("product_codes")]);
        console.log(`📊 dashboard-stats: ${orders.length} orders (last 30d), ${products.length} products`);
        for (const o of orders) {
          if (o.created_at && typeof o.created_at === 'object' && o.created_at.seconds) o.created_at = new Date(o.created_at.seconds * 1000).toISOString();
          if (o.updated_at && typeof o.updated_at === 'object' && o.updated_at.seconds) o.updated_at = new Date(o.updated_at.seconds * 1000).toISOString();
        }
        const filterByDate = (items: any[], cutoff: Date) => items.filter((i: any) => { const d = new Date(i.created_at); return !isNaN(d.getTime()) && d >= cutoff; });
        const computePeriod = (periodOrders: any[]) => {
          const paid = periodOrders.filter((o: any) => o.payment_status === 'paid');
          const revenue = paid.reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0);
          return { orders: periodOrders.length, paidCount: paid.length, revenue, avgTicket: paid.length > 0 ? revenue / paid.length : 0, failed: periodOrders.filter((o: any) => o.payment_status === 'failed').length };
        };
        const periods = { today: computePeriod(filterByDate(orders, todayCutoff)), '7d': computePeriod(filterByDate(orders, d7Cutoff)), '30d': computePeriod(orders) };
        const allPaid = orders.filter((o: any) => o.payment_status === 'paid');
        const accessTokenItems = await getFirebaseAccessToken(ADMIN_SCOPE);
        const itemBatches = await Promise.all(allPaid.map(async (order: any) => {
          try {
            const iUrl = `${FIRESTORE_BASE}/ordens/${order.id}/items?pageSize=50`;
            const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${accessTokenItems}` } });
            if (!iRes.ok) return [];
            const iData = await iRes.json();
            return (iData.documents || []).map((doc: any) => { const fields = doc.fields || {}; const obj: any = { id: doc.name.split('/').pop(), order_id: order.id }; for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v); return obj; });
          } catch { return []; }
        }));
        const orderItems = itemBatches.flat();
        const productSales: Record<string, { quantity: number; revenue: number }> = {};
        for (const item of orderItems) { const name = item.product_name || 'Desconhecido'; if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 }; productSales[name].quantity += Number(item.quantity) || 0; productSales[name].revenue += Number(item.total_price) || 0; }
        const topProducts = Object.entries(productSales).sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 5);
        const last7Days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().split('T')[0]; });
        const revenueByDay = last7Days.map(date => { const dayPaid = orders.filter((o: any) => o.created_at?.startsWith(date) && o.payment_status === 'paid'); const rev = dayPaid.reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0); const dn = new Date(date).toLocaleDateString('pt-BR', { weekday: 'short' }); return { name: dn.charAt(0).toUpperCase() + dn.slice(1, 3), receita: rev, pedidos: dayPaid.length }; });
        const paymentDistribution = [{ name: 'Pago', value: allPaid.length, color: '#10b981' }, { name: 'Pendente', value: orders.filter((o: any) => o.payment_status === 'pending').length, color: '#f59e0b' }, { name: 'Falhou', value: orders.filter((o: any) => o.payment_status === 'failed').length, color: '#ef4444' }].filter(i => i.value > 0);
        const alerts: { type: string; title: string; description: string }[] = [];
        const needsRefund = orders.filter((o: any) => o.payment_status === 'error_needs_refund');
        if (needsRefund.length > 0) alerts.push({ type: 'error', title: `${needsRefund.length} pedido(s) com erro de reembolso`, description: 'Reembolso automático falhou. Ação manual necessária.' });
        const codesMap = new Map<string, number>(); for (const c of productCodes) codesMap.set(c.id, (c.codes || []).length);
        const lowStock = products.filter((p: any) => p.delivery_type === 'auto_real' && p.is_active !== false && (codesMap.get(p.id) || 0) < 3);
        if (lowStock.length > 0) alerts.push({ type: 'warning', title: `${lowStock.length} produto(s) com estoque baixo`, description: `Produtos auto_real com < 3 códigos: ${lowStock.map((p: any) => p.name).join(', ')}` });
        const recentOrders = [...allPaid].sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8).map((o: any) => ({ id: o.id, customer_name: o.customer_name || '', total_amount: Number(o.total_amount) || 0, created_at: o.created_at }));
        const pendingDelivery = orders.filter((o: any) => o.payment_status === 'paid' && o.status !== 'completed' && o.status !== 'cancelled').length;
        return new Response(JSON.stringify({ periods, topProducts, revenueByDay, paymentDistribution, alerts, recentOrders, pendingDelivery, totalProducts: products.filter((p: any) => p.is_active !== false).length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── POST: Create ──
    if (req.method === "POST") {
      const body = await req.json();
      const sanitize = (obj: Record<string, unknown>) => { const dangerous = ['__proto__', 'constructor', 'prototype']; for (const key of Object.keys(obj)) { if (dangerous.includes(key)) delete obj[key]; } return obj; };

      if (resource === "products") {
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'created_at', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const docId = body.id || crypto.randomUUID(); delete body.id;
        const safeBody: Record<string, unknown> = {}; const sanitized = sanitize(body);
        for (const key of Object.keys(sanitized)) { if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = sanitized[key]; }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await createFirestoreDoc("products", docId, safeBody);
        if (body.auto_delivery_codes && Array.isArray(body.auto_delivery_codes)) await createFirestoreDoc("product_codes", docId, { codes: body.auto_delivery_codes, updated_at: new Date().toISOString() });
        return new Response(JSON.stringify({ success, id: docId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "categories") {
        const CATEGORY_ALLOWED_FIELDS = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'created_at', 'updated_at'];
        const docId = body.id || crypto.randomUUID(); delete body.id;
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(sanitize(body))) { if (CATEGORY_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        const success = await createFirestoreDoc("categories", docId, safeBody);
        return new Response(JSON.stringify({ success, id: docId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "coupons") {
        const COUPON_ALLOWED_FIELDS = ['code', 'description', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'min_purchase_amount', 'expires_at', 'created_at', 'updated_at'];
        const docId = body.id || crypto.randomUUID(); delete body.id;
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(sanitize(body))) { if (COUPON_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        const success = await createFirestoreDoc("coupons", docId, safeBody);
        return new Response(JSON.stringify({ success, id: docId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "cleanup-analytics") {
        const { before_date, after_date, event_names, dry_run } = body;
        if (!before_date && !after_date) return new Response(JSON.stringify({ error: "before_date or after_date required (ISO format)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
        const queryUrl = `${FIRESTORE_BASE}:runQuery`;
        const filters: any[] = [];
        if (after_date) filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: after_date } } });
        if (before_date) filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'LESS_THAN', value: { stringValue: before_date } } });
        const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
        const res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'analytics_events' }], where, limit: 10000 } }) });
        if (!res.ok) return new Response(JSON.stringify({ error: "Failed to query analytics events" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const results = await res.json();
        const docs = Array.isArray(results) ? results.filter((r: any) => r.document) : [];
        const validNames = event_names && Array.isArray(event_names) && event_names.length > 0 ? new Set(event_names) : null;
        const toDelete = docs.filter((r: any) => { if (!validNames) return true; return validNames.has(r.document.fields?.event_name?.stringValue); });
        if (dry_run) { const counts: Record<string, number> = {}; for (const r of toDelete) { const name = r.document.fields?.event_name?.stringValue || 'unknown'; counts[name] = (counts[name] || 0) + 1; } return new Response(JSON.stringify({ dry_run: true, total: toDelete.length, by_event: counts }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
        let deleted = 0; const errors: string[] = [];
        for (const r of toDelete) { const docPath = r.document.name; try { const delRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }); if (delRes.ok || delRes.status === 404) deleted++; else errors.push(`Failed: ${docPath}`); } catch (err: any) { errors.push(`Error: ${docPath}: ${err.message}`); } }
        console.log(`🧹 Analytics cleanup: deleted ${deleted}/${toDelete.length} events`);
        await createFirestoreDoc("admin_audit_logs", crypto.randomUUID(), { admin_uid: "hmac_admin", admin_email: "admin@hmac", action: "cleanup_analytics", details: `Deleted ${deleted} analytics events (${after_date || '*'} to ${before_date || '*'})`, ip: clientIp, created_at: new Date().toISOString() });
        return new Response(JSON.stringify({ success: true, deleted, total: toDelete.length, errors: errors.length > 0 ? errors.slice(0, 10) : undefined }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "cleanup-orders") {
        const rawEmail = (body.email || '').trim(); const email = rawEmail.toLowerCase();
        if (!email) return new Response(JSON.stringify({ error: "email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const ordersLower = await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email } }]);
        const ordersOriginal = rawEmail !== email ? await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: rawEmail } }]) : [];
        const ordersUpper = await queryCollectionFiltered("ordens", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email.toUpperCase() } }]);
        const seenIds = new Set<string>(); const orders: typeof ordersLower = [];
        for (const o of [...ordersLower, ...ordersOriginal, ...ordersUpper]) { if (!seenIds.has(o.id)) { seenIds.add(o.id); orders.push(o); } }
        if (orders.length === 0) return new Response(JSON.stringify({ success: true, deletedOrders: 0, deletedItems: 0, message: "Nenhum pedido encontrado para este email." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        let deletedItems = 0; const errors: string[] = [];
        for (const order of orders) {
          try {
            const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
            const itemsUrl = `${FIRESTORE_BASE}/ordens/${order.id}/items`;
            const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            if (itemsRes.ok) { const itemsData = await itemsRes.json(); for (const item of (itemsData.documents || [])) { const itemId = item.name.split('/').pop()!; await deleteFirestoreDoc(`ordens/${order.id}/items`, itemId); deletedItems++; } }
            await deleteFirestoreDoc("ordens", order.id);
          } catch (err: any) { errors.push(`order ${order.id}: ${err.message || err}`); }
        }
        let deletedGuest = 0;
        try { const guestLower = await queryCollectionFiltered("ordens", [{ field: "email", op: "EQUAL", value: { stringValue: email } }]); for (const g of guestLower) { try { const at = await getFirebaseAccessToken(ADMIN_SCOPE); const iUrl = `${FIRESTORE_BASE}/ordens/${g.id}/items`; const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${at}` } }); if (iRes.ok) { const iData = await iRes.json(); for (const item of (iData.documents || [])) { await deleteFirestoreDoc(`ordens/${g.id}/items`, item.name.split('/').pop()!); } } } catch {} await deleteFirestoreDoc("ordens", g.id); deletedGuest++; } } catch {}
        let deletedAddons = 0;
        try { const addonsLower = await queryCollectionFiltered("sale_addons", [{ field: "customer_email", op: "EQUAL", value: { stringValue: email } }]); for (const a of addonsLower) { await deleteFirestoreDoc("sale_addons", a.id); deletedAddons++; } } catch {}
        console.log(`🧹 Cleanup orders for ${email}: ${orders.length} orders, ${deletedItems} items`);
        return new Response(JSON.stringify({ success: true, deletedOrders: orders.length, deletedItems, deletedGuest, deletedAddons, errors: errors.length > 0 ? errors : undefined }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── PUT: Update ──
    if (req.method === "PUT") {
      const body = await req.json(); const docId = body.id;
      if (!docId) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      delete body.id;
      const sanitizePut = (obj: Record<string, unknown>) => { const dangerous = ['__proto__', 'constructor', 'prototype']; for (const key of Object.keys(obj)) { if (dangerous.includes(key)) delete obj[key]; } return obj; };
      sanitizePut(body);

      if (resource === "products") {
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(body)) { if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("products", docId, safeBody);
        if (body.auto_delivery_codes !== undefined) await createFirestoreDoc("product_codes", docId, { codes: Array.isArray(body.auto_delivery_codes) ? body.auto_delivery_codes : [], updated_at: new Date().toISOString() });
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "orders") {
        const ORDERS_EDITABLE_FIELDS = ['status', 'customer_name', 'customer_email', 'customer_phone', 'notes', 'admin_notes', 'tracking_code'];
        const ORDERS_IMMUTABLE_FIELDS = ['payment_status', 'payment_method', 'total_amount', 'subtotal', 'discount_amount', 'flowpay_charge_id', 'coupon_id', 'user_id', 'created_at'];
        const rejected = Object.keys(body).filter(k => ORDERS_IMMUTABLE_FIELDS.includes(k));
        if (rejected.length > 0) return new Response(JSON.stringify({ error: `Cannot modify immutable fields: ${rejected.join(', ')}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(body)) { if (ORDERS_EDITABLE_FIELDS.includes(key)) safeBody[key] = body[key]; }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("ordens", docId, safeBody);
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "order-items") {
        const ORDER_ITEMS_ALLOWED_FIELDS = ['delivery_code', 'delivered_at', 'admin_notes'];
        const orderId = body.orderId;
        if (!orderId) return new Response(JSON.stringify({ error: "orderId required for order-items update" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(body)) { if (ORDER_ITEMS_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        if (safeBody.delivery_code && !safeBody.delivered_at) safeBody.delivered_at = new Date().toISOString();
        const success = await updateFirestoreDoc(`ordens/${orderId}/items`, docId, safeBody);
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "categories") {
        const CATEGORY_ALLOWED_FIELDS = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'updated_at'];
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(body)) { if (CATEGORY_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("categories", docId, safeBody);
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "coupons") {
        const COUPON_ALLOWED_FIELDS = ['code', 'description', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'min_purchase_amount', 'expires_at', 'updated_at'];
        const safeBody: Record<string, unknown> = {}; for (const key of Object.keys(body)) { if (COUPON_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key]; }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("coupons", docId, safeBody);
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "verify-payment") {
        const newPaymentStatus = body.payment_status; const newStatus = body.status;
        if (!newPaymentStatus) return new Response(JSON.stringify({ error: "payment_status required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const ALLOWED_PAYMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded'];
        if (!ALLOWED_PAYMENT_STATUSES.includes(newPaymentStatus)) return new Response(JSON.stringify({ error: `Invalid payment_status. Allowed: ${ALLOWED_PAYMENT_STATUSES.join(', ')}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        try {
          const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
          const orderUrl = `${FIRESTORE_BASE}/ordens/${docId}`;
          const orderRes = await fetch(orderUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          const orderData = orderRes.ok ? await orderRes.json() : null;
          const prevPaymentStatus = orderData?.fields?.payment_status?.stringValue ?? 'unknown';
          const prevStatus = orderData?.fields?.status?.stringValue ?? 'unknown';
          const auditId = crypto.randomUUID();
          const auditUrl = `${FIRESTORE_BASE}/admin_audit_logs/${auditId}`;
          await fetch(auditUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields: { action: { stringValue: 'verify_payment' }, order_id: { stringValue: docId }, admin_uid: { stringValue: 'hmac_admin' }, admin_email: { stringValue: 'admin@hmac' }, previous_payment_status: { stringValue: prevPaymentStatus }, new_payment_status: { stringValue: newPaymentStatus }, previous_status: { stringValue: prevStatus }, new_status: { stringValue: newStatus || prevStatus }, ip: { stringValue: clientIp }, created_at: { stringValue: new Date().toISOString() } } }) });
          console.log(`📝 AUDIT: Verify payment for order ${docId}: ${prevPaymentStatus} → ${newPaymentStatus}`);
        } catch (auditErr) { console.error('⚠️ Audit log failed:', auditErr); }
        const updateData: Record<string, unknown> = { payment_status: newPaymentStatus, updated_at: new Date().toISOString() };
        if (newStatus) updateData.status = newStatus;
        const success = await updateFirestoreDoc("ordens", docId, updateData);
        return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── DELETE ──
    if (req.method === "DELETE") {
      const docId = url.searchParams.get("id");
      if (!docId) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resource === "products") {
        await Promise.all([deleteFirestoreDoc("products", docId), deleteFirestoreDoc("product_codes", docId).catch(() => {})]);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "orders") {
        const accessToken = await getFirebaseAccessToken(ADMIN_SCOPE);
        const itemsUrl = `${FIRESTORE_BASE}/ordens/${docId}/items`;
        const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (itemsRes.ok) { const itemsData = await itemsRes.json(); for (const item of (itemsData.documents || [])) { const itemId = item.name.split('/').pop()!; await deleteFirestoreDoc(`ordens/${docId}/items`, itemId); } }
        await deleteFirestoreDoc("ordens", docId);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "categories") { const success = await deleteFirestoreDoc("categories", docId); return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      if (resource === "coupons") { const success = await deleteFirestoreDoc("coupons", docId); return new Response(JSON.stringify({ success }), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      return new Response(JSON.stringify({ error: "Invalid resource" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("admin-data error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
