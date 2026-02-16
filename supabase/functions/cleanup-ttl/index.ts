import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FIREBASE_PROJECT_ID = 'valnix';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Collections to clean and their retention in days
const CLEANUP_CONFIG = [
  { collection: 'cron_audit_logs', retentionDays: 30 },
  { collection: 'rate_limits', retentionDays: 7 },
  { collection: 'rate_limit_logs', retentionDays: 30 },
];

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

// ── Cleanup logic ──
async function cleanupCollection(collection: string, retentionDays: number, accessToken: string): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();

  // Query docs with created_at < cutoff using structured query
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'created_at' },
          op: 'LESS_THAN',
          value: { stringValue: cutoffIso },
        },
      },
      limit: 500,
    },
  };

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(queryBody),
  });

  if (!res.ok) {
    console.warn(`⚠️ Query failed for ${collection}: ${res.status}`);
    return 0;
  }

  const results = await res.json();
  const docs = results.filter((r: any) => r.document?.name);

  if (docs.length === 0) return 0;

  // Batch delete using :commit (max 500 per commit)
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const writes = docs.map((r: any) => ({
    delete: r.document.name,
  }));

  const commitRes = await fetch(commitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ writes }),
  });

  if (!commitRes.ok) {
    console.warn(`⚠️ Batch delete failed for ${collection}: ${commitRes.status}`);
    return 0;
  }

  return docs.length;
}

Deno.serve(async (req) => {
  // Auth via CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('X-Cron-Secret') || req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!cronSecret || authHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startMs = Date.now();

  try {
    const accessToken = await getFirebaseAccessToken();
    const results: Record<string, number> = {};

    for (const config of CLEANUP_CONFIG) {
      const deleted = await cleanupCollection(config.collection, config.retentionDays, accessToken);
      results[config.collection] = deleted;
      console.log(`🧹 ${config.collection}: deleted ${deleted} docs (retention: ${config.retentionDays}d)`);
    }

    const durationMs = Date.now() - startMs;
    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);

    console.log(`✅ TTL cleanup complete: ${totalDeleted} docs deleted in ${durationMs}ms`);

    return new Response(JSON.stringify({
      success: true,
      deleted: results,
      total_deleted: totalDeleted,
      duration_ms: durationMs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ cleanup-ttl error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
