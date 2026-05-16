import { useQuery } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { invokeFunction } from "@/lib/apiHelper";
import { useAuth } from "@/contexts/AdminAuthContext";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, AlertTriangle, AlertCircle, RefreshCw,
  Activity, Shield, Zap, Radio, Server, Globe, Flame, Copy as CopyIcon, Trash2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AdminErrorState } from "./AdminErrorState";

interface TrackingAlert {
  level: 'ok' | 'warning' | 'critical';
  message: string;
  detail?: string;
}

interface DuplicateEntry {
  eventId: string;
  orderId: string;
  count: number;
  sources: string[];
}

interface ConsecutiveErrors {
  maxStreak: number;
  currentStreak: number;
  isOngoing: boolean;
  streakEvents: Array<{ event_name: string; event_id: string; error: string; status_code: number; time: string }>;
}

interface TrackingReport {
  period: string;
  timestamp: string;
  capi: {
    total: number;
    sent: number;
    failed: number;
    errorRate: number;
    byEvent: Record<string, { sent: number; failed: number }>;
    recentErrors: Array<{ event_name: string; event_id: string; error: string; status_code: number; time: string }>;
  };
  dedup: {
    totalMetaPurchaseEvents: number;
    sourceDistribution: Record<string, number>;
    eventIdIssues: number;
    duplicates: DuplicateEntry[];
  };
  consecutiveErrors: ConsecutiveErrors;
  coverage: {
    paidOrders: number;
    withCapi: number;
    missingCapi: number;
    coverageRate: number;
    missingDetails: Array<{ orderId: string; amount: number; customer: string; paidAt: string }>;
  };
  alerts: TrackingAlert[];
}

