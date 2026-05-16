import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { errorMessage, setCorsHeaders, verifyAdminToken } from './_utils/helpers.js';

type AlertLevel = 'critical' | 'warning';

interface MonitorAlert {
  level: AlertLevel;
  message: string;
  detail: string;
}

interface AnalyticsEventRow {
  id: string;
  status?: string | null;
  event_name?: string | null;
  event_id?: string | null;
  error?: string | null;
  status_code?: number | null;
  timestamp?: string | null;
  source?: string | null;
  custom_data?: { order_id?: string } | null;
}

interface StreakSample {
  event_name?: string | null;
  event_id?: string | null;
  error?: string | null;
  time?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['x-admin-token'] as string;
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hours = Number.parseInt(req.query.hours as string) || 24;
    const sinceISO = new Date(Date.now() - hours * 3600_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('analytics_events')
      .select('id,status,event_name,event_id,error,status_code,timestamp,source,custom_data')
      .gte('timestamp', sinceISO)
      .order('timestamp', { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const events: AnalyticsEventRow[] = (data ?? []) as AnalyticsEventRow[];

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
          time: e.timestamp,
        })),
    };

    for (const e of events) {
      const name = e.event_name || 'unknown';
      if (!capiStats.byEvent[name]) capiStats.byEvent[name] = { sent: 0, failed: 0 };
      if (e.status === 'relayed') capiStats.byEvent[name].sent++;
      if (e.status === 'failed') capiStats.byEvent[name].failed++;
    }

    // Duplicates by event_id
    const idMap = new Map<string, { count: number; sources: Set<string>; orderId?: string }>();
    for (const e of events) {
      if (!e.event_id) continue;
      const existing = idMap.get(e.event_id) || {
        count: 0,
        sources: new Set<string>(),
        orderId: e.custom_data?.order_id,
      };
      existing.count++;
      existing.sources.add(e.source || 'unknown');
      idMap.set(e.event_id, existing);
    }
    const duplicates = [...idMap.entries()]
      .filter(([, d]) => d.count > 1)
      .map(([id, d]) => ({
        eventId: id,
        orderId: d.orderId || 'N/A',
        count: d.count,
        sources: [...d.sources],
      }))
      .slice(0, 5);

    // Consecutive failure streaks
    let currentStreak = 0;
    let maxStreak = 0;
    const streakEvents: StreakSample[] = [];
    for (const e of events) {
      if (e.status === 'failed') {
        currentStreak++;
        if (streakEvents.length < 5) {
          streakEvents.push({
            event_name: e.event_name,
            event_id: e.event_id,
            error: e.error,
            time: e.timestamp,
          });
        }
      } else if (e.status === 'relayed') {
        maxStreak = Math.max(maxStreak, currentStreak);
        currentStreak = 0;
      }
    }
    maxStreak = Math.max(maxStreak, currentStreak);

    const report = {
      period: `${hours}h`,
      timestamp: new Date().toISOString(),
      capi: {
        total: capiStats.total,
        sent: capiStats.sent,
        failed: capiStats.failed,
        errorRate: capiStats.total > 0 ? (capiStats.failed / capiStats.total) * 100 : 0,
        byEvent: capiStats.byEvent,
        recentErrors: capiStats.recentErrors,
      },
      dedup: {
        totalMetaPurchaseEvents: events.filter((e) => e.event_name === 'Purchase').length,
        sourceDistribution: events.reduce<Record<string, number>>((acc, e) => {
          const src = e.source || 'unknown';
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {}),
        eventIdIssues: [...idMap.values()].filter((d) => d.count > 1).length,
        duplicates,
      },
      consecutiveErrors: {
        maxStreak,
        currentStreak: events[0]?.status === 'failed' ? currentStreak : 0,
        isOngoing: events[0]?.status === 'failed',
        streakEvents,
      },
      coverage: {
        paidOrders: 0,
        withCapi: 0,
        missingCapi: 0,
        coverageRate: 100,
        missingDetails: [],
      },
      alerts: [] as MonitorAlert[],
    };

    if (report.capi.errorRate > 15) {
      report.alerts.push({
        level: 'critical',
        message: 'Taxa de erro CAPI elevada',
        detail: `${report.capi.errorRate.toFixed(1)}% de falhas.`,
      });
    } else if (report.capi.errorRate > 5) {
      report.alerts.push({
        level: 'warning',
        message: 'Erros intermitentes no CAPI',
        detail: 'Verifique os logs recentes.',
      });
    }
    if (maxStreak > 3) {
      report.alerts.push({
        level: 'critical',
        message: 'Múltiplas falhas consecutivas',
        detail: `Ocorreu uma sequência de ${maxStreak} erros.`,
      });
    }

    return res.status(200).json(report);
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[Monitor] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
