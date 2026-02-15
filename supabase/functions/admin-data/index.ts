import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
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
    scope: 'https://www.googleapis.com/auth/datastore',
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
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw`,
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

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      console.warn(`⚠️ Unauthorized admin-data attempt: ${userData.email}`);
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");

    // ── GET: Fetch data ──────────────────────────────────────────
    if (req.method === "GET") {
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

      return new Response(JSON.stringify({ error: "Invalid resource" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── POST: Create ─────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      if (resource === "products") {
        const docId = body.id || crypto.randomUUID();
        delete body.id;
        const success = await createFirestoreDoc("products", docId, body);
        return new Response(JSON.stringify({ success, id: docId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      if (resource === "products") {
        const success = await updateFirestoreDoc("products", docId, body);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (resource === "users") {
        // Update user balance or other profile fields
        const success = await updateFirestoreDoc("profiles", docId, body);
        return new Response(JSON.stringify({ success }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        // Delete profile and user_roles
        await Promise.all([
          deleteFirestoreDoc("profiles", docId),
          deleteFirestoreDoc("user_roles", docId),
        ]);
        return new Response(JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Invalid resource" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("❌ admin-data error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