const alertConfig = {
  ok: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  warning: { icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  critical: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
};

export function AdminTrackingMonitor() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [hours, setHours] = useState<'24' | '48' | '168'>('24');
  const [cleaning, setCleaning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<{ replayed: number; failed: number; already_sent: number; pending_replay?: number } | null>(null);
  const { toast } = useToast();

  const handleCapiReplay = async (dryRun: boolean) => {
    setReplaying(true);
    setReplayResult(null);
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('capi-replay', {
        method: 'POST',
        body: { dry_run: dryRun },
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReplayResult(data);
      if (dryRun) {
        toast({ title: "Scan concluído", description: `${data.pending_replay} pedidos pendentes de replay.` });
      } else {
        toast({ title: "Replay concluído", description: `${data.replayed} enviados, ${data.failed} falhas.` });
        refetch();
      }
    } catch (e: any) {
      toast({ title: "Erro no replay", description: e.message, variant: "destructive" });
    } finally {
      setReplaying(false);
    }
  };

  const handleCleanupCapiLogs = async () => {
    setCleaning(true);
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'POST',
        body: {},
        headers: { 'x-admin-token': token },
        queryParams: { resource: 'cleanup-capi-logs' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast({ title: "Logs limpos", description: `${data.deleted} registros removidos.` });
      refetch();
    } catch (e: any) {
      toast({ title: "Erro ao limpar logs", description: e.message, variant: "destructive" });
    } finally {
      setCleaning(false);
    }
  };

  const { data: report, isLoading, isError, refetch, isFetching } = useQuery<TrackingReport>({
    queryKey: ['tracking-monitor', hours],
    queryFn: async () => {
      const token = requireAdminToken();
      const res = await invokeFunction('monitor-tracking', {
        method: 'GET',
        queryParams: { hours },
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    enabled: isAdmin && !authLoading,
    refetchInterval: 120_000,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando saúde do tracking...</p>
      </div>
    );
  }

  if (isError) {
    return <AdminErrorState title="Erro ao carregar tracking" message="Não foi possível carregar os dados de tracking. Verifique sua conexão e tente novamente." onRetry={() => refetch()} retrying={isFetching} />;
  }

  const hoursLabel = hours === '24' ? '24h' : hours === '48' ? '48h' : '7 dias';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Tracking Monitor
            {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          </h2>
          <p className="text-sm text-muted-foreground">
            Meta CAPI health check • Atualiza a cada 2min
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={hours} onValueChange={(v) => setHours(v as typeof hours)}>
            <TabsList className="bg-muted/50 h-9">
              <TabsTrigger value="24" className="text-xs">24h</TabsTrigger>
              <TabsTrigger value="48" className="text-xs">48h</TabsTrigger>
              <TabsTrigger value="168" className="text-xs">7 dias</TabsTrigger>
            </TabsList>
          </Tabs>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs text-destructive hover:text-destructive" disabled={cleaning}>
                <Trash2 className="h-3.5 w-3.5" />
                Limpar Logs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar Logs CAPI</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai remover todos os registros de <strong>capi_event_log</strong> e <strong>meta_purchase_events</strong>. Os contadores de chamadas e cobertura serão zerados. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleCleanupCapiLogs} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {cleaning ? 'Limpando...' : 'Confirmar Limpeza'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" disabled={replaying}>
                {replaying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Replay CAPI
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replay Purchase CAPI</AlertDialogTitle>
                <AlertDialogDescription>
                  Envia eventos Purchase para o Meta CAPI de todos os pedidos pagos que ainda não foram enviados. Use "Scan" para ver quantos faltam, e "Enviar" para disparar.
                  {replayResult && (
                    <span className="block mt-2 text-sm font-medium">
                      {replayResult.pending_replay !== undefined 
                        ? `📊 ${replayResult.pending_replay} pedidos pendentes, ${replayResult.already_sent} já enviados`
                        : `✅ ${replayResult.replayed} enviados, ${replayResult.failed} falhas`}
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex gap-2">
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button variant="outline" onClick={() => handleCapiReplay(true)} disabled={replaying}>
                  {replaying ? 'Escaneando...' : 'Scan (dry run)'}
                </Button>
                <Button onClick={() => handleCapiReplay(false)} disabled={replaying}>
                  {replaying ? 'Enviando...' : 'Enviar Todos'}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {Array.isArray(report?.alerts) && report.alerts.length > 0 && (
        <div className="space-y-2">
          {report.alerts.map((alert, i) => {
            const config = alertConfig[alert.level];
            const Icon = config.icon;
            return (
              <Card key={i} className={cn("border", config.border, config.bg)}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", config.bg)}>
                    <Icon className={cn("h-5 w-5", config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-semibold text-sm", config.color)}>{alert.message}</p>
                    {alert.detail && <p className="text-xs text-muted-foreground mt-0.5">{alert.detail}</p>}
                  </div>
                  <Badge variant={alert.level === 'ok' ? 'default' : 'destructive'} className={cn(
                    "text-[10px] shrink-0",
                    alert.level === 'ok' && "bg-green-600"
                  )}>
                    {alert.level.toUpperCase()}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* CAPI Success Rate */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">CAPI Success</span>
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Server className="w-4 h-4 text-green-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">
              {report?.capi?.total ? (100 - (report.capi.errorRate || 0)).toFixed(1) : '—'}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {report?.capi?.sent || 0} enviados / {report?.capi?.failed || 0} falhas
            </p>
          </CardContent>
        </Card>

        {/* Coverage */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cobertura</span>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Radio className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{report?.coverage?.coverageRate ?? '—'}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {report?.coverage?.withCapi || 0} de {report?.coverage?.paidOrders || 0} pedidos
            </p>
          </CardContent>
        </Card>

        {/* Dedup Events */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dedup</span>
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-purple-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{report?.dedup?.totalMetaPurchaseEvents ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {(report?.dedup?.duplicates?.length || 0) === 0 ? '✅ Sem duplicatas' : `🔴 ${report?.dedup?.duplicates?.length} duplicata(s)`}
            </p>
          </CardContent>
        </Card>

        {/* Consecutive Errors */}
        <Card className={cn("border-border/50 bg-card/50", report?.consecutiveErrors?.isOngoing && "border-red-500/30 bg-red-500/5")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Streak Erros</span>
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", report?.consecutiveErrors?.isOngoing ? "bg-red-500/10" : "bg-orange-500/10")}>
                <Flame className={cn("w-4 h-4", report?.consecutiveErrors?.isOngoing ? "text-red-500" : "text-orange-500")} />
              </div>
            </div>
            <p className={cn("text-2xl font-bold", report?.consecutiveErrors?.isOngoing && "text-red-500")}>
              {report?.consecutiveErrors?.currentStreak ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {report?.consecutiveErrors?.isOngoing 
                ? '🔴 Em andamento' 
                : report?.consecutiveErrors?.maxStreak 
                  ? `Máx: ${report.consecutiveErrors.maxStreak}` 
                  : '✅ Estável'}
            </p>
          </CardContent>
        </Card>

        {/* Total Events */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total CAPI</span>
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-orange-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{report?.capi?.total ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">últimas {hoursLabel}</p>
          </CardContent>
        </Card>
      </div>

      {/* Detail Cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Events by Type */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Chamadas CAPI por Tipo</CardTitle>
                <CardDescription className="text-xs">Total de envios ao Meta ({hoursLabel}) — inclui retentativas</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {report?.capi?.byEvent && Object.keys(report.capi.byEvent || {}).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(report.capi.byEvent || {}).map(([name, stats]) => {
                  const total = stats.sent + stats.failed;
                  const successRate = total > 0 ? (stats.sent / total) * 100 : 0;
                  return (
                    <div key={name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{name}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-green-500">{stats.sent} ✓</span>
                          {stats.failed > 0 && <span className="text-red-500">{stats.failed} ✗</span>}
                        </div>
                      </div>
                      <Progress value={successRate} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Sem eventos no período</p>
            )}
          </CardContent>
        </Card>

        {/* Source Distribution */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Server className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-base">Origem dos Eventos</CardTitle>
                <CardDescription className="text-xs">Webhook vs Polling vs Confirm</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {report?.dedup?.sourceDistribution && Object.keys(report.dedup.sourceDistribution || {}).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(report.dedup.sourceDistribution || {}).filter(([source]) => source !== 'recovery').sort((a, b) => b[1] - a[1]).map(([source, count]) => {
                  const total = report.dedup?.totalMetaPurchaseEvents || 1;
                  const pct = (count / total) * 100;
                  const sourceLabel: Record<string, string> = {
                    webhook: '🔔 Webhook',
                    polling: '🔄 Polling',
                    card_webhook: '💳 Card Webhook',
                    card_confirm: '✅ Card Confirm',
                  };
                  return (
                    <div key={source} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{sourceLabel[source] || source}</span>
                        <span className="text-xs text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Sem dados de dedup</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Duplicates Alert */}
      {Array.isArray(report?.dedup?.duplicates) && report.dedup.duplicates.length > 0 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <CopyIcon className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <CardTitle className="text-base text-red-400">⚠️ Eventos Duplicados</CardTitle>
                <CardDescription className="text-xs">Falha de idempotência — meta_purchase_events com duplicatas</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.dedup.duplicates.map((dup, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-red-500/10 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Pedido <code className="font-mono text-xs bg-red-500/10 px-1.5 py-0.5 rounded">{dup.orderId.substring(0, 12)}</code>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      event_id: <code className="font-mono">{dup.eventId.substring(0, 30)}</code>
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <Badge variant="destructive" className="text-[10px]">{dup.count}× duplicado</Badge>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Origens: {dup.sources.join(', ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Consecutive Errors Detail */}
      {report?.consecutiveErrors && report.consecutiveErrors.maxStreak >= 3 && (
        <Card className={cn("border-border/50", report.consecutiveErrors.isOngoing ? "border-red-500/20 bg-red-500/5" : "border-orange-500/20 bg-orange-500/5")}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", report.consecutiveErrors.isOngoing ? "bg-red-500/10" : "bg-orange-500/10")}>
                <Flame className={cn("h-4 w-4", report.consecutiveErrors.isOngoing ? "text-red-500" : "text-orange-500")} />
              </div>
              <div>
                <CardTitle className={cn("text-base", report.consecutiveErrors.isOngoing ? "text-red-400" : "text-orange-400")}>
                  {report.consecutiveErrors.isOngoing ? '🔴 Falha Sistêmica em Andamento' : 'Streak de Erros Detectado'}
                </CardTitle>
                <CardDescription className="text-xs">
                  {report.consecutiveErrors.isOngoing
                    ? `${report.consecutiveErrors.currentStreak} erros seguidos sem sucesso`
                    : `Máximo de ${report.consecutiveErrors.maxStreak} erros seguidos (resolvido)`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(Array.isArray(report.consecutiveErrors.streakEvents) ? report.consecutiveErrors.streakEvents : []).map((evt, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-border/20 last:border-0">
                  <Badge variant="destructive" className="text-[10px] mt-0.5 shrink-0">{evt.status_code || 'ERR'}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{evt.event_name}</p>
                    <p className="text-xs text-muted-foreground break-all">{evt.error}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {new Date(evt.time).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Errors */}
      {Array.isArray(report?.capi?.recentErrors) && report.capi.recentErrors.length > 0 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <CardTitle className="text-base text-red-400">Erros Recentes</CardTitle>
                <CardDescription className="text-xs">Últimos erros de envio CAPI</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.capi.recentErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-red-500/10 last:border-0">
                  <Badge variant="destructive" className="text-[10px] mt-0.5 shrink-0">{err.status_code || 'ERR'}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{err.event_name} — <code className="text-xs font-mono">{err.event_id?.substring(0, 30)}</code></p>
                    <p className="text-xs text-muted-foreground break-all">{err.error}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {new Date(err.time).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Missing CAPI Coverage */}
      {Array.isArray(report?.coverage?.missingDetails) && report.coverage.missingDetails.length > 0 && (
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <CardTitle className="text-base text-orange-400">Pedidos sem CAPI</CardTitle>
                  <CardDescription className="text-xs">Pedidos pagos sem evento Purchase server-side</CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                disabled={cleaning}
                onClick={async () => {
                  try {
                    const token = requireAdminToken();
                    const orderIds = report!.coverage.missingDetails.map(m => m.orderId);
                    const res = await invokeFunction('admin-post-payment', {
                      method: 'POST',
                      headers: { 'x-admin-token': token },
                      body: { action: 'recover-dedup', order_ids: orderIds },
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      toast({ title: "Cobertura recuperada", description: `${data.created} registro(s) criados.` });
                      refetch();
                    } else {
                      toast({ title: "Erro", description: data.error || 'Falha ao recuperar', variant: "destructive" });
                    }
                  } catch (e: any) {
                    toast({ title: "Erro", description: e.message, variant: "destructive" });
                  }
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                Recuperar Cobertura
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.coverage.missingDetails.map((m, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-orange-500/10 last:border-0">
                  <div>
                    <p className="text-sm font-medium font-mono">{m.orderId.substring(0, 12)}...</p>
                    <p className="text-xs text-muted-foreground">{m.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-orange-400">
                      R$ {(m.amount || 0).toFixed(2).replace('.', ',')}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(m.paidAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
