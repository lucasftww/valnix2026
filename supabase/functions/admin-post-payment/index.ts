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
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

// ── Admin check via Firestore user_roles ───────────────────────────
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
async function queryFirestoreCollection(col: string, filters?: { field: string; op: string; value: any }[]) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const structuredQuery: any = {
    from: [{ collectionId: col }],
    limit: 10000,
  };

  if (filters && filters.length > 0) {
    if (filters.length === 1) {
      const f = filters[0];
      structuredQuery.where = {
        fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value },
      };
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: filters.map(f => ({
            fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value },
          })),
        },
      };
    }
  }

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) {
    console.error('❌ Firestore query failed:', await res.text());
    return [];
  }

  const results = await res.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document);
}

function extractFirestoreValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(extractFirestoreValue);
  if ('mapValue' in val) {
    const obj: any = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = extractFirestoreValue(v);
    return obj;
  }
  return null;
}

function docToObj(doc: any): Record<string, any> {
  const fields = doc.document?.fields || {};
  const obj: Record<string, any> = { id: doc.document.name.split('/').pop() };
  for (const [k, v] of Object.entries(fields)) obj[k] = extractFirestoreValue(v);
  return obj;
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    // Allow public GET for page configs (not sensitive data)
    const url = new URL(req.url);
    const isPublicPageRequest = req.method === "GET" && !url.searchParams.get("orderId");
    
    if (isPublicPageRequest) {
      // Return only page configs (no addons/stats) without auth
      const pageResults = await queryFirestoreCollection('post_payment_pages');
      const pages = pageResults.map(docToObj).sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
      return new Response(JSON.stringify({ pages }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // Check admin via Firestore user_roles collection (not hardcoded emails)
    const adminStatus = await isAdminInFirestore(userData.uid);
    if (!adminStatus) {
      console.warn(`⚠️ Unauthorized admin attempt: ${userData.email} (${userData.uid})`);
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const orderId = url.searchParams.get("orderId");

      if (orderId) {
        const addonResults = await queryFirestoreCollection('sale_addons', [
          { field: 'order_id', op: 'EQUAL', value: { stringValue: orderId } },
        ]);
        const addons = addonResults.map(docToObj);
        return new Response(JSON.stringify({ addons }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const pageResults = await queryFirestoreCollection('post_payment_pages');
      const pages = pageResults.map(docToObj).sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));

      const addonResults = await queryFirestoreCollection('sale_addons');
      const addons = addonResults.map((r: any) => {
        const f = r.document?.fields || {};
        return {
          addon_type: f?.addon_type?.stringValue || '',
          status: f?.status?.stringValue || '',
          amount: f?.amount?.doubleValue ?? f?.amount?.integerValue ?? 0,
        };
      });

      return new Response(JSON.stringify({ pages, addons }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: "Page ID required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const success = await updateFirestoreDoc('post_payment_pages', id, {
        ...updates,
        updated_at: new Date().toISOString(),
      });

      if (!success) {
        return new Response(JSON.stringify({ error: "Update failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      const body = await req.json();
      
      if (body.action === "seed") {
        // Seed default post-payment pages if they don't exist
        const existing = await queryFirestoreCollection('post_payment_pages');
        if (existing.length > 0) {
          return new Response(JSON.stringify({ message: "Pages already exist", count: existing.length }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const defaults = [
          {
            addon_type: "delivery_priority",
            title: "Entrega Prioritária",
            subtitle: "Receba seu pedido com prioridade máxima",
            badge_text: "MAIS VENDIDO",
            badge_color: "yellow",
            benefits: ["Entrega em até 5 minutos", "Suporte prioritário 24h", "Garantia de entrega", "Atendimento VIP no Discord"],
            price: 4.99,
            original_price: 14.99,
            button_accept_text: "SIM! EU QUERO!",
            button_skip_text: "Não, obrigado",
            next_route: "/protecao-total",
            is_active: true,
            display_order: 1,
          },
          {
            addon_type: "data_swap_warranty",
            title: "Proteção Total",
            subtitle: "Garantia de troca de dados caso necessário",
            badge_text: "RECOMENDADO",
            badge_color: "green",
            benefits: ["Troca de dados garantida", "Suporte dedicado para troca", "Validade de 30 dias", "Processo rápido e seguro"],
            price: 7.99,
            original_price: 19.99,
            button_accept_text: "QUERO PROTEÇÃO!",
            button_skip_text: "Não, obrigado",
            next_route: "/order",
            is_active: true,
            display_order: 2,
          },
        ];

        for (const page of defaults) {
          const docId = page.addon_type;
          await createFirestoreDoc('post_payment_pages', docId, {
            ...page,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }

        return new Response(JSON.stringify({ success: true, created: defaults.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
  }
});
