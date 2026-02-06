import { useQuery } from "@tanstack/react-query";
 import { auth } from "@/integrations/firebase/config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, TrendingUp, TrendingDown, Users, Eye, ShoppingCart, 
  CreditCard, RefreshCw, ArrowDown, AlertTriangle,
  Smartphone, Monitor, Globe, DollarSign, UserCheck, Tablet,
  Activity, Target, Zap
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { useState, useMemo } from "react";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const DEVICE_COLORS = {
  mobile: '#f97316',
  desktop: '#3b82f6', 
  tablet: '#8b5cf6'
};

const FUNNEL_EVENTS = [
  { key: 'PageView', label: 'Visualizações', icon: Eye, color: '#3b82f6', gradient: 'from-blue-500/20 to-blue-600/10' },
  { key: 'ViewContent', label: 'Viram Produto', icon: Eye, color: '#8b5cf6', gradient: 'from-purple-500/20 to-purple-600/10' },
  { key: 'AddToCart', label: 'Add ao Carrinho', icon: ShoppingCart, color: '#f97316', gradient: 'from-orange-500/20 to-orange-600/10' },
  { key: 'InitiateCheckout', label: 'Iniciaram Checkout', icon: CreditCard, color: '#eab308', gradient: 'from-yellow-500/20 to-yellow-600/10' },
  { key: 'Purchase', label: 'Compraram', icon: CreditCard, color: '#22c55e', gradient: 'from-green-500/20 to-green-600/10' },
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

// Safe URL pathname extraction
function getPathname(url: string | null): string {
  if (!url) return '/';
  try {
    return new URL(url).pathname;
  } catch {
    // If URL is invalid, try to extract path manually
    const match = url.match(/^https?:\/\/[^\/]+(\/[^?#]*)?/);
    return match?.[1] || url;
  }
}

export function AdminAnalytics() {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('7d');
  
  const { data: events = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['analytics-events', dateRange],
    queryFn: async () => {
       // Get Firebase token for authentication
       const currentUser = auth.currentUser;
       if (!currentUser) {
         throw new Error('User not authenticated');
       }
       
       const firebaseToken = await currentUser.getIdToken();
       
       const response = await fetch(
         `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-analytics?dateRange=${dateRange}`,
         {
           headers: {
             'Content-Type': 'application/json',
             'x-firebase-token': firebaseToken,
           },
         }
       );
      
       if (!response.ok) {
         const error = await response.json();
         throw new Error(error.error || 'Failed to fetch analytics');
      }
      
       const data = await response.json();
       return (data.events || []) as AnalyticsEvent[];
    },
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  // Calculate funnel data with proper conversion rates
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
      
      return {
        ...event,
        count,
        stepConversion: stepConversion.toFixed(1),
        totalConversion: totalConversion.toFixed(1),
        dropOff: dropOff.toFixed(1),
      };
    });
  }, [events]);

  // Key metrics
  const metrics = useMemo(() => {
    const pageViews = events.filter(e => e.event_name === 'PageView').length;
    const purchases = events.filter(e => e.event_name === 'Purchase').length;
    const addToCarts = events.filter(e => e.event_name === 'AddToCart').length;
    const leads = events.filter(e => e.event_name === 'Lead' || e.event_name === 'CompleteRegistration').length;
    const revenue = events
      .filter(e => e.event_name === 'Purchase' && e.value)
      .reduce((sum, e) => sum + (e.value || 0), 0);
    
    const overallConversion = pageViews > 0 ? ((purchases / pageViews) * 100) : 0;
    const cartToCheckout = addToCarts > 0 
      ? ((events.filter(e => e.event_name === 'InitiateCheckout').length / addToCarts) * 100) 
      : 0;
    
    return {
      pageViews,
      purchases,
      addToCarts,
      leads,
      revenue,
      overallConversion: overallConversion.toFixed(2),
      cartToCheckout: cartToCheckout.toFixed(1),
      uniqueUsers: new Set(events.filter(e => e.user_id).map(e => e.user_id)).size,
    };
  }, [events]);

  // Events by day for chart
  const eventsByDay = useMemo(() => {
    const days: Record<string, Record<string, number | string>> = {};
    const today = new Date();
    const daysCount = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 30;
    
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

  // Device breakdown
  const deviceData = useMemo(() => {
    const devices: Record<string, number> = { mobile: 0, desktop: 0, tablet: 0 };
    events.forEach(e => {
      const device = e.device_type || 'desktop';
      devices[device] = (devices[device] || 0) + 1;
    });
    return [
      { name: 'Mobile', value: devices.mobile, color: DEVICE_COLORS.mobile },
      { name: 'Desktop', value: devices.desktop, color: DEVICE_COLORS.desktop },
      { name: 'Tablet', value: devices.tablet, color: DEVICE_COLORS.tablet },
    ].filter(d => d.value > 0);
  }, [events]);

  // Top pages - with safe URL parsing
  const topPages = useMemo(() => {
    const pages: Record<string, number> = {};
    events.filter(e => e.page_url).forEach(e => {
      const path = getPathname(e.page_url);
      pages[path] = (pages[path] || 0) + 1;
    });
    return Object.entries(pages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([page, count]) => ({ page, count }));
  }, [events]);

  // Top states
  const topStates = useMemo(() => {
    const states: Record<string, number> = {};
    events.filter(e => e.state).forEach(e => {
      states[e.state!] = (states[e.state!] || 0) + 1;
    });
    return Object.entries(states)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([state, count]) => ({ state: state.toUpperCase(), count }));
  }, [events]);

  // Find biggest drop-off point
  const biggestDropOff = useMemo(() => {
    let maxDrop = { step: '', dropOff: 0, index: 0, prevStep: '' };
    funnelData.forEach((step, index) => {
      const drop = parseFloat(step.dropOff);
      if (drop > maxDrop.dropOff && index > 0) {
        maxDrop = { 
          step: step.label, 
          dropOff: drop, 
          index,
          prevStep: funnelData[index - 1].label
        };
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-foreground">Funil de Conversão</h2>
            {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-muted-foreground text-sm">
            {events.length.toLocaleString()} eventos • Atualiza a cada 30s
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
            <TabsList className="bg-muted/50">
              <TabsTrigger value="7d" className="text-xs">7 dias</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs">30 dias</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
            </TabsList>
          </Tabs>
          
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/20 rounded-xl">
                <Eye className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{metrics.pageViews.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Visualizações</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-orange-500/20 rounded-xl">
                <ShoppingCart className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{metrics.addToCarts.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Carrinhos</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-green-500/20 rounded-xl">
                <CreditCard className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{metrics.purchases}</p>
                <p className="text-xs text-muted-foreground">Compras</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/20 rounded-xl">
                <DollarSign className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {metrics.revenue > 0 ? `R$ ${metrics.revenue.toLocaleString('pt-BR')}` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">Receita</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-500/20 rounded-xl">
                <Target className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{metrics.overallConversion}%</p>
                <p className="text-xs text-muted-foreground">Conversão</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Biggest Drop-off Alert */}
      {biggestDropOff.dropOff > 30 && events.length > 10 && (
        <Card className="bg-gradient-to-r from-red-500/10 to-red-600/5 border-red-500/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg mt-0.5">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">
                  Maior abandono detectado: {biggestDropOff.prevStep} → {biggestDropOff.step}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="text-red-400 font-medium">{biggestDropOff.dropOff.toFixed(0)}%</span> dos usuários abandonam entre essas etapas. 
                  Analise possíveis fricções nesse ponto do funil.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Funnel Visualization */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Funil de Conversão
              </CardTitle>
              <CardDescription>Acompanhe onde os usuários abandonam o processo</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              <Activity className="h-3 w-3 mr-1" />
              Tempo real
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-4">
            {funnelData.map((step, index) => {
              const widthPercent = parseFloat(step.totalConversion);
              const Icon = step.icon;
              const isLowConversion = parseFloat(step.dropOff) > 50;
              
              return (
                <div key={step.key} className="relative">
                  <div className="flex items-center gap-3 mb-2">
                    <div 
                      className={`p-2 rounded-lg bg-gradient-to-br ${step.gradient}`}
                      style={{ borderColor: `${step.color}40`, borderWidth: 1 }}
                    >
                      <Icon className="h-4 w-4" style={{ color: step.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">
                          {step.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-foreground tabular-nums">
                            {step.count.toLocaleString()}
                          </span>
                          {index > 0 && (
                            <Badge 
                              variant={isLowConversion ? "destructive" : "secondary"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {parseFloat(step.dropOff) > 0 ? (
                                <>
                                  <TrendingDown className="h-3 w-3 mr-0.5" />
                                  -{step.dropOff}%
                                </>
                              ) : (
                                <>{step.stepConversion}%</>
                              )}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-10 bg-muted/30 rounded-lg overflow-hidden relative">
                    <div 
                      className="h-full rounded-lg transition-all duration-700 ease-out flex items-center justify-end pr-3"
                      style={{ 
                        width: `${Math.max(widthPercent, 3)}%`,
                        background: `linear-gradient(90deg, ${step.color}60, ${step.color}90)`,
                      }}
                    >
                      {widthPercent >= 15 && (
                        <span className="text-xs font-semibold text-white drop-shadow-sm">
                          {step.totalConversion}%
                        </span>
                      )}
                    </div>
                    {widthPercent < 15 && widthPercent > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        {step.totalConversion}%
                      </span>
                    )}
                  </div>
                  
                  {index < funnelData.length - 1 && (
                    <div className="flex justify-center py-2">
                      <ArrowDown className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Events Over Time - larger */}
        <Card className="border-border/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Eventos ao Longo do Tempo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={eventsByDay}>
                  <defs>
                    <linearGradient id="colorPageView" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorViewContent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorAddToCart" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorPurchase" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 10 }} iconType="circle" iconSize={8} />
                  <Area type="monotone" name="PageView" dataKey="PageView" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPageView)" strokeWidth={2} />
                  <Area type="monotone" name="Produto" dataKey="ViewContent" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorViewContent)" strokeWidth={2} />
                  <Area type="monotone" name="Carrinho" dataKey="AddToCart" stroke="#f97316" fillOpacity={1} fill="url(#colorAddToCart)" strokeWidth={2} />
                  <Area type="monotone" name="Compra" dataKey="Purchase" stroke="#22c55e" fillOpacity={1} fill="url(#colorPurchase)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Device Breakdown */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              Dispositivos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 flex flex-col">
              {deviceData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="70%">
                    <PieChart>
                      <Pie
                        data={deviceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {deviceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 mt-2">
                    {deviceData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-xs text-muted-foreground">
                          {d.name} ({((d.value / events.length) * 100).toFixed(0)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-muted-foreground text-sm">Sem dados de dispositivos</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Pages */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Páginas Mais Visitadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {topPages.length > 0 ? (
                topPages.map((page, index) => (
                  <div key={page.page} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-4 shrink-0">{index + 1}</span>
                      <span className="text-sm text-foreground truncate" title={page.page}>
                        {page.page === '/' ? 'Home' : page.page}
                      </span>
                    </div>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {page.count}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-6 text-sm">Sem dados ainda</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top States */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Estados com Mais Acessos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {topStates.length > 0 ? (
                topStates.map((item, index) => (
                  <div key={item.state} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
                      <span className="text-sm text-foreground font-medium">{item.state}</span>
                    </div>
                    <Badge variant="secondary" className="tabular-nums">
                      {item.count}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-6 text-sm">Sem dados de localização</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Eventos Recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
              {events.slice(0, 15).map((event) => {
                const eventConfig = FUNNEL_EVENTS.find(e => e.key === event.event_name);
                const Icon = eventConfig?.icon || Eye;
                return (
                  <div 
                    key={event.id} 
                    className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div 
                        className="p-1.5 rounded-md shrink-0"
                        style={{ backgroundColor: `${eventConfig?.color || '#666'}15` }}
                      >
                        <Icon 
                          className="h-3 w-3" 
                          style={{ color: eventConfig?.color || '#666' }} 
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {eventConfig?.label || event.event_name}
                        </p>
                        {event.content_name && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {event.content_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                      {formatDistanceToNow(new Date(event.event_time), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                );
              })}
              {events.length === 0 && (
                <div className="text-center py-8">
                  <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">
                    Nenhum evento ainda
                  </p>
                  <p className="text-muted-foreground/60 text-xs mt-1">
                    Os eventos aparecerão conforme os usuários navegam
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
