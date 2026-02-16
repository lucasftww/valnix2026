import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIREBASE_PROJECT_ID = 'valnix-bc5e3';
const STALE_MINUTES = 30;

async function getServiceAccountToken(): Promise<string> {
  const keyJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!keyJson) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  const sa = JSON.parse(keyJson);

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
  })).replace(/=/g, '');

  const encoder = new TextEncoder();
  const signingInput = `${header}.${payload}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), (c: string) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${b64sig}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional: protect with a secret header for cron calls
    const authHeader = req.headers.get('authorization') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    // Allow cron (anon key) or internal calls
    if (!authHeader.includes(anonKey) && !authHeader.includes('Bearer ')) {
      // Still allow — cron sends anon key
    }

    const token = await getServiceAccountToken();
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    // Query orders: status=pending AND payment_status=pending AND created_at < cutoff
    const results = await runQuery(token, {
      from: [{ collectionId: 'orders' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'EQUAL',
                value: { stringValue: 'pending' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'payment_status' },
                op: 'EQUAL',
                value: { stringValue: 'pending' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'created_at' },
                op: 'LESS_THAN',
                value: { timestampValue: cutoff.toISOString() },
              },
            },
          ],
        },
      },
      limit: 100,
    });

    let cancelled = 0;
    const now = new Date().toISOString();

    for (const r of results) {
      const docPath = r.document.name;
      await patchDoc(token, docPath, {
        status: { stringValue: 'cancelled' },
        payment_status: { stringValue: 'expired' },
        updated_at: { timestampValue: now },
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
