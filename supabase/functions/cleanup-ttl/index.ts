import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';

const CLEANUP_CONFIG = [
  { collection: 'cron_audit_logs', retentionDays: 30 },
  { collection: 'rate_limits', retentionDays: 7 },
  { collection: 'rate_limit_logs', retentionDays: 30 },
  { collection: 'delivery_locks', retentionDays: 14 },
  { collection: 'coupon_use_events', retentionDays: 30 },
  { collection: 'meta_purchase_events', retentionDays: 30 },
];

const BATCH_SIZE = 500;

// ── Single-pass delete: query + paginated batch delete ──
async function deleteByQuery(
  collection: string, cutoffIso: string, valueType: 'stringValue' | 'timestampValue',
  accessToken: string, alreadyDeleted: Set<string>,
): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const queryUrl = `${FIRESTORE_BASE}:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: 'created_at' }, op: 'LESS_THAN', value: { [valueType]: cutoffIso } } },
        orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'ASCENDING' }],
        limit: BATCH_SIZE,
      },
    };
    let res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify(queryBody) });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`⚠️ ${collection} [${valueType}] orderBy query failed (${res.status}): ${errBody.slice(0, 200)}`);
      const fallbackBody = { ...queryBody };
      delete (fallbackBody.structuredQuery as any).orderBy;
      res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify(fallbackBody) });
      if (!res.ok) { console.warn(`⚠️ ${collection} [${valueType}] query failed entirely (${res.status})`); break; }
    }
    const results = await res.json();
    const docs = results.filter((r: any) => r.document?.name && !alreadyDeleted.has(r.document.name));
    if (docs.length === 0) break;
    const commitUrl = `${FIRESTORE_BASE}:commit`;
    const writes = docs.map((r: any) => ({ delete: r.document.name }));
    const commitRes = await fetch(commitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ writes }) });
    if (!commitRes.ok) { console.warn(`⚠️ Batch delete failed for ${collection} [${valueType}]: ${commitRes.status}`); break; }
    for (const r of docs) alreadyDeleted.add(r.document.name);
    totalDeleted += docs.length;
    console.log(`🧹 ${collection} [${valueType}]: deleted batch of ${docs.length} (total: ${totalDeleted})`);
    if (docs.length < BATCH_SIZE) break;
  }
  return totalDeleted;
}

async function cleanupCollection(collection: string, retentionDays: number, accessToken: string): Promise<number> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();
  const alreadyDeleted = new Set<string>();
  const deletedString = await deleteByQuery(collection, cutoffIso, 'stringValue', accessToken, alreadyDeleted);
  const deletedTimestamp = await deleteByQuery(collection, cutoffIso, 'timestampValue', accessToken, alreadyDeleted);
  return deletedString + deletedTimestamp;
}

async function writeAuditDoc(accessToken: string, runId: string, results: Record<string, number>, totalDeleted: number, durationMs: number, success: boolean, startedIso: string) {
  const finishedIso = new Date().toISOString();
  const url = `${FIRESTORE_BASE}/cron_audit_logs?documentId=${encodeURIComponent(runId)}`;
  const fields: Record<string, unknown> = {
    type: { stringValue: 'cleanup-ttl' }, run_id: { stringValue: runId },
    total_deleted: { integerValue: String(totalDeleted) }, duration_ms: { integerValue: String(durationMs) },
    success: { booleanValue: success }, created_at: { timestampValue: finishedIso },
    started_at: { timestampValue: startedIso }, finished_at: { timestampValue: finishedIso },
  };
  for (const [col, count] of Object.entries(results)) fields[`deleted_${col}`] = { integerValue: String(count) };
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields }) });
  } catch (e) { console.warn('⚠️ Audit doc write error:', e); }
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('X-Cron-Secret') || req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!cronSecret || authHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const runId = crypto.randomUUID();
  const startMs = Date.now();
  const startedIso = new Date().toISOString();
  console.log(`🕐 cleanup-ttl [${runId}] started at ${startedIso}`);
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
    return new Response(JSON.stringify({ success: true, run_id: runId, deleted: results, total_deleted: totalDeleted, duration_ms: durationMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(`❌ cleanup-ttl [${runId}] error:`, err);
    try { const at = await getFirebaseAccessToken(); await writeAuditDoc(at, runId, results, 0, durationMs, false, startedIso); } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error', run_id: runId }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
