import { useQuery } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { invokeFunction } from "@/lib/apiHelper";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";
import {
  TrendingUp, ShoppingCart,
  CreditCard, RefreshCw,
  Smartphone, Monitor, Globe, DollarSign,
  Activity, Target, Tablet, Trash2,
  Clock, Package, Percent, Eye
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminErrorState } from "./AdminErrorState";

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
    const match = url.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
    return match?.[2] || url;
  }
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AdminAnalytics() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{ total: number; by_event: Record<string, number> } | null>(null);

  const { data: events = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['analytics-events', dateRange],
    queryFn: async () => {
      const token = requireAdminToken();

      const response = await invokeFunction("admin-analytics", {
        method: "GET",
        queryParams: { dateRange },
        headers: { "x-admin-token": token },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch analytics');
      }

      const data = await response.json();
      return (Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : []) as AnalyticsEvent[];
    },
    enabled: isAdmin && !authLoading,
    refetchInterval: isAdmin ? 120_000 : false,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const handleCleanupPreview = async () => {
    setCleanupLoading(true);
    try {
      const token = requireAdminToken();
      const res = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "cleanup-analytics" },
        headers: { "x-admin-token": token },
        body: {
          after_date: "2000-01-01T00:00:00Z",
          before_date: new Date(Date.now() + 86400_000).toISOString(),
          dry_run: true,
        },
      });
      const data = await res.json();
      if (data.dry_run) setPreviewData(data);
      else toast.error(data.error || "Erro ao prever");
    } catch (e: any) { toast.error(e.message); }
    finally { setCleanupLoading(false); }
  };

  const handleCleanupConfirm = async () => {
    setCleanupLoading(true);
    try {
      const token = requireAdminToken();
      const res = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "cleanup-analytics" },
        headers: { "x-admin-token": token },
        body: {
          after_date: "2000-01-01T00:00:00Z",
          before_date: new Date(Date.now() + 86400_000).toISOString(),
          dry_run: false,
        },
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.deleted} eventos removidos com sucesso`);
        setPreviewData(null);
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
    // Build product ID → name map from events that have content_name
    const productNames: Record<string, string> = {};
    events.forEach(e => {
      if (e.page_url) {
        const path = getPathname(e.page_url);
        pages[path] = (pages[path] || 0) + 1;
        // Extract product ID and map to content_name
        const productMatch = path.match(/^\/product\/([a-f0-9-]+)/i);
        if (productMatch && e.content_name) {
          productNames[productMatch[1]] = e.content_name;
        }
      }
    });

    return Object.entries(pages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([page, count]) => {
        const productMatch = page.match(/^\/product\/([a-f0-9-]+)/i);
        let label = page;
        let type: 'home' | 'product' | 'checkout' | 'category' | 'other' = 'other';

        if (page === '/' || page === '') {
          label = 'Página Inicial';
          type = 'home';
        } else if (page === '/checkout') {
          label = 'Checkout';
          type = 'checkout';
        } else if (page === '/cart') {
          label = 'Carrinho';
          type = 'checkout';
        } else if (page.startsWith('/category/')) {
          label = page.replace('/category/', '').replace(/-/g, ' ');
          label = label.charAt(0).toUpperCase() + label.slice(1);
          type = 'category';
        } else if (productMatch) {
          label = productNames[productMatch[1]] || `Produto ${productMatch[1].slice(0, 6)}…`;
          type = 'product';
        }

        return { page, label, count, type };
      });
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

  if (isError) {
    return <AdminErrorState title="Erro ao carregar analytics" message="Não foi possível carregar os dados de analytics. Verifique sua conexão e tente novamente." onRetry={() => refetch()} retrying={isFetching} />;
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
            {events.length.toLocaleString()} eventos • Atualiza a cada 2min
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
                <AlertDialogTitle>Limpar Todos os Eventos</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove todos os eventos de analytics. Esta ação é irreversível.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {previewData && (
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 text-sm space-y-1">
                  <p className="font-semibold text-destructive">{previewData.total} eventos serão deletados:</p>
                  {Object.entries(previewData.by_event || {}).map(([name, count]) => (
                    <p key={name} className="text-muted-foreground text-xs">• {name}: {String(count)}</p>
                  ))}
                </div>
              )}
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
                    Confirmar ({previewData.total})
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
            borderColor: 'border-cyan-500/20',
          },
          {
            label: 'Checkouts',
            value: metrics.checkouts.toLocaleString(),
            icon: ShoppingCart,
            bgColor: 'bg-blue-500/10',
            textColor: 'text-blue-500',
            borderColor: 'border-blue-500/20',
          },
          {
            label: 'Compras',
            value: metrics.purchases.toLocaleString(),
            icon: CreditCard,
            bgColor: 'bg-green-500/10',
            textColor: 'text-green-500',
            borderColor: 'border-green-500/20',
          },
          {
            label: 'Receita',
            value: formatCurrency(metrics.revenue),
            icon: DollarSign,
            bgColor: 'bg-success/10',
            textColor: 'text-success',
            borderColor: 'border-success/20',
          },
          {
            label: 'Ticket Médio',
            value: formatCurrency(metrics.avgTicket),
            icon: Target,
            bgColor: 'bg-purple-500/10',
            textColor: 'text-purple-500',
            borderColor: 'border-purple-500/20',
          },
          {
            label: 'Conversão',
            value: `${metrics.conversionRate.toFixed(1)}%`,
            icon: Percent,
            bgColor: 'bg-yellow-500/10',
            textColor: 'text-yellow-500',
            borderColor: 'border-yellow-500/20',
          },
        ].map(({ label, value, icon: Icon, bgColor, textColor, borderColor }) => (
          <Card key={label} className={`${bgColor} border ${borderColor}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${textColor}`} />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
              </div>
              <p className={`text-lg font-bold ${textColor}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Secondary Stats ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase">View → Checkout</span>
            <p className="text-lg font-bold text-foreground">{metrics.viewToCheckout.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Drop-off</span>
            <p className="text-lg font-bold text-red-500">{metrics.dropOff.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Visitantes Únicos</span>
            <p className="text-lg font-bold text-foreground">{metrics.uniqueUsers}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <span className="text-[10px] text-muted-foreground uppercase">Horário Pico</span>
            <p className="text-lg font-bold text-foreground">{peakHour.hour}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue Chart ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Receita & Conversões</CardTitle>
          <CardDescription className="text-xs">
            {dateRange === 'today' ? 'Por hora' : 'Por dia'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={revenueByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: number, name: string) => [
                  name === 'revenue' ? formatCurrency(value) : value,
                  name === 'revenue' ? 'Receita' : name === 'purchases' ? 'Compras' : 'Checkouts'
                ]}
              />
              <Area type="monotone" dataKey="revenue" fill="hsl(142, 76%, 36%)" fillOpacity={0.1} stroke="hsl(142, 76%, 36%)" strokeWidth={2} />
              <Area type="monotone" dataKey="purchases" fill="hsl(217, 91%, 60%)" fillOpacity={0.1} stroke="hsl(217, 91%, 60%)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="checkouts" fill="hsl(38, 92%, 50%)" fillOpacity={0.05} stroke="hsl(38, 92%, 50%)" strokeWidth={1} strokeDasharray="4 4" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Hourly Activity ──────────────────────────────────────── */
      }
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Atividade por Hora
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
              <Bar dataKey="checkouts" fill="hsl(38, 92%, 50%)" radius={[2, 2, 0, 0]} name="Checkouts" />
              <Bar dataKey="purchases" fill="hsl(142, 76%, 36%)" radius={[2, 2, 0, 0]} name="Compras" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Device & Browser ─────────────────────────────────────── */
      }
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dispositivos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {deviceData.map(d => {
                const Icon = d.icon;
                const pct = events.length > 0 ? ((d.total / events.length) * 100).toFixed(1) : '0';
                return (
                  <div key={d.name} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${d.color}20` }}>
                      <Icon className="w-4 h-4" style={{ color: d.color }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground">{d.total} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Navegadores</CardTitle>
          </CardHeader>
          <CardContent>
            {browserData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={browserData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={2}>
                      {browserData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 flex-1">
                  {browserData.map(b => (
                    <div key={b.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                      <span className="flex-1">{b.name}</span>
                      <span className="text-muted-foreground font-mono">{b.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Top Products & Pages ─────────────────────────────────── */
      }
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4" /> Top Produtos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              <div className="space-y-2">
                {topProducts.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-muted-foreground text-xs font-mono">{i + 1}.</span>
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-muted-foreground text-xs">{p.count}x</span>
                    <span className="text-green-500 font-medium text-xs">{formatCurrency(p.revenue)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Sem vendas no período</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4" /> Páginas Mais Visitadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPages.length > 0 ? (
              <div className="space-y-2">
                {topPages.map((p, i) => {
                  const iconMap = {
                    home: '🏠',
                    product: '📦',
                    checkout: '💳',
                    category: '📁',
                    other: '📄',
                  };
                  return (
                    <div key={p.page} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-muted-foreground text-xs font-mono">{i + 1}.</span>
                      <span className="text-xs">{iconMap[p.type]}</span>
                      <span className="flex-1 truncate text-xs font-medium">{p.label}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{p.count}</Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Conversion by Device ─────────────────────────────────── */
      }
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4" /> Conversão por Dispositivo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {conversionByDevice.map(d => (
              <div key={d.device} className="bg-muted/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">{d.device}</p>
                <p className="text-2xl font-bold">{d.rate.toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground">{d.purchases}/{d.checkouts} checkouts</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
