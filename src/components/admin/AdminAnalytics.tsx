import { useQuery } from "@tanstack/react-query";
import { auth } from "@/integrations/firebase/config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, TrendingDown, Eye, ShoppingCart, 
  CreditCard, RefreshCw, ArrowDown, AlertTriangle,
  Smartphone, Monitor, Globe, DollarSign,
  Activity, Target, Zap, Tablet
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { useState, useMemo } from "react";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DEVICE_COLORS: Record<string, string> = {
  mobile: '#f97316',
  desktop: '#3b82f6', 
  tablet: '#8b5cf6'
};

const FUNNEL_EVENTS = [
  { key: 'PageView', label: 'Visualizações', icon: Eye, color: '#3b82f6' },
  { key: 'ViewContent', label: 'Viram Produto', icon: Eye, color: '#8b5cf6' },
  { key: 'AddToCart', label: 'Add ao Carrinho', icon: ShoppingCart, color: '#f97316' },
  { key: 'InitiateCheckout', label: 'Iniciaram Checkout', icon: CreditCard, color: '#eab308' },
  { key: 'Purchase', label: 'Compraram', icon: CreditCard, color: '#22c55e' },
];

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

export function AdminAnalytics() {
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('7d');
  
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

  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    FUNNEL_EVENTS.forEach(event => {
      counts[event.key] = events.filter(e => e.event_name === event.key).length;
    });
    const firstCount = counts[FUNNEL_EVENTS[0].key] || 0;
    
    return FUNNEL_EVENTS.map((event, index) => {
      const count = counts[event.key] || 0;
      const prevCount = index > 0 ? counts[FUNNEL_EVENTS[index - 1].key] || 0 : count;
      const stepConversion = index === 0 ? 100 : prevCount > 0 ? ((count / prevCount) * 100) : 0;
      const totalConversion = firstCount > 0 ? ((count / firstCount) * 100) : 0;
      const dropOff = index === 0 ? 0 : 100 - stepConversion;
      return { ...event, count, stepConversion: stepConversion.toFixed(1), totalConversion: totalConversion.toFixed(1), dropOff: dropOff.toFixed(1) };
    });
  }, [events]);

  const metrics = useMemo(() => {
    const pageViews = events.filter(e => e.event_name === 'PageView').length;
    const purchases = events.filter(e => e.event_name === 'Purchase').length;
    const addToCarts = events.filter(e => e.event_name === 'AddToCart').length;
    const revenue = events.filter(e => e.event_name === 'Purchase' && e.value).reduce((sum, e) => sum + (e.value || 0), 0);
    const overallConversion = pageViews > 0 ? ((purchases / pageViews) * 100) : 0;
    const cartToCheckout = addToCarts > 0 ? ((events.filter(e => e.event_name === 'InitiateCheckout').length / addToCarts) * 100) : 0;
    
    return {
      pageViews, purchases, addToCarts, revenue,
      overallConversion: overallConversion.toFixed(2),
      cartToCheckout: cartToCheckout.toFixed(1),
      uniqueUsers: new Set(events.filter(e => e.user_id).map(e => e.user_id)).size,
    };
  }, [events]);

  const eventsByDay = useMemo(() => {
    const days: Record<string, Record<string, number | string>> = {};
    const today = new Date();
    const daysCount = dateRange === 'today' ? 1 : dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 30;
    
    for (let i = daysCount - 1; i >= 0; i--) {
      const date = format(subDays(today, i), 'dd/MM');
      days[date] = { date, PageView: 0, ViewContent: 0, AddToCart: 0, InitiateCheckout: 0, Purchase: 0 };
    }
    
    events.forEach(event => {
      const date = format(new Date(event.event_time), 'dd/MM');
      if (days[date] && typeof days[date][event.event_name] === 'number') {
        (days[date][event.event_name] as number)++;
      }
    });
    return Object.values(days);
  }, [events, dateRange]);

  const deviceData = useMemo(() => {
    const devices: Record<string, number> = { mobile: 0, desktop: 0, tablet: 0 };
    events.forEach(e => { devices[e.device_type || 'desktop'] = (devices[e.device_type || 'desktop'] || 0) + 1; });
    return [
      { name: 'Mobile', value: devices.mobile, color: DEVICE_COLORS.mobile, icon: Smartphone },
      { name: 'Desktop', value: devices.desktop, color: DEVICE_COLORS.desktop, icon: Monitor },
      { name: 'Tablet', value: devices.tablet, color: DEVICE_COLORS.tablet, icon: Tablet },
    ].filter(d => d.value > 0);
  }, [events]);

  const topPages = useMemo(() => {
    const pages: Record<string, number> = {};
    events.filter(e => e.page_url).forEach(e => { const path = getPathname(e.page_url); pages[path] = (pages[path] || 0) + 1; });
    return Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([page, count]) => ({ page, count }));
  }, [events]);

  const topStates = useMemo(() => {
    const states: Record<string, number> = {};
    events.filter(e => e.state).forEach(e => { states[e.state!] = (states[e.state!] || 0) + 1; });
    return Object.entries(states).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([state, count]) => ({ state: state.toUpperCase(), count }));
  }, [events]);

  const biggestDropOff = useMemo(() => {
    let maxDrop = { step: '', dropOff: 0, prevStep: '' };
    funnelData.forEach((step, index) => {
      const drop = parseFloat(step.dropOff);
      if (drop > maxDrop.dropOff && index > 0) {
        maxDrop = { step: step.label, dropOff: drop, prevStep: funnelData[index - 1].label };
      }
    });
    return maxDrop;
  }, [funnelData]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando analytics...</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
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
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Visualizações', value: metrics.pageViews.toLocaleString(), icon: Eye, bgColor: 'bg-blue-500/10', textColor: 'text-blue-500' },
            { label: 'Carrinhos', value: metrics.addToCarts.toLocaleString(), icon: ShoppingCart, bgColor: 'bg-orange-500/10', textColor: 'text-orange-500' },
            { label: 'Compras', value: metrics.purchases.toString(), icon: CreditCard, bgColor: 'bg-green-500/10', textColor: 'text-green-500' },
            { label: 'Receita', value: metrics.revenue > 0 ? `R$ ${metrics.revenue.toLocaleString('pt-BR')}` : '—', icon: DollarSign, bgColor: 'bg-emerald-500/10', textColor: 'text-emerald-500' },
            { label: 'Conversão', value: `${metrics.overallConversion}%`, icon: Target, bgColor: 'bg-purple-500/10', textColor: 'text-purple-500' },
          ].map((m) => (
            <Card key={m.label} className="border-border/50 bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${m.bgColor}`}>
                    <m.icon className={`h-4 w-4 ${m.textColor}`} />
                  </div>
                  <div>
                    <p className="text-xl font-bold">{m.value}</p>
                    <p className="text-[11px] text-muted-foreground">{m.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Drop-off Alert */}
        {biggestDropOff.dropOff > 30 && events.length > 10 && (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="flex items-start gap-3 py-3">
              <div className="p-2 bg-red-500/10 rounded-lg mt-0.5 shrink-0">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  Maior abandono: {biggestDropOff.prevStep} → {biggestDropOff.step}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="text-red-400 font-medium">{biggestDropOff.dropOff.toFixed(0)}%</span> dos usuários abandonam nesse ponto
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Funnel */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Funil de Conversão</CardTitle>
                  <CardDescription className="text-xs">Etapas do processo de compra</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                <Activity className="h-3 w-3 mr-1" /> Tempo real
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {funnelData.map((step, index) => {
                const widthPct = parseFloat(step.totalConversion);
                const Icon = step.icon;
                const isLow = parseFloat(step.dropOff) > 50;

                return (
                  <div key={step.key}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${step.color}15` }}>
                        <Icon className="h-4 w-4" style={{ color: step.color }} />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-sm font-medium">{step.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold tabular-nums">{step.count.toLocaleString()}</span>
                          {index > 0 && (
                            <Badge variant={isLow ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                              {parseFloat(step.dropOff) > 0 ? (
                                <><TrendingDown className="h-3 w-3 mr-0.5" />-{step.dropOff}%</>
                              ) : (
                                <>{step.stepConversion}%</>
                              )}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="h-8 bg-muted/20 rounded-lg overflow-hidden relative">
                      <div
                        className="h-full rounded-lg transition-all duration-700 flex items-center justify-end pr-3"
                        style={{ width: `${Math.max(widthPct, 3)}%`, background: `linear-gradient(90deg, ${step.color}50, ${step.color}90)` }}
                      >
                        {widthPct >= 15 && (
                          <span className="text-[11px] font-semibold text-white drop-shadow-sm">{step.totalConversion}%</span>
                        )}
                      </div>
                      {widthPct < 15 && widthPct > 0 && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">{step.totalConversion}%</span>
                      )}
                    </div>

                    {index < funnelData.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Events Over Time */}
          <Card className="border-border/50 bg-card/50 lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base">Eventos ao Longo do Tempo</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={eventsByDay}>
                    <defs>
                      <linearGradient id="colorPV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                      <linearGradient id="colorVC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient>
                      <linearGradient id="colorAC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/><stop offset="95%" stopColor="#f97316" stopOpacity={0}/></linearGradient>
                      <linearGradient id="colorPR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} labelStyle={{ color: 'hsl(var(--foreground))' }} />
                    <Legend wrapperStyle={{ paddingTop: 8 }} iconType="circle" iconSize={8} />
                    <Area type="monotone" name="PageView" dataKey="PageView" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPV)" strokeWidth={2} />
                    <Area type="monotone" name="Produto" dataKey="ViewContent" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorVC)" strokeWidth={2} />
                    <Area type="monotone" name="Carrinho" dataKey="AddToCart" stroke="#f97316" fillOpacity={1} fill="url(#colorAC)" strokeWidth={2} />
                    <Area type="monotone" name="Compra" dataKey="Purchase" stroke="#22c55e" fillOpacity={1} fill="url(#colorPR)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Devices */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Smartphone className="h-4 w-4 text-orange-500" />
                </div>
                <CardTitle className="text-base">Dispositivos</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {deviceData.length > 0 ? (
                <div className="space-y-3">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={deviceData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                        {deviceData.map((entry, i) => (<Cell key={i} fill={entry.color} strokeWidth={0} />))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {deviceData.map((d) => {
                      const pct = events.length > 0 ? ((d.value / events.length) * 100).toFixed(0) : '0';
                      const DevIcon = d.icon;
                      return (
                        <div key={d.name} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted/20 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                            <DevIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{d.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold tabular-nums">{d.value}</span>
                            <span className="text-xs text-muted-foreground">({pct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted-foreground">Sem dados</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Top Pages */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Globe className="h-4 w-4 text-blue-500" />
                </div>
                <CardTitle className="text-base">Páginas Mais Visitadas</CardTitle>
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

          {/* Top States */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Target className="h-4 w-4 text-green-500" />
                </div>
                <CardTitle className="text-base">Estados</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-0.5">
                {topStates.length > 0 ? topStates.map((item, i) => (
                  <div key={item.state} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-4 tabular-nums">{i + 1}</span>
                      <span className="text-sm font-medium">{item.state}</span>
                    </div>
                    <Badge variant="secondary" className="tabular-nums text-[10px]">{item.count}</Badge>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-6">Sem dados de localização</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Events */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Activity className="h-4 w-4 text-purple-500" />
                </div>
                <CardTitle className="text-base">Eventos Recentes</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-0.5 max-h-[280px] overflow-y-auto pr-1">
                {events.slice(0, 15).map((event) => {
                  const cfg = FUNNEL_EVENTS.find(e => e.key === event.event_name);
                  const Icon = cfg?.icon || Eye;
                  return (
                    <div key={event.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-md shrink-0" style={{ backgroundColor: `${cfg?.color || '#666'}15` }}>
                          <Icon className="h-3 w-3" style={{ color: cfg?.color || '#666' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm truncate">{cfg?.label || event.event_name}</p>
                          {event.content_name && <p className="text-[10px] text-muted-foreground truncate">{event.content_name}</p>}
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
    </TooltipProvider>
  );
}
