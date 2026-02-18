import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { timingSafeEqual } from '../_shared/auth.ts';

const STALE_MINUTES = 30;

async function runQuery(token: string, structuredQuery: Record<string, unknown>): Promise<any[]> {
  const resp = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  const results = await resp.json();
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document);
}

async function patchDoc(token: string, docPath: string, fields: Record<string, unknown>, updateMask: string[]): Promise<void> {
  const mask = updateMask.map(f => `updateMask.fieldPaths=${f}`).join('&');
  await fetch(`https://firestore.googleapis.com/v1/${docPath}?${mask}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function addAuditLog(token: string, data: Record<string, unknown>): Promise<void> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if ((k === 'ran_at' || k.endsWith('_at')) && typeof v === 'string') fields[k] = { timestampValue: v };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { nullValue: null };
  }
  const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  fields['expires_at'] = { timestampValue: expireAt };
  await fetch(`${FIRESTORE_BASE}/cron_audit_logs`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!cronSecret || !providedSecret || !timingSafeEqual(cronSecret, providedSecret)) {
    console.warn('🚨 cleanup-orders: unauthorized invocation attempt');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const startMs = Date.now();
  let cancelled = 0;
  let auditError: string | null = null;

  try {
    const token = await getFirebaseAccessToken();
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    let results: any[] = [];
    try {
      results = await runQuery(token, {
        from: [{ collectionId: 'ordens' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
          { fieldFilter: { field: { fieldPath: 'payment_status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
        ] } },
        limit: 500,
      });
    } catch {
      results = await runQuery(token, {
        from: [{ collectionId: 'ordens' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
        limit: 500,
      });
    }

    const now = new Date().toISOString();
    for (const r of results) {
      const fields = r.document.fields;
      if (fields?.payment_status?.stringValue !== 'pending') continue;
      const createdAt = fields?.created_at?.stringValue || fields?.created_at?.timestampValue;
      if (!createdAt) continue;
      const createdDate = new Date(createdAt);
      if (isNaN(createdDate.getTime()) || createdDate >= cutoff) continue;
      await patchDoc(token, r.document.name, {
        status: { stringValue: 'cancelled' }, payment_status: { stringValue: 'expired' },
        updated_at: { stringValue: now }, notes: { stringValue: 'Cancelado automaticamente — pagamento não recebido em 30 min.' },
      }, ['status', 'payment_status', 'updated_at', 'notes']);
      cancelled++;
    }

    let guestCleaned = 0;
    try {
      const guestResults = await runQuery(token, { from: [{ collectionId: 'ordens' }], limit: 100 });
      const nowISO = new Date().toISOString();
      for (const r of guestResults) {
        const expiresAt = r.document.fields?.expires_at?.stringValue;
        if (expiresAt && expiresAt < nowISO) {
          const guestDocPath = r.document.name;
          const guestHash = guestDocPath.split('/').pop()!;
          try {
            const itemsUrl = `${FIRESTORE_BASE}/ordens/${guestHash}/items`;
            const itemsResp = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (itemsResp.ok) {
              const itemsData = await itemsResp.json();
              for (const itemDoc of (itemsData.documents || [])) {
                await fetch(`https://firestore.googleapis.com/v1/${itemDoc.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
              }
            }
          } catch {}
          await fetch(`https://firestore.googleapis.com/v1/${guestDocPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          guestCleaned++;
        }
      }
      if (guestCleaned > 0) console.log(`[cleanup-orders] Cleaned ${guestCleaned} expired ordens`);
    } catch (e) { console.warn('[cleanup-orders] ordens cleanup error:', e); }

    const durationMs = Date.now() - startMs;
    console.log(`[cleanup-orders] Cancelled ${cancelled} stale orders, cleaned ${guestCleaned} ordens in ${durationMs}ms`);
    try { await addAuditLog(token, { job_name: 'cleanup-orders', ran_at: new Date().toISOString(), ok: true, cancelled_count: cancelled, duration_ms: durationMs, orders_scanned: results.length, source: 'pg_cron', version: 'v2-atomic' }); } catch {}
    return new Response(JSON.stringify({ success: true, cancelled, duration_ms: durationMs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    auditError = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;
    console.error('[cleanup-orders] Error:', err);
    try { const token = await getFirebaseAccessToken(); await addAuditLog(token, { job_name: 'cleanup-orders', ran_at: new Date().toISOString(), ok: false, cancelled_count: cancelled, duration_ms: durationMs, error: auditError }); } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
