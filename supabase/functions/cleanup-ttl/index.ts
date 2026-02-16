import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FIREBASE_PROJECT_ID = 'valnix';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const CLEANUP_CONFIG = [
  { collection: 'cron_audit_logs', retentionDays: 30 },
  { collection: 'rate_limits', retentionDays: 7 },
  { collection: 'rate_limit_logs', retentionDays: 30 },
];

const BATCH_SIZE = 500;

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

// ── Single-pass delete: query + paginated batch delete ──
async function deleteByQuery(
  collection: string,
  cutoffIso: string,
  valueType: 'stringValue' | 'timestampValue',
  accessToken: string,
  alreadyDeleted: Set<string>,
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const queryUrl = `${FIRESTORE_BASE}:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'created_at' },
            op: 'LESS_THAN',
            value: { [valueType]: cutoffIso },
          },
        },
        orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'ASCENDING' }],
        limit: BATCH_SIZE,
      },
    };

    let res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(queryBody),
    });

    // If orderBy fails (missing index), retry without it
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`⚠️ ${collection} [${valueType}] orderBy query failed (${res.status}): ${errBody.slice(0, 200)}`);
      const fallbackBody = { ...queryBody };
      delete (fallbackBody.structuredQuery as any).orderBy;
      res = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify(fallbackBody),
      });
      if (!res.ok) {
        const errBody2 = await res.text().catch(() => '');
        console.warn(`⚠️ ${collection} [${valueType}] query failed entirely (${res.status}): ${errBody2.slice(0, 200)}`);
        break;
      }
    }

    const results = await res.json();
    // Deduplicate: skip docs already deleted in the other pass
    const docs = results.filter((r: any) => r.document?.name && !alreadyDeleted.has(r.document.name));

    if (docs.length === 0) break;

    const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
    const writes = docs.map((r: any) => ({ delete: r.document.name }));

    const commitRes = await fetch(commitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ writes }),
    });

    if (!commitRes.ok) {
      console.warn(`⚠️ Batch delete failed for ${collection} [${valueType}]: ${commitRes.status}`);
      break;
    }

    for (const r of docs) alreadyDeleted.add(r.document.name);
    totalDeleted += docs.length;
    console.log(`🧹 ${collection} [${valueType}]: deleted batch of ${docs.length} (total: ${totalDeleted})`);

    if (docs.length < BATCH_SIZE) break;
  }

  return totalDeleted;
}

// ── 2-pass cleanup: stringValue first, then timestampValue ──
async function cleanupCollection(collection: string, retentionDays: number, accessToken: string): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();

  const alreadyDeleted = new Set<string>();

  // Pass 1: docs with created_at stored as stringValue (ISO 8601)
  const deletedString = await deleteByQuery(collection, cutoffIso, 'stringValue', accessToken, alreadyDeleted);
  console.log(`  Pass 1 (string): ${deletedString} docs`);

  // Pass 2: docs with created_at stored as timestampValue
  const deletedTimestamp = await deleteByQuery(collection, cutoffIso, 'timestampValue', accessToken, alreadyDeleted);
  console.log(`  Pass 2 (timestamp): ${deletedTimestamp} docs`);

  return deletedString + deletedTimestamp;
}

// ── Write audit doc ──
async function writeAuditDoc(
  accessToken: string, runId: string, results: Record<string, number>,
  totalDeleted: number, durationMs: number, success: boolean,
  startedIso: string,
) {
  const finishedIso = new Date().toISOString();
  const url = `${FIRESTORE_BASE}/cron_audit_logs?documentId=${encodeURIComponent(runId)}`;
  const fields: Record<string, unknown> = {
    type: { stringValue: 'cleanup-ttl' },
    run_id: { stringValue: runId },
    total_deleted: { integerValue: String(totalDeleted) },
    duration_ms: { integerValue: String(durationMs) },
    success: { booleanValue: success },
    created_at: { timestampValue: finishedIso },
    started_at: { timestampValue: startedIso },
    finished_at: { timestampValue: finishedIso },
  };
  for (const [col, count] of Object.entries(results)) {
    fields[`deleted_${col}`] = { integerValue: String(count) };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ fields }),
    });
    if (res.ok) console.log(`📝 Audit doc written: ${runId}`);
    else console.warn(`⚠️ Audit doc write failed: ${res.status}`);
  } catch (e) {
    console.warn('⚠️ Audit doc write error:', e);
  }
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('X-Cron-Secret') || req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!cronSecret || authHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const runId = crypto.randomUUID();
  const startMs = Date.now();
  const startedIso = new Date().toISOString();
  console.log(`🕐 cleanup-ttl [${runId}] started at ${startedIso} (UTC) | Timezone offset: ${new Date().getTimezoneOffset()}min`);

  const results: Record<string, number> = {};

  try {
    const accessToken = await getFirebaseAccessToken();

    for (const config of CLEANUP_CONFIG) {
      const deleted = await cleanupCollection(config.collection, config.retentionDays, accessToken);
      results[config.collection] = deleted;
      console.log(`🧹 ${config.collection}: total deleted ${deleted} docs (retention: ${config.retentionDays}d)`);
    }

    const durationMs = Date.now() - startMs;
    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);

    console.log(`✅ TTL cleanup [${runId}] complete: ${totalDeleted} docs deleted in ${durationMs}ms`);
    await writeAuditDoc(accessToken, runId, results, totalDeleted, durationMs, true, startedIso);

    return new Response(JSON.stringify({
      success: true, run_id: runId, deleted: results,
      total_deleted: totalDeleted, duration_ms: durationMs,
      server_time_utc: startedIso,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(`❌ cleanup-ttl [${runId}] error:`, err);
    try {
      const accessToken = await getFirebaseAccessToken();
      await writeAuditDoc(accessToken, runId, results, 0, durationMs, false, startedIso);
    } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error', run_id: runId }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
