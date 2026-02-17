import { useQuery } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, TrendingDown, TrendingUp, ShoppingCart, 
  CreditCard, RefreshCw, ArrowDown, AlertTriangle,
  Smartphone, Monitor, Globe, DollarSign,
  Activity, Target, Zap, Tablet, Trash2,
  Clock, Package, Users, ArrowUpRight, Percent, Eye
} from "lucide-react";
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";
import { useState, useMemo } from "react";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const DEVICE_COLORS: Record<string, string> = {
  mobile: '#f97316',
  desktop: '#3b82f6', 
  tablet: '#8b5cf6'
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome: '#4285F4',
  Safari: '#000000',
  Firefox: '#FF7139',
  Edge: '#0078D7',
  Other: '#6B7280',
};

interface AnalyticsEvent {
  id: string;
  event_name: string;
  event_time: string;
  user_id: string | null;
  page_url: string | null;
  device_type: string | null;
  browser: string | null;
  city: string | null;
  state: string | null;
  content_name: string | null;
  value: number | null;
  order_id: string | null;
  content_category: string | null;
}

function getPathname(url: string | null): string {
  if (!url) return '/';
  try { return new URL(url).pathname; } catch {
    const match = url.match(/^https?:\/\/[^\/]+(\/[^?#]*)?/);
    return match?.[1] || url;
  }
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AdminAnalytics() {
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const [cleanupFrom, setCleanupFrom] = useState('');
  const [cleanupTo, setCleanupTo] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{ total: number; by_event: Record<string, number> } | null>(null);
  
  const { data: events = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['analytics-events', dateRange],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      
      const firebaseToken = await currentUser.getIdToken();
      const { invokeFunction } = await import("@/lib/apiHelper");
      
      const response = await invokeFunction("admin-analytics", {
        method: "GET",
        queryParams: { dateRange },
        headers: { "x-firebase-token": firebaseToken },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch analytics');
      }
      
      const data = await response.json();
      return (data.events || []) as AnalyticsEvent[];
    },
    refetchInterval: 30000,
  });

  const handleCleanupPreview = async () => {
    if (!cleanupFrom && !cleanupTo) { toast.error("Selecione pelo menos uma data"); return; }
    setCleanupLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const { invokeFunction } = await import("@/lib/apiHelper");
      const res = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "cleanup-analytics" },
        headers: { "x-firebase-token": token },
        body: {
          after_date: cleanupFrom ? new Date(cleanupFrom).toISOString() : undefined,
          before_date: cleanupTo ? new Date(cleanupTo + 'T23:59:59').toISOString() : undefined,
          dry_run: true,
        },
      });
      const data = await res.json();
      if (data.dry_run) setPreviewData(data);
      else toast.error(data.error || "Erro ao previsar");
    } catch (e: any) { toast.error(e.message); }
    finally { setCleanupLoading(false); }
  };

  const handleCleanupConfirm = async () => {
    setCleanupLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const { invokeFunction } = await import("@/lib/apiHelper");
      const res = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "cleanup-analytics" },
        headers: { "x-firebase-token": token },
        body: {
          after_date: cleanupFrom ? new Date(cleanupFrom).toISOString() : undefined,
          before_date: cleanupTo ? new Date(cleanupTo + 'T23:59:59').toISOString() : undefined,
          dry_run: false,
        },
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.deleted} eventos removidos com sucesso`);
        setPreviewData(null);
        setCleanupFrom('');
        setCleanupTo('');
        refetch();
      } else toast.error(data.error || "Erro");
    } catch (e: any) { toast.error(e.message); }
    finally { setCleanupLoading(false); }
  };

  // ── Computed Metrics ──────────────────────────────────────────────
  const metrics = useMemo(() => {
    const views = events.filter(e => e.event_name === 'ViewContent');
    const checkouts = events.filter(e => e.event_name === 'InitiateCheckout');
    const purchases = events.filter(e => e.event_name === 'Purchase');
    const revenue = purchases.reduce((sum, e) => sum + (e.value || 0), 0);
    const avgTicket = purchases.length > 0 ? revenue / purchases.length : 0;
    const conversionRate = checkouts.length > 0 ? (purchases.length / checkouts.length) * 100 : 0;
    const viewToCheckout = views.length > 0 ? (checkouts.length / views.length) * 100 : 0;
    const uniqueUsers = new Set(events.filter(e => e.user_id).map(e => e.user_id)).size;
    const dropOff = checkouts.length > 0 ? ((checkouts.length - purchases.length) / checkouts.length) * 100 : 0;
    
    return {
      views: views.length,
      checkouts: checkouts.length,
      purchases: purchases.length,
      revenue,
      avgTicket,
      conversionRate,
      viewToCheckout,
      uniqueUsers,
      dropOff,
    };
  }, [events]);

  // ── Revenue by Day ────────────────────────────────────────────────
  const revenueByDay = useMemo(() => {
    const days: Record<string, { date: string; revenue: number; purchases: number; checkouts: number }> = {};
    const today = new Date();
    const daysCount = dateRange === 'today' ? 24 : dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 30;
    const isHourly = dateRange === 'today';
    
    if (isHourly) {
      for (let h = 0; h < 24; h++) {
        const label = `${h.toString().padStart(2, '0')}h`;
        days[label] = { date: label, revenue: 0, purchases: 0, checkouts: 0 };
      }
    } else {
      for (let i = daysCount - 1; i >= 0; i--) {
        const date = format(subDays(today, i), 'dd/MM');
        days[date] = { date, revenue: 0, purchases: 0, checkouts: 0 };
      }
    }
    
    events.forEach(event => {
      const eventDate = new Date(event.event_time);
      const key = isHourly
        ? `${eventDate.getHours().toString().padStart(2, '0')}h`
        : format(eventDate, 'dd/MM');
      if (days[key]) {
        if (event.event_name === 'Purchase') {
          days[key].revenue += event.value || 0;
          days[key].purchases++;
        }
        if (event.event_name === 'InitiateCheckout') {
          days[key].checkouts++;
        }
      }
    });
    return Object.values(days);
  }, [events, dateRange]);

  // ── Hourly Activity ───────────────────────────────────────────────
  const hourlyData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, '0')}h`,
      checkouts: 0,
      purchases: 0,
    }));
    
    events.forEach(event => {
      const hour = new Date(event.event_time).getHours();
      if (event.event_name === 'InitiateCheckout') hours[hour].checkouts++;
      if (event.event_name === 'Purchase') hours[hour].purchases++;
    });
    return hours;
  }, [events]);

  // ── Peak Hour ─────────────────────────────────────────────────────
  const peakHour = useMemo(() => {
    let max = { hour: '—', count: 0 };
    hourlyData.forEach(h => {
      const total = h.checkouts + h.purchases;
      if (total > max.count) max = { hour: h.hour, count: total };
    });
    return max;
  }, [hourlyData]);

  // ── Device Breakdown ──────────────────────────────────────────────
  const deviceData = useMemo(() => {
    const devices: Record<string, { total: number; purchases: number }> = {};
    events.forEach(e => {
      const d = e.device_type || 'desktop';
      if (!devices[d]) devices[d] = { total: 0, purchases: 0 };
      devices[d].total++;
      if (e.event_name === 'Purchase') devices[d].purchases++;
    });
    return [
      { name: 'Mobile', ...devices.mobile || { total: 0, purchases: 0 }, color: DEVICE_COLORS.mobile, icon: Smartphone },
      { name: 'Desktop', ...devices.desktop || { total: 0, purchases: 0 }, color: DEVICE_COLORS.desktop, icon: Monitor },
      { name: 'Tablet', ...devices.tablet || { total: 0, purchases: 0 }, color: DEVICE_COLORS.tablet, icon: Tablet },
    ].filter(d => d.total > 0);
  }, [events]);

  // ── Browser Breakdown ─────────────────────────────────────────────
  const browserData = useMemo(() => {
    const browsers: Record<string, number> = {};
    events.forEach(e => {
      const b = e.browser || 'Other';
      browsers[b] = (browsers[b] || 0) + 1;
    });
    return Object.entries(browsers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value, color: BROWSER_COLORS[name] || '#6B7280' }));
  }, [events]);

  // ── Top Products ──────────────────────────────────────────────────
  const topProducts = useMemo(() => {
    const products: Record<string, { count: number; revenue: number }> = {};
    events
      .filter(e => e.event_name === 'Purchase' && e.content_name)
      .forEach(e => {
        const name = e.content_name!;
        if (!products[name]) products[name] = { count: 0, revenue: 0 };
        products[name].count++;
        products[name].revenue += e.value || 0;
      });
    return Object.entries(products)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 8)
      .map(([name, data]) => ({ name, ...data }));
  }, [events]);

  // ── Top Pages ─────────────────────────────────────────────────────
  const topPages = useMemo(() => {
    const pages: Record<string, number> = {};
    events.filter(e => e.page_url).forEach(e => {
      const path = getPathname(e.page_url);
      pages[path] = (pages[path] || 0) + 1;
    });
    return Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([page, count]) => ({ page, count }));
  }, [events]);

  // ── Conversion by Device ──────────────────────────────────────────
  const conversionByDevice = useMemo(() => {
    const data: Record<string, { checkouts: number; purchases: number }> = {};
    events.forEach(e => {
      const d = e.device_type || 'desktop';
      if (!data[d]) data[d] = { checkouts: 0, purchases: 0 };
      if (e.event_name === 'InitiateCheckout') data[d].checkouts++;
      if (e.event_name === 'Purchase') data[d].purchases++;
    });
    return Object.entries(data).map(([device, d]) => ({
      device: device.charAt(0).toUpperCase() + device.slice(1),
      rate: d.checkouts > 0 ? ((d.purchases / d.checkouts) * 100) : 0,
      checkouts: d.checkouts,
      purchases: d.purchases,
    }));
  }, [events]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Analytics
            {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          </h2>
          <p className="text-sm text-muted-foreground">
            {events.length.toLocaleString()} eventos • Atualiza a cada 30s
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
            <TabsList className="bg-muted/50 h-9">
              <TabsTrigger value="today" className="text-xs">Hoje</TabsTrigger>
              <TabsTrigger value="7d" className="text-xs">7 dias</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs">30 dias</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Cleanup Dialog */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" title="Limpar eventos spam">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar Eventos de Analytics</AlertDialogTitle>
                <AlertDialogDescription>
                  Remova eventos de spam/invasor por período. Esta ação é irreversível.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">De (início)</Label>
                    <Input type="date" value={cleanupFrom} onChange={e => setCleanupFrom(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Até (fim)</Label>
                    <Input type="date" value={cleanupTo} onChange={e => setCleanupTo(e.target.value)} />
                  </div>
                </div>
                {previewData && (
                  <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 text-sm space-y-1">
                    <p className="font-semibold text-destructive">{previewData.total} eventos serão deletados:</p>
                    {Object.entries(previewData.by_event).map(([name, count]) => (
                      <p key={name} className="text-muted-foreground text-xs">• {name}: {count}</p>
                    ))}
                  </div>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setPreviewData(null)}>Cancelar</AlertDialogCancel>
                {!previewData ? (
                  <Button onClick={handleCleanupPreview} disabled={cleanupLoading}>
                    {cleanupLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
                    Prévia
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={handleCleanupConfirm} disabled={cleanupLoading}>
                    {cleanupLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
                    Confirmar Exclusão ({previewData.total})
                  </Button>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { 
            label: 'Visualizações', 
            value: metrics.views.toLocaleString(), 
            icon: Eye, 
            bgColor: 'bg-cyan-500/10', 
            textColor: 'text-cyan-500',
            subtitle: metrics.viewToCheckout > 0 ? `${metrics.viewToCheckout.toFixed(1)}% → checkout` : null,
          },
          { 
            label: 'Receita', 
            value: metrics.revenue > 0 ? formatCurrency(metrics.revenue) : 'R$ 0', 
            icon: DollarSign, 
            bgColor: 'bg-emerald-500/10', 
            textColor: 'text-emerald-500',
            subtitle: metrics.purchases > 0 ? `${metrics.purchases} vendas` : null,
          },
          { 
            label: 'Ticket Médio', 
            value: metrics.avgTicket > 0 ? formatCurrency(metrics.avgTicket) : '—', 
            icon: Target, 
            bgColor: 'bg-blue-500/10', 
            textColor: 'text-blue-500',
            subtitle: null,
          },
          { 
            label: 'Conversão', 
            value: `${metrics.conversionRate.toFixed(1)}%`, 
            icon: Percent, 
            bgColor: metrics.conversionRate >= 10 ? 'bg-green-500/10' : metrics.conversionRate >= 5 ? 'bg-yellow-500/10' : 'bg-red-500/10', 
            textColor: metrics.conversionRate >= 10 ? 'text-green-500' : metrics.conversionRate >= 5 ? 'text-yellow-500' : 'text-red-500',
            subtitle: `${metrics.checkouts} → ${metrics.purchases}`,
          },
          { 
            label: 'Checkouts', 
            value: metrics.checkouts.toLocaleString(), 
            icon: ShoppingCart, 
            bgColor: 'bg-yellow-500/10', 
            textColor: 'text-yellow-500',
            subtitle: null,
          },
          { 
            label: 'Horário Pico', 
            value: peakHour.hour, 
            icon: Clock, 
            bgColor: 'bg-purple-500/10', 
            textColor: 'text-purple-500',
            subtitle: peakHour.count > 0 ? `${peakHour.count} eventos` : null,
          },
        ].map((m) => (
          <Card key={m.label} className="border-border/40 bg-card/80">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-xl ${m.bgColor} shrink-0`}>
                  <m.icon className={`h-4 w-4 ${m.textColor}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{m.label}</p>
                  <p className="text-lg font-bold truncate mt-0.5">{m.value}</p>
                  {m.subtitle && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{m.subtitle}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Drop-off Alert ───────────────────────────────────────── */}
      {metrics.dropOff > 30 && metrics.checkouts > 5 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-start gap-3 py-3 px-4">
            <div className="p-2 bg-red-500/10 rounded-xl mt-0.5 shrink-0">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">
                {metrics.dropOff.toFixed(0)}% abandono no checkout
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {metrics.checkouts - metrics.purchases} pessoas iniciaram o checkout mas não concluíram a compra
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Funnel: Checkout → Purchase ──────────────────────────── */}
      <Card className="border-border/40 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Funil de Conversão</CardTitle>
                <CardDescription className="text-xs">Visualização → Checkout → Compra</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">
              <Activity className="h-3 w-3 mr-1" /> Tempo real
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* ViewContent */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/10">
                  <Eye className="h-4 w-4 text-cyan-500" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-medium">Viram Produto</span>
                  <span className="text-lg font-bold tabular-nums">{metrics.views.toLocaleString()}</span>
                </div>
              </div>
              <div className="h-9 bg-muted/20 rounded-lg overflow-hidden">
                <div className="h-full rounded-lg bg-gradient-to-r from-cyan-500/50 to-cyan-500/80 flex items-center justify-end pr-3" style={{ width: '100%' }}>
                  <span className="text-[11px] font-semibold text-foreground">100%</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="flex items-center gap-2">
                <ArrowDown className="h-4 w-4 text-muted-foreground/40" />
                {metrics.viewToCheckout > 0 && metrics.viewToCheckout < 100 && (
                  <Badge variant="outline" className="text-[10px]">
                    <TrendingDown className="h-3 w-3 mr-0.5" />
                    -{(100 - metrics.viewToCheckout).toFixed(0)}%
                  </Badge>
                )}
              </div>
            </div>

            {/* InitiateCheckout */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-1.5 rounded-lg bg-yellow-500/10">
                  <ShoppingCart className="h-4 w-4 text-yellow-500" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-medium">Iniciaram Checkout</span>
                  <span className="text-lg font-bold tabular-nums">{metrics.checkouts.toLocaleString()}</span>
                </div>
              </div>
                <div className="h-9 bg-muted/20 rounded-lg overflow-hidden">
                <div className="h-full rounded-lg bg-gradient-to-r from-yellow-500/50 to-yellow-500/80 flex items-center justify-end pr-3 transition-all duration-700" style={{ width: `${metrics.views > 0 ? Math.max((metrics.checkouts / metrics.views) * 100, 3) : (metrics.checkouts > 0 ? 100 : 3)}%` }}>
                  <span className="text-[11px] font-semibold text-foreground">{metrics.views > 0 ? `${metrics.viewToCheckout.toFixed(1)}%` : '—'}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="flex items-center gap-2">
                <ArrowDown className="h-4 w-4 text-muted-foreground/40" />
                {metrics.dropOff > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    <TrendingDown className="h-3 w-3 mr-0.5" />
                    -{metrics.dropOff.toFixed(0)}%
                  </Badge>
                )}
              </div>
            </div>

            {/* Purchase */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-1.5 rounded-lg bg-green-500/10">
                  <CreditCard className="h-4 w-4 text-green-500" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-medium">Compraram</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold tabular-nums">{metrics.purchases.toLocaleString()}</span>
                    {metrics.revenue > 0 && (
                      <span className="text-xs text-emerald-500 font-medium">{formatCurrency(metrics.revenue)}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="h-9 bg-muted/20 rounded-lg overflow-hidden relative">
                <div 
                  className="h-full rounded-lg bg-gradient-to-r from-green-500/50 to-green-500/80 flex items-center justify-end pr-3 transition-all duration-700" 
                  style={{ width: `${Math.max(metrics.conversionRate, 3)}%` }}
                >
                  {metrics.conversionRate >= 12 && (
                    <span className="text-[11px] font-semibold text-foreground">{metrics.conversionRate.toFixed(1)}%</span>
                  )}
                </div>
                {metrics.conversionRate < 12 && metrics.conversionRate > 0 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">
                    {metrics.conversionRate.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Charts Row 1: Revenue + Hourly Activity ──────────────── */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Revenue Over Time */}
        <Card className="border-border/40 bg-card/80 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <CardTitle className="text-base">Receita por Dia</CardTitle>
                <CardDescription className="text-xs">Receita e quantidade de vendas</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(v) => `R$${v}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))', 
                      borderRadius: '12px', 
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)' 
                    }} 
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number, name: string) => {
                      if (name === 'Receita') return [formatCurrency(value), name];
                      return [value, name];
                    }}
                  />
                  <Area 
                    type="monotone" 
                    name="Receita" 
                    dataKey="revenue" 
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Hourly Activity */}
        <Card className="border-border/40 bg-card/80 lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-base">Atividade por Hora</CardTitle>
                <CardDescription className="text-xs">Quando seus clientes compram</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis 
                    dataKey="hour" 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={9} 
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))', 
                      borderRadius: '12px' 
                    }} 
                  />
                  <Bar name="Checkouts" dataKey="checkouts" fill="#eab308" radius={[2, 2, 0, 0]} />
                  <Bar name="Compras" dataKey="purchases" fill="#22c55e" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 2: Checkout vs Purchases + Conversion by Device */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Checkouts vs Purchases Over Time */}
        <Card className="border-border/40 bg-card/80 lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Checkouts vs Compras</CardTitle>
                <CardDescription className="text-xs">Compare o funil ao longo do tempo</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="colorCheckouts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#eab308" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} 
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Area type="monotone" name="Checkouts" dataKey="checkouts" stroke="#eab308" fillOpacity={1} fill="url(#colorCheckouts)" strokeWidth={2} />
                  <Area type="monotone" name="Compras" dataKey="purchases" stroke="#22c55e" fillOpacity={1} fill="url(#colorPurchases)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Conversion by Device */}
        <Card className="border-border/40 bg-card/80 lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Smartphone className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <CardTitle className="text-base">Conversão por Dispositivo</CardTitle>
                <CardDescription className="text-xs">Onde seus clientes convertem melhor</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {conversionByDevice.length > 0 ? conversionByDevice.map((d) => {
                const rateColor = d.rate >= 15 ? 'text-green-500' : d.rate >= 5 ? 'text-yellow-500' : 'text-red-500';
                const barColor = d.rate >= 15 ? 'bg-green-500' : d.rate >= 5 ? 'bg-yellow-500' : 'bg-red-500';
                return (
                  <div key={d.device}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium">{d.device}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${rateColor}`}>{d.rate.toFixed(1)}%</span>
                        <span className="text-[10px] text-muted-foreground">{d.checkouts}→{d.purchases}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor} transition-all duration-700`} style={{ width: `${Math.min(d.rate, 100)}%` }} />
                    </div>
                  </div>
                );
              }) : (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
              )}

              {/* Device pie chart */}
              {deviceData.length > 0 && (
                <>
                  <div className="border-t border-border/30 pt-3 mt-3">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Tráfego</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-24 h-24 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={deviceData} cx="50%" cy="50%" innerRadius={22} outerRadius={38} paddingAngle={3} dataKey="total">
                            {deviceData.map((entry, i) => (<Cell key={i} fill={entry.color} strokeWidth={0} />))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1.5 flex-1">
                      {deviceData.map((d) => {
                        const pct = events.length > 0 ? ((d.total / events.length) * 100).toFixed(0) : '0';
                        return (
                          <div key={d.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                              <span className="text-xs">{d.name}</span>
                            </div>
                            <span className="text-xs font-medium tabular-nums">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom Row: Products + Pages + Browsers + Recent ─────── */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Top Products */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Package className="h-4 w-4 text-emerald-500" />
              </div>
              <CardTitle className="text-base">Top Produtos</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              {topProducts.length > 0 ? topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-sm truncate" title={p.name}>{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="tabular-nums text-[10px]">{p.count}x</Badge>
                    <span className="text-[10px] text-emerald-500 font-medium">{formatCurrency(p.revenue)}</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-6">Sem vendas</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Pages */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Globe className="h-4 w-4 text-blue-500" />
              </div>
              <CardTitle className="text-base">Top Páginas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              {topPages.length > 0 ? topPages.map((page, i) => (
                <div key={page.page} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-sm truncate" title={page.page}>{page.page === '/' ? 'Home' : page.page}</span>
                  </div>
                  <Badge variant="secondary" className="shrink-0 tabular-nums text-[10px]">{page.count}</Badge>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Browsers */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-sky-500/10 flex items-center justify-center">
                <Globe className="h-4 w-4 text-sky-500" />
              </div>
              <CardTitle className="text-base">Navegadores</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {browserData.length > 0 ? browserData.map((b) => {
                const pct = events.length > 0 ? ((b.value / events.length) * 100) : 0;
                return (
                  <div key={b.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">{b.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold tabular-nums">{b.value}</span>
                        <span className="text-[10px] text-muted-foreground">({pct.toFixed(0)}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                    </div>
                  </div>
                );
              }) : (
                <p className="text-sm text-muted-foreground text-center py-6">Sem dados</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-purple-500" />
              </div>
              <CardTitle className="text-base">Eventos Recentes</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5 max-h-[280px] overflow-y-auto pr-1">
              {events.slice(0, 15).map((event) => {
                const isPurchase = event.event_name === 'Purchase';
                const isCheckout = event.event_name === 'InitiateCheckout';
                const Icon = isPurchase ? CreditCard : isCheckout ? ShoppingCart : Activity;
                const color = isPurchase ? '#22c55e' : isCheckout ? '#eab308' : '#6B7280';
                return (
                  <div key={event.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1.5 rounded-md shrink-0" style={{ backgroundColor: `${color}15` }}>
                        <Icon className="h-3 w-3" style={{ color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm truncate">
                          {isPurchase ? 'Compra' : isCheckout ? 'Checkout' : event.event_name}
                        </p>
                        {event.value && isPurchase && (
                          <p className="text-[10px] text-emerald-500 font-medium">{formatCurrency(event.value)}</p>
                        )}
                        {event.content_name && (
                          <p className="text-[10px] text-muted-foreground truncate">{event.content_name}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {formatDistanceToNow(new Date(event.event_time), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                );
              })}
              {events.length === 0 && (
                <div className="text-center py-8">
                  <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum evento ainda</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}