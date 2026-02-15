import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FIREBASE_PROJECT_ID = "valnix";
const ALLOWED_ADMIN_EMAILS = ["valnix@gmail.com", "valnixbr@gmail.com"];

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
    const FIREBASE_WEB_API_KEY = 'AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw';
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${FIREBASE_WEB_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email || '' };
  } catch { return null; }
}

// ── Firestore query with date filter ───────────────────────────────
async function queryAnalyticsEvents(dateFilter: Date) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  // Query analytics_events with timestamp filter
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'analytics_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'event_time' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { stringValue: dateFilter.toISOString() },
          },
        },
        orderBy: [{ field: { fieldPath: 'event_time' }, direction: 'DESCENDING' }],
        limit: 10000,
      },
    }),
  });

  if (!res.ok) {
    console.error('❌ Firestore query failed:', await res.text());
    return [];
  }

  const results = await res.json();
  if (!Array.isArray(results)) return [];

  return results
    .filter((r: any) => r.document)
    .map((r: any) => {
      const f = r.document.fields;
      return {
        id: r.document.name.split('/').pop(),
        event_name: f?.event_name?.stringValue || '',
        event_time: f?.event_time?.stringValue || '',
        user_id: f?.user_id?.stringValue || null,
        page_url: f?.page_url?.stringValue || null,
        device_type: f?.device_type?.stringValue || null,
        browser: f?.browser?.stringValue || null,
        value: f?.value?.doubleValue ?? f?.value?.integerValue ?? null,
        currency: f?.currency?.stringValue || null,
        order_id: f?.order_id?.stringValue || null,
        content_name: f?.content_name?.stringValue || null,
        content_category: f?.content_category?.stringValue || null,
      };
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    if (!ALLOWED_ADMIN_EMAILS.includes(userData.email.toLowerCase())) {
      console.warn(`⚠️ Unauthorized admin attempt: ${userData.email}`);
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const dateRange = url.searchParams.get("dateRange") || "7d";

    let dateFilter = new Date();
    if (dateRange === "today") dateFilter.setHours(0, 0, 0, 0);
    else if (dateRange === "7d") dateFilter.setDate(dateFilter.getDate() - 7);
    else if (dateRange === "30d") dateFilter.setDate(dateFilter.getDate() - 30);
    else dateFilter = new Date(0);

    const events = await queryAnalyticsEvents(dateFilter);

    return new Response(JSON.stringify({ events }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
