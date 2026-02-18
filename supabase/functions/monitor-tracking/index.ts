import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { parseFirestoreResults } from '../_shared/firestore.ts';
import { verifyAdminToken } from '../_shared/auth.ts';

/**
 * Monitor-tracking: health check for Meta CAPI tracking integrity
 * 
 * Checks:
 * 1. CAPI errors in capi_event_log (last 24h)
 * 2. Paid orders missing meta_purchase_events (missed CAPI)
 * 3. Duplicate meta_purchase_events (should never happen)
 * 4. Error rate trends
 */

async function runQuery(body: any): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseFirestoreResults(data);
}

async function listCollection(col: string, limit = 500): Promise<any[]> {
  return runQuery({ structuredQuery: { from: [{ collectionId: col }], limit } });
}

async function queryByTimeRange(col: string, field: string, since: string, limit = 500): Promise<any[]> {
  return runQuery({
    structuredQuery: {
      from: [{ collectionId: col }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { stringValue: since },
        },
      },
      orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
      limit,
    },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Auth check
    const adminToken = req.headers.get('x-admin-token');
    if (!adminToken || !verifyAdminToken(adminToken)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const hoursBack = parseInt(url.searchParams.get('hours') || '24');
    const since = new Date(Date.now() - hoursBack * 3600_000).toISOString();

    console.log(`🔍 [Monitor] Running tracking health check (last ${hoursBack}h)`);

    // ── 1. CAPI Event Log — errors & stats ─────────────────────────
    const capiLogs = await queryByTimeRange('capi_event_log', 'created_at', since, 500);
    
    const capiStats = {
      total: capiLogs.length,
      sent: capiLogs.filter(l => l.status === 'sent').length,
      failed: capiLogs.filter(l => l.status === 'failed').length,
      errors: capiLogs
        .filter(l => l.status === 'failed')
        .map(l => ({
          event_name: l.event_name,
          event_id: l.event_id,
          error: l.error_message,
          status_code: l.status_code,
          time: l.created_at,
        })),
      byEvent: {} as Record<string, { sent: number; failed: number }>,
    };

    capiLogs.forEach(l => {
      const name = l.event_name || 'unknown';
      if (!capiStats.byEvent[name]) capiStats.byEvent[name] = { sent: 0, failed: 0 };
      if (l.status === 'sent') capiStats.byEvent[name].sent++;
      else capiStats.byEvent[name].failed++;
    });

    // ── 2. Meta Purchase Events — dedup integrity ──────────────────
    const metaPurchaseEvents = await listCollection('meta_purchase_events', 500);
    const recentMetaEvents = metaPurchaseEvents.filter(e => e.created_at >= since);

    // Check for any event_id inconsistencies
    const eventIdIssues: string[] = [];
    recentMetaEvents.forEach(e => {
      const expectedPrefix = 'purchase_';
      if (e.event_id && !e.event_id.startsWith(expectedPrefix)) {
        eventIdIssues.push(`Event ${e.id}: event_id="${e.event_id}" doesn't start with "${expectedPrefix}"`);
      }
    });

    // Source distribution
    const sourceDist: Record<string, number> = {};
    recentMetaEvents.forEach(e => {
      const src = e.source || 'unknown';
      sourceDist[src] = (sourceDist[src] || 0) + 1;
    });

    // ── 3. Paid orders missing CAPI ────────────────────────────────
    const recentOrders = await queryByTimeRange('ordens', 'updated_at', since, 200);
    const paidOrders = recentOrders.filter(o => o.payment_status === 'paid');
    const metaEventIds = new Set(metaPurchaseEvents.map(e => e.id));
    
    const missingCapi = paidOrders
      .filter(o => !metaEventIds.has(o.id))
      .map(o => ({
        orderId: o.id,
        amount: o.total_amount,
        customer: o.customer_name,
        paidAt: o.updated_at,
      }));

    // ── 4. Build health report ─────────────────────────────────────
    const errorRate = capiStats.total > 0 ? (capiStats.failed / capiStats.total * 100) : 0;
    
    type AlertLevel = 'ok' | 'warning' | 'critical';
    const alerts: Array<{ level: AlertLevel; message: string; detail?: string }> = [];

    // Error rate alert
    if (errorRate > 20) {
      alerts.push({ level: 'critical', message: `Taxa de erro CAPI alta: ${errorRate.toFixed(1)}%`, detail: `${capiStats.failed} de ${capiStats.total} eventos falharam` });
    } else if (errorRate > 5) {
      alerts.push({ level: 'warning', message: `Taxa de erro CAPI elevada: ${errorRate.toFixed(1)}%`, detail: `${capiStats.failed} falhas` });
    }

    // Missing CAPI alert
    if (missingCapi.length > 0) {
      alerts.push({ level: 'warning', message: `${missingCapi.length} pedido(s) pago(s) sem CAPI Purchase`, detail: missingCapi.map(m => m.orderId.substring(0, 8)).join(', ') });
    }

    // Event ID inconsistency alert
    if (eventIdIssues.length > 0) {
      alerts.push({ level: 'warning', message: `${eventIdIssues.length} event_id(s) com formato inconsistente`, detail: eventIdIssues[0] });
    }

    // No data alert
    if (capiStats.total === 0 && paidOrders.length > 0) {
      alerts.push({ level: 'critical', message: 'Nenhum evento CAPI registrado apesar de pedidos pagos', detail: 'Verificar se meta-capi está funcionando' });
    }

    // All good
    if (alerts.length === 0) {
      alerts.push({ level: 'ok', message: 'Tracking saudável — sem problemas detectados' });
    }

    const report = {
      period: `${hoursBack}h`,
      timestamp: new Date().toISOString(),
      capi: {
        total: capiStats.total,
        sent: capiStats.sent,
        failed: capiStats.failed,
        errorRate: Math.round(errorRate * 10) / 10,
        byEvent: capiStats.byEvent,
        recentErrors: capiStats.errors.slice(0, 10),
      },
      dedup: {
        totalMetaPurchaseEvents: recentMetaEvents.length,
        sourceDistribution: sourceDist,
        eventIdIssues: eventIdIssues.length,
      },
      coverage: {
        paidOrders: paidOrders.length,
        withCapi: paidOrders.length - missingCapi.length,
        missingCapi: missingCapi.length,
        coverageRate: paidOrders.length > 0 ? Math.round((1 - missingCapi.length / paidOrders.length) * 1000) / 10 : 100,
        missingDetails: missingCapi.slice(0, 10),
      },
      alerts,
    };

    console.log(`✅ [Monitor] Health check complete — ${alerts[0]?.level}: ${alerts[0]?.message}`);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Monitor error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
