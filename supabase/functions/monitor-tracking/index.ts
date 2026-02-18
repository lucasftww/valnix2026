import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { parseFirestoreResults } from '../_shared/firestore.ts';
import { verifyAdminToken } from '../_shared/auth.ts';

/**
 * Monitor-tracking: health check for Meta CAPI tracking integrity
 * 
 * Checks:
 * 1. CAPI errors in capi_event_log
 * 2. Paid orders missing meta_purchase_events (missed CAPI)
 * 3. Duplicate meta_purchase_events (idempotency failures)
 * 4. Consecutive CAPI errors (systemic failure detection)
 * 5. Event ID format consistency
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

// ── Detect consecutive errors (systemic failure) ──────────────────
function detectConsecutiveErrors(logs: any[]): { maxStreak: number; currentStreak: number; isOngoing: boolean; streakEvents: any[] } {
  // Sort by created_at ascending
  const sorted = [...logs].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  
  let maxStreak = 0;
  let currentStreak = 0;
  let streakStart = -1;
  let maxStreakStart = -1;
  let maxStreakEnd = -1;

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].status === 'failed') {
      if (currentStreak === 0) streakStart = i;
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        maxStreakStart = streakStart;
        maxStreakEnd = i;
      }
    } else {
      currentStreak = 0;
    }
  }

  // Check if the streak is ongoing (last N events are all failures)
  const lastStreak = currentStreak;
  const isOngoing = lastStreak >= 3;
  
  const streakEvents = maxStreakStart >= 0
    ? sorted.slice(maxStreakStart, maxStreakEnd + 1).map(e => ({
        event_name: e.event_name,
        event_id: e.event_id,
        error: e.error_message,
        status_code: e.status_code,
        time: e.created_at,
      }))
    : [];

  return { maxStreak, currentStreak: lastStreak, isOngoing, streakEvents };
}

// ── Detect duplicate event IDs in meta_purchase_events ────────────
function detectDuplicates(events: any[]): Array<{ eventId: string; orderId: string; count: number; sources: string[] }> {
  // Group by event_id to find duplicates
  const byEventId = new Map<string, any[]>();
  events.forEach(e => {
    const eid = e.event_id || 'unknown';
    if (!byEventId.has(eid)) byEventId.set(eid, []);
    byEventId.get(eid)!.push(e);
  });

  const duplicates: Array<{ eventId: string; orderId: string; count: number; sources: string[] }> = [];
  byEventId.forEach((entries, eventId) => {
    if (entries.length > 1) {
      duplicates.push({
        eventId,
        orderId: entries[0].id || 'unknown',
        count: entries.length,
        sources: entries.map(e => e.source || 'unknown'),
      });
    }
  });

  // Also check if multiple docs exist for same order (doc ID = orderId)
  // Since addFirestoreDocWithId prevents this, duplicates here mean idempotency failure
  const byDocId = new Map<string, any[]>();
  events.forEach(e => {
    const docId = e.id || 'unknown';
    if (!byDocId.has(docId)) byDocId.set(docId, []);
    byDocId.get(docId)!.push(e);
  });

  // This shouldn't happen with addFirestoreDocWithId, but check anyway
  byDocId.forEach((entries, docId) => {
    if (entries.length > 1 && !duplicates.some(d => d.orderId === docId)) {
      duplicates.push({
        eventId: entries[0].event_id || 'unknown',
        orderId: docId,
        count: entries.length,
        sources: entries.map(e => e.source || 'unknown'),
      });
    }
  });

  return duplicates;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token", methods: "GET, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    // ── 2. Consecutive error detection ─────────────────────────────
    const consecutiveErrors = detectConsecutiveErrors(capiLogs);

    // ── 3. Meta Purchase Events — dedup integrity ──────────────────
    const metaPurchaseEvents = await listCollection('meta_purchase_events', 500);
    const recentMetaEvents = metaPurchaseEvents.filter(e => e.created_at >= since);

    // Check for event_id format issues
    const eventIdIssues: string[] = [];
    recentMetaEvents.forEach(e => {
      if (e.event_id && !e.event_id.startsWith('purchase_')) {
        eventIdIssues.push(`Event ${e.id}: event_id="${e.event_id}" doesn't start with "purchase_"`);
      }
    });

    // Duplicate detection
    const duplicates = detectDuplicates(recentMetaEvents);

    // Source distribution
    const sourceDist: Record<string, number> = {};
    recentMetaEvents.forEach(e => {
      const src = e.source || 'unknown';
      sourceDist[src] = (sourceDist[src] || 0) + 1;
    });

    // ── 4. Paid orders missing CAPI ────────────────────────────────
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

    // ── 5. Build health report ─────────────────────────────────────
    const errorRate = capiStats.total > 0 ? (capiStats.failed / capiStats.total * 100) : 0;
    
    type AlertLevel = 'ok' | 'warning' | 'critical';
    const alerts: Array<{ level: AlertLevel; message: string; detail?: string }> = [];

    // Consecutive errors alert (HIGHEST PRIORITY)
    if (consecutiveErrors.isOngoing) {
      alerts.push({
        level: 'critical',
        message: `🔴 ${consecutiveErrors.currentStreak} erros CAPI consecutivos — falha sistêmica em andamento`,
        detail: `O sistema falhou nos últimos ${consecutiveErrors.currentStreak} envios. Verifique token Meta, Pixel ID ou conectividade.`,
      });
    } else if (consecutiveErrors.maxStreak >= 5) {
      alerts.push({
        level: 'warning',
        message: `Streak de ${consecutiveErrors.maxStreak} erros consecutivos detectado (já resolvido)`,
        detail: `Houve uma sequência de falhas, mas o sistema se recuperou.`,
      });
    }

    // Duplicate events alert
    if (duplicates.length > 0) {
      const totalDups = duplicates.reduce((sum, d) => sum + d.count - 1, 0);
      alerts.push({
        level: 'critical',
        message: `🔴 ${totalDups} evento(s) Purchase duplicado(s) — falha de idempotência`,
        detail: `Pedidos afetados: ${duplicates.map(d => d.orderId.substring(0, 8)).join(', ')}. addFirestoreDocWithId pode não estar bloqueando corretamente.`,
      });
    }

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
      alerts.push({ level: 'ok', message: '✅ Tracking saudável — sem problemas detectados' });
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
        duplicates,
      },
      consecutiveErrors: {
        maxStreak: consecutiveErrors.maxStreak,
        currentStreak: consecutiveErrors.currentStreak,
        isOngoing: consecutiveErrors.isOngoing,
        streakEvents: consecutiveErrors.streakEvents.slice(0, 5),
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
