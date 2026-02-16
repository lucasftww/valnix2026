import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * cleanup-orders — Cancel stale pending orders (30+ min without payment)
 * Designed to be called by cron or admin.
 */

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
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const FIREBASE_PROJECT_ID = 'valnix';
const STALE_MINUTES = 30;

// ── Firebase Service Account Auth ──
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

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function runQuery(token: string, structuredQuery: Record<string, unknown>): Promise<any[]> {
  const resp = await fetch(`${BASE}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  const results = await resp.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document);
}

async function patchDoc(token: string, docPath: string, fields: Record<string, unknown>, updateMask: string[]): Promise<void> {
  const mask = updateMask.map(f => `updateMask.fieldPaths=${f}`).join('&');
  await fetch(`https://firestore.googleapis.com/v1/${docPath}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getFirebaseAccessToken();
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    // Query orders: status=pending AND payment_status=pending AND created_at < cutoff
    // Note: composite query requires index; fallback to client-side filtering if needed
    let results: any[] = [];
    try {
      results = await runQuery(token, {
        from: [{ collectionId: 'orders' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
              { fieldFilter: { field: { fieldPath: 'payment_status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
            ],
          },
        },
        limit: 200,
      });
    } catch {
      // Fallback: query only by status, filter client-side
      results = await runQuery(token, {
        from: [{ collectionId: 'orders' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
        limit: 500,
      });
    }

    let cancelled = 0;
    const now = new Date().toISOString();

    for (const r of results) {
      const fields = r.document.fields;
      // Client-side filter: ensure payment_status is pending
      if (fields?.payment_status?.stringValue !== 'pending') continue;

      // Client-side filter: check created_at < cutoff
      const createdAt = fields?.created_at?.stringValue || fields?.created_at?.timestampValue;
      if (!createdAt) continue;
      const createdDate = new Date(createdAt);
      if (isNaN(createdDate.getTime()) || createdDate >= cutoff) continue;

      const docPath = r.document.name;
      await patchDoc(token, docPath, {
        status: { stringValue: 'cancelled' },
        payment_status: { stringValue: 'expired' },
        updated_at: { stringValue: now },
        notes: { stringValue: 'Cancelado automaticamente — pagamento não recebido em 30 min.' },
      }, ['status', 'payment_status', 'updated_at', 'notes']);
      cancelled++;
    }

    console.log(`[cleanup-orders] Cancelled ${cancelled} stale orders`);

    return new Response(JSON.stringify({ success: true, cancelled }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[cleanup-orders] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
