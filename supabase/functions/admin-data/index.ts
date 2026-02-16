import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

const FIREBASE_PROJECT_ID = "valnix";

// ── Firebase Auth ──────────────────────────────────────────────────
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken;
  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!saKeyRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');
  const saKey = JSON.parse(saKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saKey.client_email, sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
  };
  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const pemBody = saKey.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Firebase auth failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  return cachedAccessToken!;
}

async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email: string } | null> {
  try {
    const apiKey = Deno.env.get('FIREBASE_WEB_API_KEY');
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY not configured');
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email || '' };
  } catch { return null; }
}

async function isAdminInFirestore(uid: string): Promise<boolean> {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const doc = await res.json();
    return doc.fields?.role?.stringValue === 'admin';
  } catch { return false; }
}

// ── Firestore helpers ──────────────────────────────────────────────
function extractValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(extractValue);
  if ('mapValue' in val) {
    const obj: any = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = extractValue(v);
    return obj;
  }
  return null;
}

async function queryCollection(col: string) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], limit: 10000 } }),
  });
  if (!res.ok) { console.error(`❌ Query ${col} failed:`, await res.text()); return []; }
  const results = await res.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document).map((r: any) => {
    const fields = r.document.fields || {};
    const obj: any = { id: r.document.name.split('/').pop() };
    for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
    return obj;
  });
}

async function queryCollectionFiltered(col: string, field: string, op: string, value: any) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: col }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value } },
        limit: 10000,
      },
    }),
  });
  if (!res.ok) return [];
  const results = await res.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document).map((r: any) => {
    const fields = r.document.fields || {};
    const obj: any = { id: r.document.name.split('/').pop() };
    for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
    return obj;
  });
}

async function updateFirestoreDoc(col: string, docId: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const fieldPaths = Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}?${fieldPaths}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map((s: string) => ({ stringValue: s })) } };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

async function deleteFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
  return res.ok;
}

async function createFirestoreDoc(col: string, docId: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map((s: string) => ({ stringValue: s })) } };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

// ── Server-side rate limiting (per-IP, in-memory) ──────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();
const RL_MAX = 30;          // max requests per window
const RL_WINDOW_MS = 60_000; // 1 minute window
const RL_BLOCK_MS = 120_000; // 2 minute block after exceeding

function checkServerRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (entry && entry.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS, blockedUntil: 0 });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > RL_MAX) {
    entry.blockedUntil = now + RL_BLOCK_MS;
    return { allowed: false, retryAfter: Math.ceil(RL_BLOCK_MS / 1000) };
  }
  return { allowed: true };
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (v.resetAt <= now && v.blockedUntil <= now) rateLimitMap.delete(k);
  }
}, 300_000);

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Rate limiting ──
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkServerRateLimit(clientIp);
  if (!rl.allowed) {
    console.warn(`🚫 Rate limited admin-data: ip=${clientIp}`);
    return new Response(JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 120) } });
  }

  try {
    // Auth check
    const firebaseToken = req.headers.get("x-firebase-token");
    if (!firebaseToken) {
      return new Response(JSON.stringify({ error: "Firebase token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userData = await verifyFirebaseToken(firebaseToken);
    if (!userData) {
      return new Response(JSON.stringify({ error: "Invalid Firebase token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminStatus = await isAdminInFirestore(userData.uid);
    if (!adminStatus) {
      console.warn(`🚨 BLOCKED admin-data attempt | uid=${userData.uid} | email=${userData.email} | resource=${new URL(req.url).searchParams.get("resource")} | method=${req.method} | origin=${req.headers.get("Origin") || "unknown"} | ip=${req.headers.get("x-forwarded-for") || "unknown"} | time=${new Date().toISOString()}`);
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");

    // ── GET: Fetch data ──────────────────────────────────────────
    if (req.method === "GET") {
      if (resource === "check-admin") {
        const checkUserId = url.searchParams.get("userId");
        if (!checkUserId) return new Response(JSON.stringify({ isAdmin: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const isAdmin = await isAdminInFirestore(checkUserId);
        return new Response(JSON.stringify({ isAdmin }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "users") {
        const [profiles, users, orders] = await Promise.all([
          queryCollection("profiles"),
          queryCollection("users"),
          queryCollection("orders"),
        ]);

        // Build order stats per user
        const orderStats = new Map<string, { total_orders: number; total_spent: number; last_order_date?: string }>();
        for (const order of orders) {
          if (order.user_id && order.payment_status === "paid") {
            const s = orderStats.get(order.user_id) || { total_orders: 0, total_spent: 0 };
            s.total_orders += 1;
            s.total_spent += Number(order.total_amount) || 0;
            const orderDate = order.created_at || '';
            if (!s.last_order_date || orderDate > s.last_order_date) s.last_order_date = orderDate;
            orderStats.set(order.user_id, s);
          }
        }

        // Merge profiles + users
        const userMap = new Map<string, any>();
        for (const p of profiles) {
          const stats = orderStats.get(p.id) || { total_orders: 0, total_spent: 0 };
          userMap.set(p.id, {
            id: p.id, email: p.email || '', created_at: p.created_at || '',
            phone: p.phone, full_name: p.full_name, nickname: p.nickname,
            avatar_url: p.avatar_url, balance: p.balance || 0,
            ...stats,
          });
        }
        for (const u of users) {
          if (!userMap.has(u.id)) {
            const stats = orderStats.get(u.id) || { total_orders: 0, total_spent: 0 };
            userMap.set(u.id, {
              id: u.id, email: u.email || '', created_at: u.created_at || '',
              phone: u.phone, full_name: u.full_name || u.displayName,
              nickname: u.nickname, avatar_url: u.avatar_url || u.photoURL,
              balance: u.balance || 0, ...stats,
            });
          }
        }

        const allUsers = Array.from(userMap.values());
        allUsers.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));

        return new Response(JSON.stringify({ users: allUsers }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "user-orders") {
        const userId = url.searchParams.get("userId");
        if (!userId) return new Response(JSON.stringify({ error: "userId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        const orders = await queryCollectionFiltered("orders", "user_id", "EQUAL", { stringValue: userId });
        orders.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));

        return new Response(JSON.stringify({ orders: orders.slice(0, 10) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "products") {
        const products = await queryCollection("products");
        products.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));

        return new Response(JSON.stringify({ products }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "categories") {
        const categories = await queryCollection("categories");
        categories.sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));

        return new Response(JSON.stringify({ categories }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "orders") {
        const orders = await queryCollection("orders");
        // Convert Firestore timestamps
        for (const o of orders) {
          if (o.created_at && typeof o.created_at === 'object' && o.created_at.seconds) {
            o.created_at = new Date(o.created_at.seconds * 1000).toISOString();
          }
          if (o.updated_at && typeof o.updated_at === 'object' && o.updated_at.seconds) {
            o.updated_at = new Date(o.updated_at.seconds * 1000).toISOString();
          }
        }
        orders.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));

        return new Response(JSON.stringify({ orders }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "order-items") {
        const orderId = url.searchParams.get("orderId");
        if (!orderId) return new Response(JSON.stringify({ error: "orderId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        const items = await queryCollectionFiltered("order_items", "order_id", "EQUAL", { stringValue: orderId });
        return new Response(JSON.stringify({ items }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "coupons") {
        const coupons = await queryCollection("coupons");
        // Convert Firestore timestamps
        for (const c of coupons) {
          if (c.created_at && typeof c.created_at === 'object' && c.created_at.seconds) {
            c.created_at = new Date(c.created_at.seconds * 1000).toISOString();
          }
        }
        coupons.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
        return new Response(JSON.stringify({ coupons }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "dashboard-stats") {
        const [orders, products, profiles, orderItems] = await Promise.all([
          queryCollection("orders"),
          queryCollection("products"),
          queryCollection("profiles"),
          queryCollection("order_items"),
        ]);

        // Convert timestamps
        for (const o of orders) {
          if (o.created_at && typeof o.created_at === 'object' && o.created_at.seconds) {
            o.created_at = new Date(o.created_at.seconds * 1000).toISOString();
          }
          if (o.updated_at && typeof o.updated_at === 'object' && o.updated_at.seconds) {
            o.updated_at = new Date(o.updated_at.seconds * 1000).toISOString();
          }
        }

        // ── Server-side aggregation ──
        const now = new Date();
        const todayCutoff = new Date(now); todayCutoff.setHours(0, 0, 0, 0);
        const d7Cutoff = new Date(now); d7Cutoff.setDate(now.getDate() - 7);
        const d30Cutoff = new Date(now); d30Cutoff.setDate(now.getDate() - 30);

        const filterByDate = (items: any[], cutoff: Date) =>
          items.filter((i: any) => { const d = new Date(i.created_at); return !isNaN(d.getTime()) && d >= cutoff; });

        const computePeriod = (periodOrders: any[]) => {
          const paid = periodOrders.filter((o: any) => o.payment_status === 'paid');
          const revenue = paid.reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0);
          return {
            orders: periodOrders.length,
            paidCount: paid.length,
            revenue,
            avgTicket: paid.length > 0 ? revenue / paid.length : 0,
            failed: periodOrders.filter((o: any) => o.payment_status === 'failed').length,
          };
        };

        const periods = {
          today: computePeriod(filterByDate(orders, todayCutoff)),
          '7d': computePeriod(filterByDate(orders, d7Cutoff)),
          '30d': computePeriod(filterByDate(orders, d30Cutoff)),
        };

        // All-time paid orders for top products
        const allPaid = orders.filter((o: any) => o.payment_status === 'paid');
        const paidIds = new Set(allPaid.map((o: any) => o.id));

        const productSales: Record<string, { quantity: number; revenue: number }> = {};
        for (const item of orderItems) {
          if (!paidIds.has(item.order_id)) continue;
          const name = item.product_name || 'Desconhecido';
          if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
          productSales[name].quantity += Number(item.quantity) || 0;
          productSales[name].revenue += Number(item.total_price) || 0;
        }
        const topProducts = Object.entries(productSales)
          .sort((a, b) => b[1].quantity - a[1].quantity)
          .slice(0, 5);

        // Revenue by day (last 7)
        const last7Days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return d.toISOString().split('T')[0];
        });
        const revenueByDay = last7Days.map(date => {
          const dayPaid = orders.filter((o: any) => o.created_at?.startsWith(date) && o.payment_status === 'paid');
          const rev = dayPaid.reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0);
          const dn = new Date(date).toLocaleDateString('pt-BR', { weekday: 'short' });
          return { name: dn.charAt(0).toUpperCase() + dn.slice(1, 3), receita: rev, pedidos: dayPaid.length };
        });

        // Payment distribution
        const paymentDistribution = [
          { name: 'Pago', value: allPaid.length, color: '#10b981' },
          { name: 'Pendente', value: orders.filter((o: any) => o.payment_status === 'pending').length, color: '#f59e0b' },
          { name: 'Falhou', value: orders.filter((o: any) => o.payment_status === 'failed').length, color: '#ef4444' },
        ].filter(i => i.value > 0);

        // Alerts
        const alerts: { type: string; title: string; description: string }[] = [];
        const stuckProcessing = orders.filter((o: any) => {
          if (o.payment_status !== 'processing_balance') return false;
          const ref = o.updated_at || o.created_at;
          if (!ref) return true;
          return Date.now() - new Date(ref).getTime() > 5 * 60 * 1000;
        });
        if (stuckProcessing.length > 0) alerts.push({ type: 'error', title: `${stuckProcessing.length} pedido(s) travado(s) em processing_balance`, description: 'Possível falha no checkout-balance. Verificar manualmente.' });
        const needsRefund = orders.filter((o: any) => o.payment_status === 'error_needs_refund');
        if (needsRefund.length > 0) alerts.push({ type: 'error', title: `${needsRefund.length} pedido(s) com erro de reembolso`, description: 'Reembolso automático falhou. Ação manual necessária.' });
        const lowStock = products.filter((p: any) => p.delivery_type === 'auto_real' && p.is_active !== false && (p.auto_delivery_codes?.length || 0) < 3);
        if (lowStock.length > 0) alerts.push({ type: 'warning', title: `${lowStock.length} produto(s) com estoque baixo`, description: `Produtos auto_real com < 3 códigos: ${lowStock.map((p: any) => p.name).join(', ')}` });

        // Recent orders (last 8 paid)
        const recentOrders = [...allPaid]
          .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 8)
          .map((o: any) => ({ id: o.id, customer_name: o.customer_name || '', total_amount: Number(o.total_amount) || 0, created_at: o.created_at }));

        // Pending delivery count
        const pendingDelivery = orders.filter((o: any) => o.payment_status === 'paid' && o.status !== 'completed' && o.status !== 'cancelled').length;

        return new Response(JSON.stringify({
          periods, topProducts, revenueByDay, paymentDistribution,
          alerts, recentOrders, pendingDelivery,
          totalProducts: products.filter((p: any) => p.is_active !== false).length,
          totalUsers: profiles.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── POST: Create ─────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      // Input sanitization: strip __proto__ and constructor fields to prevent prototype pollution
      const sanitize = (obj: Record<string, unknown>) => {
        const dangerous = ['__proto__', 'constructor', 'prototype'];
        for (const key of Object.keys(obj)) {
          if (dangerous.includes(key)) delete obj[key];
        }
        return obj;
      };

      if (resource === "products") {
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'auto_delivery_codes', 'created_at', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const docId = body.id || crypto.randomUUID();
        delete body.id;
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(sanitize(body))) {
          if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await createFirestoreDoc("products", docId, safeBody);
        return new Response(JSON.stringify({ success, id: docId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "categories") {
        const CATEGORY_ALLOWED_FIELDS = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'created_at', 'updated_at'];
        const docId = body.id || crypto.randomUUID();
        delete body.id;
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(sanitize(body))) {
          if (CATEGORY_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        const success = await createFirestoreDoc("categories", docId, safeBody);
        return new Response(JSON.stringify({ success, id: docId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (resource === "coupons") {
        const COUPON_ALLOWED_FIELDS = ['code', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'expires_at', 'created_at', 'updated_at'];
        const docId = body.id || crypto.randomUUID();
        delete body.id;
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(sanitize(body))) {
          if (COUPON_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        const success = await createFirestoreDoc("coupons", docId, safeBody);
        return new Response(JSON.stringify({ success, id: docId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Cleanup: remove blocked emails + orphan profiles ──────
      if (resource === "cleanup-users") {
        const BLOCKED_EMAILS = [
          "lucaseucontato@gmail.com",
          "rodrigofaro@gmail.com",
          "test_redteam@gmail.com",
        ];

        const accessToken = await getFirebaseAccessToken();
        const FIREBASE_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || '';

        // Get all profiles and users from Firestore
        const [profiles, users] = await Promise.all([
          queryCollection("profiles"),
          queryCollection("users"),
        ]);

        const allDocIds = new Set<string>();
        for (const p of profiles) allDocIds.add(p.id);
        for (const u of users) allDocIds.add(u.id);

        const removed: string[] = [];
        const errors: string[] = [];

        for (const docId of allDocIds) {
          // Get email from profile or user doc
          const profile = profiles.find((p: any) => p.id === docId);
          const userDoc = users.find((u: any) => u.id === docId);
          const email = (profile?.email || userDoc?.email || '').toLowerCase().trim();

          // 1. Remove blocked emails
          if (BLOCKED_EMAILS.includes(email)) {
            try {
              await Promise.allSettled([
                deleteFirestoreDoc("profiles", docId),
                deleteFirestoreDoc("users", docId),
                deleteFirestoreDoc("user_roles", docId),
              ]);
              removed.push(`blocked:${email}`);
              console.log(`🗑️ Removed blocked user: ${email} (${docId})`);
            } catch (err) {
              errors.push(`Failed to remove blocked ${email}: ${err}`);
            }
            continue;
          }

          // 2. Check if user exists in Firebase Auth
          try {
            const authRes = await fetch(
              `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
                body: JSON.stringify({ localId: [docId] }),
              }
            );
            const authData = await authRes.json();
            const authUser = authData.users?.[0];

            if (!authUser) {
              // Orphan — no matching Firebase Auth user
              await Promise.allSettled([
                deleteFirestoreDoc("profiles", docId),
                deleteFirestoreDoc("users", docId),
                deleteFirestoreDoc("user_roles", docId),
              ]);
              removed.push(`orphan:${email || docId}`);
              console.log(`🗑️ Removed orphan profile: ${email || docId} (${docId})`);
            }
          } catch (err) {
            errors.push(`Auth check failed for ${docId}: ${err}`);
          }
        }

        return new Response(JSON.stringify({ 
          success: true, 
          removed, 
          removedCount: removed.length,
          totalChecked: allDocIds.size,
          errors: errors.length > 0 ? errors : undefined,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Cleanup orders by email ──────────────────────────────────
      if (resource === "cleanup-orders") {
        const email = (body.email || '').trim().toLowerCase();
        if (!email) {
          return new Response(JSON.stringify({ error: "email required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Find all orders matching the email
        const orders = await queryCollectionFiltered("orders", "customer_email", "EQUAL", { stringValue: email });
        if (orders.length === 0) {
          return new Response(JSON.stringify({ success: true, deletedOrders: 0, deletedItems: 0, message: "Nenhum pedido encontrado para este email." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        let deletedItems = 0;
        const errors: string[] = [];

        for (const order of orders) {
          try {
            // Delete order_items for this order
            const items = await queryCollectionFiltered("order_items", "order_id", "EQUAL", { stringValue: order.id });
            for (const item of items) {
              await deleteFirestoreDoc("order_items", item.id);
              deletedItems++;
            }
            // Delete the order itself
            await deleteFirestoreDoc("orders", order.id);
          } catch (err: any) {
            errors.push(`order ${order.id}: ${err.message || err}`);
          }
        }

        // Also clean guest_orders matching this email
        let deletedGuest = 0;
        try {
          const guestOrders = await queryCollectionFiltered("guest_orders", "customer_email", "EQUAL", { stringValue: email });
          for (const g of guestOrders) {
            await deleteFirestoreDoc("guest_orders", g.id);
            deletedGuest++;
          }
        } catch { /* guest_orders may not exist */ }

        // Also clean sale_addons
        let deletedAddons = 0;
        try {
          const addons = await queryCollectionFiltered("sale_addons", "customer_email", "EQUAL", { stringValue: email });
          for (const a of addons) {
            await deleteFirestoreDoc("sale_addons", a.id);
            deletedAddons++;
          }
        } catch { /* sale_addons may not exist */ }

        console.log(`🧹 Cleanup orders for ${email}: ${orders.length} orders, ${deletedItems} items, ${deletedGuest} guest_orders, ${deletedAddons} sale_addons`);

        return new Response(JSON.stringify({
          success: true,
          deletedOrders: orders.length,
          deletedItems,
          deletedGuest,
          deletedAddons,
          errors: errors.length > 0 ? errors : undefined,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── PUT: Update ──────────────────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();
      const docId = body.id;
      if (!docId) return new Response(JSON.stringify({ error: "id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      delete body.id;

      // 🔒 P1 FIX: Apply sanitize() to all PUT requests (prevent prototype pollution)
      const sanitizePut = (obj: Record<string, unknown>) => {
        const dangerous = ['__proto__', 'constructor', 'prototype'];
        for (const key of Object.keys(obj)) {
          if (dangerous.includes(key)) delete obj[key];
        }
        return obj;
      };
      sanitizePut(body);

      if (resource === "products") {
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'auto_delivery_codes', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("products", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "users") {
        const USER_ALLOWED_FIELDS = ['full_name', 'nickname', 'phone', 'avatar_url', 'balance', 'updated_at'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (USER_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();

        // 🔒 P1 FIX: Audit log for balance changes
        if (body.balance !== undefined) {
          try {
            // Read current balance before update
            const accessToken = await getFirebaseAccessToken();
            const profileUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles/${docId}`;
            const profileRes = await fetch(profileUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            const profileData = profileRes.ok ? await profileRes.json() : null;
            const previousBalance = profileData?.fields?.balance?.doubleValue ?? profileData?.fields?.balance?.integerValue ?? 0;

            // Write audit log
            const auditId = crypto.randomUUID();
            const auditUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/admin_audit_logs/${auditId}`;
            await fetch(auditUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
              body: JSON.stringify({
                fields: {
                  action: { stringValue: 'balance_update' },
                  target_user_id: { stringValue: docId },
                  admin_uid: { stringValue: userData.uid },
                  admin_email: { stringValue: userData.email },
                  previous_balance: { doubleValue: Number(previousBalance) },
                  new_balance: { doubleValue: Number(body.balance) },
                  ip: { stringValue: clientIp },
                  created_at: { stringValue: new Date().toISOString() },
                },
              }),
            });
            console.log(`📝 AUDIT: Balance update by ${userData.email} for user ${docId}: ${previousBalance} → ${body.balance}`);
          } catch (auditErr) {
            console.error('⚠️ Audit log failed (non-blocking):', auditErr);
          }
        }

        const success = await updateFirestoreDoc("profiles", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "orders") {
        // WHITELIST: only allow safe fields — financial/payment fields are immutable
        const ORDERS_EDITABLE_FIELDS = ['status', 'customer_name', 'customer_email', 'customer_phone', 'notes', 'admin_notes', 'tracking_code'];
        const ORDERS_IMMUTABLE_FIELDS = ['payment_status', 'payment_method', 'total_amount', 'subtotal', 'discount_amount', 'flowpay_charge_id', 'coupon_id', 'user_id', 'created_at'];
        const rejected = Object.keys(body).filter(k => ORDERS_IMMUTABLE_FIELDS.includes(k));
        if (rejected.length > 0) {
          return new Response(JSON.stringify({ error: `Cannot modify immutable fields: ${rejected.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (ORDERS_EDITABLE_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("orders", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "order-items") {
        const ORDER_ITEMS_ALLOWED_FIELDS = ['delivery_code', 'delivered_at', 'admin_notes'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (ORDER_ITEMS_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        const success = await updateFirestoreDoc("order_items", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "categories") {
        const CATEGORY_ALLOWED_FIELDS = ['name', 'slug', 'description', 'icon', 'icon_url', 'image_url', 'display_order', 'is_active', 'show_on_homepage', 'parent_id', 'updated_at'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (CATEGORY_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("categories", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "coupons") {
        const COUPON_ALLOWED_FIELDS = ['code', 'discount_type', 'discount_value', 'is_active', 'max_uses', 'current_uses', 'min_order_value', 'expires_at', 'updated_at'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (COUPON_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("coupons", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Admin verify-payment: force payment_status with audit log ──
      if (resource === "verify-payment") {
        const newPaymentStatus = body.payment_status;
        const newStatus = body.status;
        if (!newPaymentStatus) {
          return new Response(JSON.stringify({ error: "payment_status required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const ALLOWED_PAYMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded'];
        if (!ALLOWED_PAYMENT_STATUSES.includes(newPaymentStatus)) {
          return new Response(JSON.stringify({ error: `Invalid payment_status. Allowed: ${ALLOWED_PAYMENT_STATUSES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Read current order for audit
        try {
          const accessToken = await getFirebaseAccessToken();
          const orderUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${docId}`;
          const orderRes = await fetch(orderUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
          const orderData = orderRes.ok ? await orderRes.json() : null;
          const prevPaymentStatus = orderData?.fields?.payment_status?.stringValue ?? 'unknown';
          const prevStatus = orderData?.fields?.status?.stringValue ?? 'unknown';

          // Write audit log
          const auditId = crypto.randomUUID();
          const auditUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/admin_audit_logs/${auditId}`;
          await fetch(auditUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({
              fields: {
                action: { stringValue: 'verify_payment' },
                order_id: { stringValue: docId },
                admin_uid: { stringValue: userData.uid },
                admin_email: { stringValue: userData.email },
                previous_payment_status: { stringValue: prevPaymentStatus },
                new_payment_status: { stringValue: newPaymentStatus },
                previous_status: { stringValue: prevStatus },
                new_status: { stringValue: newStatus || prevStatus },
                ip: { stringValue: clientIp },
                created_at: { stringValue: new Date().toISOString() },
              },
            }),
          });
          console.log(`📝 AUDIT: Verify payment by ${userData.email} for order ${docId}: ${prevPaymentStatus} → ${newPaymentStatus}`);
        } catch (auditErr) {
          console.error('⚠️ Audit log failed (non-blocking):', auditErr);
        }

        const updateData: Record<string, unknown> = {
          payment_status: newPaymentStatus,
          updated_at: new Date().toISOString(),
        };
        if (newStatus) updateData.status = newStatus;

        const success = await updateFirestoreDoc("orders", docId, updateData);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── DELETE ────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const docId = url.searchParams.get("id");
      if (!docId) return new Response(JSON.stringify({ error: "id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      if (resource === "products") {
        const success = await deleteFirestoreDoc("products", docId);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "users") {
        await Promise.all([
          deleteFirestoreDoc("profiles", docId),
          deleteFirestoreDoc("users", docId),
          deleteFirestoreDoc("user_roles", docId),
        ]);
        return new Response(JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "orders") {
        // Delete order and its items
        const items = await queryCollectionFiltered("order_items", "order_id", "EQUAL", { stringValue: docId });
        for (const item of items) {
          await deleteFirestoreDoc("order_items", item.id);
        }
        await deleteFirestoreDoc("orders", docId);
        return new Response(JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "categories") {
        const success = await deleteFirestoreDoc("categories", docId);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "coupons") {
        const success = await deleteFirestoreDoc("coupons", docId);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("❌ admin-data error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
