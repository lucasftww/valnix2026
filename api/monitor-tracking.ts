import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase';
import { errorMessage, setCorsHeaders, verifyAdminToken } from './_utils/helpers';

type AlertLevel = 'critical' | 'warning';

interface MonitorAlert {
  level: AlertLevel;
  message: string;
  detail: string;
}

interface AnalyticsEventRow {
  id: string;
  status?: string;
  event_name?: string;
  event_id?: string;
  error?: string;
  status_code?: number;
  timestamp?: string;
  source?: string;
  custom_data?: { order_id?: string };
}

interface StreakSample {
  event_name?: string;
  event_id?: string;
  error?: string;
  time?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. Verificação de Admin
  const token = req.headers['x-admin-token'] as string;
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const sinceDate = new Date();
    sinceDate.setHours(sinceDate.getHours() - hours);
    const sinceStr = sinceDate.toISOString();

    // 2. Query Firestore para eventos de analytics_events
    const snapshot = await db.collection('analytics_events')
      .where('timestamp', '>=', sinceStr)
      .orderBy('timestamp', 'desc')
      .get();

    const events: AnalyticsEventRow[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<AnalyticsEventRow, 'id'>),
    }));

    // 3. Processamento de Métricas
    const capiStats = {
      total: events.length,
      sent: events.filter((e) => e.status === 'relayed').length,
      failed: events.filter((e) => e.status === 'failed').length,
      byEvent: {} as Record<string, { sent: number; failed: number }>,
      recentErrors: events
        .filter((e) => e.status === 'failed')
        .slice(0, 10)
        .map((e) => ({
          event_name: e.event_name,
          event_id: e.event_id,
          error: e.error || 'Unknown error',
          status_code: e.status_code || 500,
          time: e.timestamp
        }))
    };

    // Agrupar por tipo de evento
    events.forEach((e) => {
      if (!capiStats.byEvent[e.event_name]) {
        capiStats.byEvent[e.event_name] = { sent: 0, failed: 0 };
      }
      if (e.status === 'relayed') capiStats.byEvent[e.event_name].sent++;
      if (e.status === 'failed') capiStats.byEvent[e.event_name].failed++;
    });

    // 4. Detecção de Duplicatas (baseado em event_id)
    const idMap = new Map<string, { count: number; sources: Set<string>; orderId?: string }>();
    events.forEach((e) => {
      if (!e.event_id) return;
      const existing = idMap.get(e.event_id) || { count: 0, sources: new Set(), orderId: e.custom_data?.order_id };
      existing.count++;
      existing.sources.add(e.source || 'unknown');
      idMap.set(e.event_id, existing);
    });

    const duplicates = Array.from(idMap.entries())
      .filter(([_, data]) => data.count > 1)
      .map(([id, data]) => ({
        eventId: id,
        orderId: data.orderId || 'N/A',
        count: data.count,
        sources: Array.from(data.sources)
      }))
      .slice(0, 5);

    // 5. Erros Consecutivos
    let currentStreak = 0;
    let maxStreak = 0;
    const streakEvents: StreakSample[] = [];
    
    // Lista ordenada desc (do mais novo para o mais velho)
    for (const e of events) {
      if (e.status === 'failed') {
        currentStreak++;
        if (streakEvents.length < 5) streakEvents.push({
          event_name: e.event_name,
          event_id: e.event_id,
          error: e.error,
          time: e.timestamp
        });
      } else if (e.status === 'relayed') {
        maxStreak = Math.max(maxStreak, currentStreak);
        currentStreak = 0;
      }
    }
    maxStreak = Math.max(maxStreak, currentStreak);

    // 6. Report Final
    const report = {
      period: `${hours}h`,
      timestamp: new Date().toISOString(),
      capi: {
        total: capiStats.total,
        sent: capiStats.sent,
        failed: capiStats.failed,
        errorRate: capiStats.total > 0 ? (capiStats.failed / capiStats.total) * 100 : 0,
        byEvent: capiStats.byEvent,
        recentErrors: capiStats.recentErrors
      },
      dedup: {
        totalMetaPurchaseEvents: events.filter((e) => e.event_name === 'Purchase').length,
        sourceDistribution: events.reduce<Record<string, number>>((acc, e) => {
          const src = e.source || 'unknown';
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {}),
        eventIdIssues: Array.from(idMap.values()).filter(d => d.count > 1).length,
        duplicates
      },
      consecutiveErrors: {
        maxStreak,
        currentStreak: (events[0]?.status === 'failed' ? currentStreak : 0),
        isOngoing: events[0]?.status === 'failed',
        streakEvents
      },
      coverage: {
        paidOrders: 0, // Precisaria integrar com sistema de pedidos
        withCapi: 0,
        missingCapi: 0,
        coverageRate: 100,
        missingDetails: []
      },
      alerts: [] as MonitorAlert[]
    };

    // Geração de Alertas
    if (report.capi.errorRate > 15) {
      report.alerts.push({ level: 'critical', message: 'Taxa de erro CAPI elevada', detail: `${report.capi.errorRate.toFixed(1)}% de falhas.` });
    } else if (report.capi.errorRate > 5) {
      report.alerts.push({ level: 'warning', message: 'Erros intermitentes no CAPI', detail: 'Verifique os logs recentes.' });
    }

    if (maxStreak > 3) {
      report.alerts.push({ level: 'critical', message: 'Múltiplas falhas consecutivas', detail: `Ocorreu uma sequência de ${maxStreak} erros.` });
    }

    return res.status(200).json(report);
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error('❌ [Monitor] Error:', message);
    return res.status(500).json({ error: message });
  }
}
