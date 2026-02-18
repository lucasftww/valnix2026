import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { invokeFunction } from "@/lib/apiHelper";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  DollarSign, ShoppingCart, Package, TrendingUp, RefreshCw, 
  CheckCircle2, AlertTriangle, AlertCircle,
  BarChart2, Users, Zap, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Period = 'today' | '7d' | '30d';

export const AdminDashboard = () => {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>('today');

  const { data: rawData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const token = requireAdminToken();
      const res = await invokeFunction("admin-data", {
        method: "GET",
        queryParams: { resource: "dashboard-stats" },
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        // Server rejected — clear session to prevent cascade
        const { clearAdminToken } = await import("@/lib/adminAuth");
        clearAdminToken();
        throw new Error("Admin session expired");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    refetchInterval: 30000,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry auth errors
      if (error?.message?.includes("Not authenticated") || error?.message?.includes("session expired")) return false;
      return failureCount < 2;
    },
  });

  const stats = useMemo(() => {
    if (!rawData) return null;

    const p = rawData.periods?.[period];
    if (!p) return null;

    return {
      periodRevenue: p.revenue,
      periodOrders: p.orders,
      periodPaidCount: p.paidCount,
      periodAvgTicket: p.avgTicket,
      periodFailed: p.failed,
      totalProducts: rawData.totalProducts || 0,
      totalUsers: rawData.totalUsers || 0,
      topProducts: rawData.topProducts || [],
      recentOrders: rawData.recentOrders || [],
      pendingDelivery: rawData.pendingDelivery || 0,
      revenueByDay: rawData.revenueByDay || [],
      paymentDistribution: rawData.paymentDistribution || [],
      alerts: rawData.alerts || [],
    };
  }, [rawData, period]);

  const periodLabel = period === 'today' ? 'Hoje' : period === '7d' ? '7 dias' : '30 dias';

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><div className="space-y-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /><div className="h-8 w-32 bg-muted animate-pulse rounded" /><div className="h-3 w-20 bg-muted animate-pulse rounded" /></div></CardContent></Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardContent className="p-6"><div className="h-64 bg-muted animate-pulse rounded" /></CardContent></Card>
          <Card><CardContent className="p-6"><div className="h-64 bg-muted animate-pulse rounded" /></CardContent></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-green-500" />
            Atualiza a cada 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="bg-muted/50 h-9">
              <TabsTrigger value="today" className="text-xs">Hoje</TabsTrigger>
              <TabsTrigger value="7d" className="text-xs">7 dias</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs">30 dias</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9">
            <RefreshCw className={cn("h-4 w-4 mr-1.5", isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {stats?.alerts && stats.alerts.length > 0 && (
        <div className="space-y-2">
          {stats.alerts.map((alert, i) => (
            <Card key={i} className={cn(
              "border",
              alert.type === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-orange-500/30 bg-orange-500/5'
            )}>
              <CardContent className="flex items-center gap-3 py-3">
                <div className={cn(
                  "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                  alert.type === 'error' ? 'bg-red-500/15' : 'bg-orange-500/15'
                )}>
                  {alert.type === 'error' ? (
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("font-semibold text-sm", alert.type === 'error' ? 'text-red-400' : 'text-orange-400')}>
                    {alert.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{alert.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* KPIs Grid */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Receita ({periodLabel})</span>
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(stats?.periodRevenue || 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.periodPaidCount || 0} pedidos pagos</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pedidos ({periodLabel})</span>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{stats?.periodOrders || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.periodFailed || 0} falharam</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ticket Médio</span>
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-purple-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(stats?.periodAvgTicket || 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">No período selecionado</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Catálogo</span>
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-orange-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{stats?.totalProducts || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.totalUsers || 0} usuários</p>
          </CardContent>
        </Card>
      </div>




      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/50 bg-card/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Receita 7 Dias</CardTitle>
                <CardDescription className="text-xs">Evolução diária de vendas</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.revenueByDay && stats.revenueByDay.some((d: any) => d.receita > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={stats.revenueByDay}>
                  <defs>
                    <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Receita']}
                  />
                  <Area type="monotone" dataKey="receita" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorReceita)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Sem dados de receita</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <BarChart2 className="h-4 w-4 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-base">Pagamentos</CardTitle>
                <CardDescription className="text-xs">Distribuição por status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.paymentDistribution && stats.paymentDistribution.length > 0 ? (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={stats.paymentDistribution} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={4} dataKey="value">
                      {stats.paymentDistribution.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} strokeWidth={0} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} formatter={(value: number) => [value, 'Pedidos']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-4 flex-wrap">
                  {stats.paymentDistribution.map((entry: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-xs text-muted-foreground">{entry.name}: {entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <BarChart2 className="h-10 w-10 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Sem pedidos</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Top Produtos</CardTitle>
                <CardDescription className="text-xs">Mais vendidos por quantidade</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.topProducts && stats.topProducts.length > 0 ? (
              <div className="space-y-3">
                {stats.topProducts.map(([name, data]: [string, any], i: number) => {
                  const maxQty = (stats.topProducts[0][1] as any).quantity;
                  return (
                    <div key={name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                          <span className="font-medium truncate max-w-[200px]">{name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{data.quantity} un</span>
                          <span className="font-medium text-foreground">{formatCurrency(data.revenue)}</span>
                        </div>
                      </div>
                      <Progress value={(data.quantity / maxQty) * 100} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Package className="h-8 w-8 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Sem vendas ainda</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <ShoppingCart className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-base">Pedidos Recentes</CardTitle>
                <CardDescription className="text-xs">Últimas vendas confirmadas</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.recentOrders && stats.recentOrders.length > 0 ? (
              <div className="space-y-2">
                {stats.recentOrders.map((order: any) => (
                  <div key={order.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate max-w-[160px]">{order.customer_name || 'Cliente'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-sm text-green-500 shrink-0">{formatCurrency(order.total_amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ShoppingCart className="h-8 w-8 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Sem pedidos pagos</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
