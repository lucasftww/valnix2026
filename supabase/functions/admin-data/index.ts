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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
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

// ── HMAC Admin Token Verification ──────────────────────────────────
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampHex, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;

  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) return false;
  if (timestamp > now + 60_000) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(adminPassword),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampHex}:admin`));
  const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  if (providedHmac.length !== expectedHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < providedHmac.length; i++) {
    diff |= providedHmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i);
  }
  return diff === 0;
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

function parseFirestoreResults(results: any[]): any[] {
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document).map((r: any) => {
    const fields = r.document.fields || {};
    const obj: any = { id: r.document.name.split('/').pop() };
    for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
    return obj;
  });
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
  return parseFirestoreResults(await res.json());
}

// Paginated collection query — fetches all docs in batches to avoid timeouts
async function queryCollectionPaginated(col: string, batchSize = 500): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const allDocs: any[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) { // Safety: max 40 pages = 20k docs
    const structuredQuery: any = {
      from: [{ collectionId: col }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: batchSize,
    };
    if (lastDocName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: lastDocName }],
        before: false, // exclusive (startAfter)
      };
    }

    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery }),
    });
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
    if (docs.length < batchSize) break; // Last page
  }

  return allDocs;
}

// Query orders filtered by created_at >= cutoffISO (uses Firestore WHERE)
async function queryOrdersSince(cutoffISO: string): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const allDocs: any[] = [];
  let lastDocName: string | null = null;

  for (let page = 0; page < 40; page++) {
    const structuredQuery: any = {
      from: [{ collectionId: 'ordens' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'created_at' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { stringValue: cutoffISO },
        },
      },
      orderBy: [
        { field: { fieldPath: 'created_at' }, direction: 'DESCENDING' },
        { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
      ],
      limit: 500,
    };
    if (lastDocName) {
      // For startAfter with composite orderBy, we need the last doc's created_at + name
      const lastDoc = allDocs[allDocs.length - 1];
      structuredQuery.startAt = {
        values: [
          { stringValue: lastDoc?.created_at || '' },
          { referenceValue: lastDocName },
        ],
        before: false,
      };
    }

    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) {
      // Fallback: if index doesn't exist, use unpaginated query with simple filter
      console.warn(`⚠️ Paginated order query failed (page ${page}), falling back to simple query`);
      if (page === 0) {
        return queryCollectionFiltered('ordens', 'created_at', 'GREATER_THAN_OR_EQUAL', { stringValue: cutoffISO });
      }
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

async function getFirestoreDoc(col: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${docId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return await res.json();
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
    // Auth check — HMAC admin token
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) {
      return new Response(JSON.stringify({ error: "Admin token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) {
      console.warn(`🚨 BLOCKED admin-data attempt | ip=${clientIp} | resource=${new URL(req.url).searchParams.get("resource")} | method=${req.method} | time=${new Date().toISOString()}`);
      return new Response(JSON.stringify({ error: "Invalid or expired admin token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      // "users" and "user-orders" endpoints removed — legacy profiles/users collections no longer used

      if (resource === "products") {
        const [products, allCodes] = await Promise.all([
          queryCollection("products"),
          queryCollection("product_codes"),
        ]);

        // 🔒 Merge codes from secure collection for admin view only
        const codesMap = new Map<string, string[]>();
        for (const c of allCodes) {
          codesMap.set(c.id, c.codes || []);
        }
        for (const p of products) {
          p.auto_delivery_codes = codesMap.get(p.id) || p.auto_delivery_codes || [];
        }

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
        const orders = await queryCollection("ordens");
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

        // Read items from subcollection ordens/{orderId}/items
        const accessToken = await getFirebaseAccessToken();
        const itemsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${orderId}/items?pageSize=100`;
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
        // 🔒 OPTIMIZED: Only fetch orders from last 30 days + use paginated queries
        const now = new Date();
        const todayCutoff = new Date(now); todayCutoff.setHours(0, 0, 0, 0);
        const d7Cutoff = new Date(now); d7Cutoff.setDate(now.getDate() - 7);
        const d30Cutoff = new Date(now); d30Cutoff.setDate(now.getDate() - 30);

        // Fetch only what we need: orders from last 30d, products, product_codes
        const [orders, products, productCodes] = await Promise.all([
          queryOrdersSince(d30Cutoff.toISOString()),
          queryCollection("products"),
          queryCollection("product_codes"),
        ]);

        console.log(`📊 dashboard-stats: ${orders.length} orders (last 30d), ${products.length} products`);

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
          '30d': computePeriod(orders), // All fetched orders are already within 30d
        };

        // Top products: fetch order_items only for paid orders (in batches)
        const allPaid = orders.filter((o: any) => o.payment_status === 'paid');
        const paidIds = new Set(allPaid.map((o: any) => o.id));

        // Fetch order items from subcollections of paid orders (in parallel batches)
        const accessTokenItems = await getFirebaseAccessToken();
        const itemBatches = await Promise.all(allPaid.map(async (order: any) => {
          try {
            const iUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${order.id}/items?pageSize=50`;
            const iRes = await fetch(iUrl, { headers: { 'Authorization': `Bearer ${accessTokenItems}` } });
            if (!iRes.ok) return [];
            const iData = await iRes.json();
            return (iData.documents || []).map((doc: any) => {
              const fields = doc.fields || {};
              const obj: any = { id: doc.name.split('/').pop(), order_id: order.id };
              for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
              return obj;
            });
          } catch { return []; }
        }));
        const orderItems = itemBatches.flat();

        const productSales: Record<string, { quantity: number; revenue: number }> = {};
        for (const item of orderItems) {
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

        // Payment distribution (within 30d window)
        const paymentDistribution = [
          { name: 'Pago', value: allPaid.length, color: '#10b981' },
          { name: 'Pendente', value: orders.filter((o: any) => o.payment_status === 'pending').length, color: '#f59e0b' },
          { name: 'Falhou', value: orders.filter((o: any) => o.payment_status === 'failed').length, color: '#ef4444' },
        ].filter(i => i.value > 0);

        // Alerts
        const alerts: { type: string; title: string; description: string }[] = [];
        const needsRefund = orders.filter((o: any) => o.payment_status === 'error_needs_refund');
        if (needsRefund.length > 0) alerts.push({ type: 'error', title: `${needsRefund.length} pedido(s) com erro de reembolso`, description: 'Reembolso automático falhou. Ação manual necessária.' });
        // Build product_codes map for stock check
        const codesMap = new Map<string, number>();
        for (const c of productCodes) codesMap.set(c.id, (c.codes || []).length);
        const lowStock = products.filter((p: any) => p.delivery_type === 'auto_real' && p.is_active !== false && (codesMap.get(p.id) || 0) < 3);
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
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'created_at', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const docId = body.id || crypto.randomUUID();
        delete body.id;
        const safeBody: Record<string, unknown> = {};
        const sanitized = sanitize(body);
        for (const key of Object.keys(sanitized)) {
          if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = sanitized[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await createFirestoreDoc("products", docId, safeBody);

        // 🔒 SECURITY: Store auto_delivery_codes in separate admin-only collection
        if (body.auto_delivery_codes && Array.isArray(body.auto_delivery_codes)) {
          await createFirestoreDoc("product_codes", docId, {
            codes: body.auto_delivery_codes,
            updated_at: new Date().toISOString(),
          });
        }

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

      // "cleanup-users" endpoint removed — legacy profiles/users/user_roles collections no longer used

      // ── Cleanup analytics events ──────────────────────────────────
      if (resource === "cleanup-analytics") {
        const { before_date, after_date, event_names, dry_run } = body;

        if (!before_date && !after_date) {
          return new Response(JSON.stringify({ error: "before_date or after_date required (ISO format)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Query analytics_events
        const accessToken = await getFirebaseAccessToken();
        const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
        
        // Build filters
        const filters: any[] = [];
        if (after_date) {
          filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: after_date } } });
        }
        if (before_date) {
          filters.push({ fieldFilter: { field: { fieldPath: 'event_time' }, op: 'LESS_THAN', value: { stringValue: before_date } } });
        }

        const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };

        const res = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'analytics_events' }], where, limit: 10000 } }),
        });

        if (!res.ok) {
          return new Response(JSON.stringify({ error: "Failed to query analytics events" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const results = await res.json();
        const docs = Array.isArray(results) ? results.filter((r: any) => r.document) : [];

        // Optionally filter by event names
        const validNames = event_names && Array.isArray(event_names) && event_names.length > 0 ? new Set(event_names) : null;
        const toDelete = docs.filter((r: any) => {
          if (!validNames) return true;
          const name = r.document.fields?.event_name?.stringValue;
          return validNames.has(name);
        });

        if (dry_run) {
          // Count by event_name
          const counts: Record<string, number> = {};
          for (const r of toDelete) {
            const name = r.document.fields?.event_name?.stringValue || 'unknown';
            counts[name] = (counts[name] || 0) + 1;
          }
          return new Response(JSON.stringify({ dry_run: true, total: toDelete.length, by_event: counts }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Delete in batches
        let deleted = 0;
        const errors: string[] = [];
        for (const r of toDelete) {
          const docPath = r.document.name;
          try {
            const delRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}`, {
              method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (delRes.ok || delRes.status === 404) deleted++;
            else errors.push(`Failed: ${docPath}`);
          } catch (err: any) {
            errors.push(`Error: ${docPath}: ${err.message}`);
          }
        }

        console.log(`🧹 Analytics cleanup by ${userData.email}: deleted ${deleted}/${toDelete.length} events (range: ${after_date || '*'} to ${before_date || '*'})`);

        // Audit log
        await createFirestoreDoc("admin_audit_logs", crypto.randomUUID(), {
          admin_uid: userData.uid,
          admin_email: userData.email,
          action: "cleanup_analytics",
          details: `Deleted ${deleted} analytics events (${after_date || '*'} to ${before_date || '*'})`,
          ip: clientIp,
          created_at: new Date().toISOString(),
        });

        return new Response(JSON.stringify({ success: true, deleted, total: toDelete.length, errors: errors.length > 0 ? errors.slice(0, 10) : undefined }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── Cleanup orders by email ──────────────────────────────────
      if (resource === "cleanup-orders") {
        const rawEmail = (body.email || '').trim();
        const email = rawEmail.toLowerCase();
        if (!email) {
          return new Response(JSON.stringify({ error: "email required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Firestore is case-sensitive — query both lowercase and original casing
        const ordersLower = await queryCollectionFiltered("ordens", "customer_email", "EQUAL", { stringValue: email });
        const ordersOriginal = rawEmail !== email
          ? await queryCollectionFiltered("ordens", "customer_email", "EQUAL", { stringValue: rawEmail })
          : [];
        const ordersUpper = await queryCollectionFiltered("ordens", "customer_email", "EQUAL", { stringValue: email.toUpperCase() });
        const seenIds = new Set<string>();
        const orders: typeof ordersLower = [];
        for (const o of [...ordersLower, ...ordersOriginal, ...ordersUpper]) {
          if (!seenIds.has(o.id)) { seenIds.add(o.id); orders.push(o); }
        }
        if (orders.length === 0) {
          return new Response(JSON.stringify({ success: true, deletedOrders: 0, deletedItems: 0, message: "Nenhum pedido encontrado para este email." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        let deletedItems = 0;
        const errors: string[] = [];

        for (const order of orders) {
          try {
            // Delete subcollection items first
            const accessToken = await getFirebaseAccessToken();
            const itemsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${order.id}/items`;
            const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            if (itemsRes.ok) {
              const itemsData = await itemsRes.json();
              for (const item of (itemsData.documents || [])) {
                const itemId = item.name.split('/').pop()!;
                await deleteFirestoreDoc(`ordens/${order.id}/items`, itemId);
                deletedItems++;
              }
            }
            // Delete the order itself
            await deleteFirestoreDoc("ordens", order.id);
          } catch (err: any) {
            errors.push(`order ${order.id}: ${err.message || err}`);
          }
        }

        // Also clean ordens matching this email via "email" field (including subcollection items)
        let deletedGuest = 0;
        try {
          const guestLower = await queryCollectionFiltered("ordens", "email", "EQUAL", { stringValue: email });
          const guestUpper = email !== email.toUpperCase() ? await queryCollectionFiltered("ordens", "email", "EQUAL", { stringValue: email.toUpperCase() }) : [];
          const guestOriginal = rawEmail !== email ? await queryCollectionFiltered("ordens", "email", "EQUAL", { stringValue: rawEmail }) : [];
          const guestSeen = new Set<string>();
          const guestOrders = [...guestLower, ...guestUpper, ...guestOriginal].filter(g => { if (guestSeen.has(g.id)) return false; guestSeen.add(g.id); return true; });
          for (const g of guestOrders) {
            // Delete subcollection items first
            try {
              const accessToken = await getFirebaseAccessToken();
              const itemsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${g.id}/items`;
              const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
              if (itemsRes.ok) {
                const itemsData = await itemsRes.json();
                for (const item of (itemsData.documents || [])) {
                  const itemId = item.name.split('/').pop()!;
                  await deleteFirestoreDoc(`ordens/${g.id}/items`, itemId);
                }
              }
            } catch { /* subcollection may not exist */ }
            await deleteFirestoreDoc("ordens", g.id);
            deletedGuest++;
          }
        } catch { /* ordens may not exist */ }

        // Also clean sale_addons
        let deletedAddons = 0;
        try {
          const addonsLower = await queryCollectionFiltered("sale_addons", "customer_email", "EQUAL", { stringValue: email });
          const addonsUpper = email !== email.toUpperCase() ? await queryCollectionFiltered("sale_addons", "customer_email", "EQUAL", { stringValue: email.toUpperCase() }) : [];
          const addonsOriginal = rawEmail !== email ? await queryCollectionFiltered("sale_addons", "customer_email", "EQUAL", { stringValue: rawEmail }) : [];
          const addonsSeen = new Set<string>();
          const addons = [...addonsLower, ...addonsUpper, ...addonsOriginal].filter(a => { if (addonsSeen.has(a.id)) return false; addonsSeen.add(a.id); return true; });
          for (const a of addons) {
            await deleteFirestoreDoc("sale_addons", a.id);
            deletedAddons++;
          }
        } catch { /* sale_addons may not exist */ }

        console.log(`🧹 Cleanup orders for ${email}: ${orders.length} orders, ${deletedItems} items, ${deletedGuest} ordens, ${deletedAddons} sale_addons`);

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
        const PRODUCT_ALLOWED_FIELDS = ['name', 'slug', 'description', 'rich_description', 'price', 'old_price', 'original_price', 'discount', 'image_url', 'icon_url', 'images', 'category', 'category_id', 'is_active', 'featured', 'is_featured_in_category', 'stock', 'sold', 'delivery_type', 'delivery_info', 'instructions', 'terms_conditions', 'video_url', 'product_type', 'updated_at', 'display_order', 'review_count', 'review_average', 'features', 'badge', 'badge_color'];
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (PRODUCT_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        safeBody['updated_at'] = new Date().toISOString();
        const success = await updateFirestoreDoc("products", docId, safeBody);

        // 🔒 SECURITY: Store auto_delivery_codes in separate admin-only collection
        if (body.auto_delivery_codes !== undefined) {
          const codes = Array.isArray(body.auto_delivery_codes) ? body.auto_delivery_codes : [];
          await createFirestoreDoc("product_codes", docId, {
            codes,
            updated_at: new Date().toISOString(),
          });
        }

        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // "users" PUT endpoint removed — legacy profiles/balance no longer used

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
        const success = await updateFirestoreDoc("ordens", docId, safeBody);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "order-items") {
        const ORDER_ITEMS_ALLOWED_FIELDS = ['delivery_code', 'delivered_at', 'admin_notes'];
        const orderId = body.orderId; // Required: parent order ID for subcollection path
        if (!orderId) {
          return new Response(JSON.stringify({ error: "orderId required for order-items update" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const safeBody: Record<string, unknown> = {};
        for (const key of Object.keys(body)) {
          if (ORDER_ITEMS_ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
        }
        if (safeBody.delivery_code && !safeBody.delivered_at) {
          safeBody.delivered_at = new Date().toISOString();
        }
        const success = await updateFirestoreDoc(`ordens/${orderId}/items`, docId, safeBody);

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
          const orderUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${docId}`;
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
          console.log(`📝 AUDIT: Verify payment by hmac_admin for order ${docId}: ${prevPaymentStatus} → ${newPaymentStatus}`);
        } catch (auditErr) {
          console.error('⚠️ Audit log failed (non-blocking):', auditErr);
        }

        const updateData: Record<string, unknown> = {
          payment_status: newPaymentStatus,
          updated_at: new Date().toISOString(),
        };
        if (newStatus) updateData.status = newStatus;

        const success = await updateFirestoreDoc("ordens", docId, updateData);
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
        // Delete product and its secure codes
        await Promise.all([
          deleteFirestoreDoc("products", docId),
          deleteFirestoreDoc("product_codes", docId).catch(() => {}),
        ]);
        return new Response(JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // "users" DELETE endpoint removed — legacy profiles/users/user_roles/Firebase Auth no longer used

      if (resource === "orders") {
        // Delete order subcollection items first, then the order
        const accessToken = await getFirebaseAccessToken();
        const itemsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ordens/${docId}/items`;
        const itemsRes = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (itemsRes.ok) {
          const itemsData = await itemsRes.json();
          for (const item of (itemsData.documents || [])) {
            const itemId = item.name.split('/').pop()!;
            await deleteFirestoreDoc(`ordens/${docId}/items`, itemId);
          }
        }
        await deleteFirestoreDoc("ordens", docId);
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
