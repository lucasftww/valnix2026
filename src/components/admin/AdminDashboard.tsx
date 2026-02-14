import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  DollarSign, ShoppingCart, Package, TrendingUp, RefreshCw, 
  Clock, CheckCircle2, AlertCircle,
  BarChart2, Users, Zap, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444'];

export const AdminDashboard = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const ordersRef = collection(db, "orders");
    const unsubscribe = onSnapshot(ordersRef, () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    });
    return () => unsubscribe();
  }, [queryClient]);

  const { data: stats, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [ordersSnapshot, productsSnapshot, profilesSnapshot, orderItemsSnapshot] = await Promise.all([
        getDocs(collection(db, "orders")),
        getDocs(collection(db, "products")),
        getDocs(collection(db, "profiles")),
        getDocs(collection(db, "order_items"))
      ]);

      const totalUsers = profilesSnapshot.size;
      const totalProducts = productsSnapshot.docs.filter(doc => doc.data().is_active !== false).length;

      const orders = ordersSnapshot.docs.map(doc => {
        const data = doc.data();
        let createdAt: string;
        if (data.created_at?.toDate) createdAt = data.created_at.toDate().toISOString();
        else if (typeof data.created_at === 'string') createdAt = data.created_at;
        else createdAt = new Date().toISOString();
        
        return {
          id: doc.id,
          customer_name: data.customer_name as string || '',
          total_amount: (data.total_amount as number) || 0,
          payment_status: (data.payment_status as string) || 'pending',
          status: (data.status as string) || 'pending',
          created_at: createdAt,
        };
      });

      const paidOrders = orders.filter(o => o.payment_status === 'paid');
      const pendingOrders = orders.filter(o => o.status === 'pending' && o.payment_status === 'paid');
      const paidOrderIds = paidOrders.map(o => o.id);
      
      const allOrderItems = orderItemsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          order_id: (data.order_id as string) || '',
          product_name: (data.product_name as string) || '',
          quantity: (data.quantity as number) || 0,
          total_price: (data.total_price as number) || 0,
        };
      });
      
      const orderItems = allOrderItems.filter(item => paidOrderIds.includes(item.order_id));
      const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total_amount), 0);
      
      const productSales = orderItems.reduce((acc, item) => {
        if (!acc[item.product_name]) acc[item.product_name] = { quantity: 0, revenue: 0 };
        acc[item.product_name].quantity += item.quantity;
        acc[item.product_name].revenue += Number(item.total_price);
        return acc;
      }, {} as Record<string, { quantity: number; revenue: number }>);

      const topProducts = Object.entries(productSales || {})
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .slice(0, 5);

      const today = new Date().toISOString().split('T')[0];
      const todayOrders = orders.filter(o => o.created_at?.startsWith(today));
      const todayRevenue = todayOrders.filter(o => o.payment_status === 'paid')
        .reduce((sum, o) => sum + Number(o.total_amount), 0);

      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      const revenueByDay = last7Days.map(date => {
        const dayOrders = orders.filter(o => o.created_at?.startsWith(date) && o.payment_status === 'paid');
        const revenue = dayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
        const dayName = new Date(date).toLocaleDateString('pt-BR', { weekday: 'short' });
        return {
          name: dayName.charAt(0).toUpperCase() + dayName.slice(1, 3),
          receita: revenue,
          pedidos: dayOrders.length
        };
      });

      const paymentDistribution = [
        { name: 'Pago', value: paidOrders.length, color: '#10b981' },
        { name: 'Pendente', value: orders.filter(o => o.payment_status === 'pending').length, color: '#f59e0b' },
        { name: 'Falhou', value: orders.filter(o => o.payment_status === 'failed').length, color: '#ef4444' }
      ].filter(item => item.value > 0);

      return {
        totalRevenue,
        totalOrders: orders.length,
        paidOrdersCount: paidOrders.length,
        pendingDelivery: pendingOrders.length,
        totalProducts,
        totalUsers,
        topProducts,
        recentOrders: [...orders]
          .filter(o => o.payment_status === 'paid')
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 8),
        todayOrders: todayOrders.length,
        todayRevenue,
        avgTicket: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0,
        revenueByDay,
        paymentDistribution
      };
    },
    refetchInterval: 30000
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 border-4 border-primary/20 rounded-full" />
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
          </div>
          <p className="text-sm text-muted-foreground">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <Activity className="h-3.5 w-3.5 text-green-500" />
            Visão geral em tempo real
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9">
          <RefreshCw className={cn("h-4 w-4 mr-1.5", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Pending delivery alert */}
      {stats?.pendingDelivery && stats.pendingDelivery > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="flex items-center gap-3 py-3">
            <div className="h-10 w-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 text-orange-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-orange-400">
                {stats.pendingDelivery} {stats.pendingDelivery === 1 ? 'pedido aguarda' : 'pedidos aguardam'} entrega
              </p>
              <p className="text-xs text-muted-foreground">Pagos e esperando código de ativação</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Receita Total</span>
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(stats?.totalRevenue || 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.paidOrdersCount || 0} pedidos pagos</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hoje</span>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{stats?.todayOrders || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatCurrency(stats?.todayRevenue || 0)}</p>
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
            <p className="text-2xl font-bold">{formatCurrency(stats?.avgTicket || 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">Por pedido pago</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Produtos</span>
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-orange-500" />
              </div>
            </div>
            <p className="text-2xl font-bold">{stats?.totalProducts || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Ativos no catálogo</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid gap-3 grid-cols-3">
        <div className="bg-muted/20 rounded-xl p-4 flex items-center gap-3 border border-border/30">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-lg font-bold">{stats?.totalUsers || 0}</p>
            <p className="text-xs text-muted-foreground">Usuários</p>
          </div>
        </div>
        <div className="bg-muted/20 rounded-xl p-4 flex items-center gap-3 border border-border/30">
          <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="text-lg font-bold">{stats?.paidOrdersCount || 0}</p>
            <p className="text-xs text-muted-foreground">Pagos</p>
          </div>
        </div>
        <div className="bg-muted/20 rounded-xl p-4 flex items-center gap-3 border border-border/30">
          <div className="h-9 w-9 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-yellow-500" />
          </div>
          <div>
            <p className="text-lg font-bold">{stats?.pendingDelivery || 0}</p>
            <p className="text-xs text-muted-foreground">Aguardando</p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue Chart */}
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
            {stats?.revenueByDay && stats.revenueByDay.some(d => d.receita > 0) ? (
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
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                    }}
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

        {/* Payment Distribution */}
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
                      {stats.paymentDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} strokeWidth={0} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                      formatter={(value: number) => [value, 'Pedidos']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-4 flex-wrap">
                  {stats.paymentDistribution.map((entry, i) => (
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
        {/* Top Products */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Mais Vendidos</CardTitle>
                <CardDescription className="text-xs">Top 5 por quantidade</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.topProducts && stats.topProducts.length > 0 ? (
              <div className="space-y-3">
                {stats.topProducts.map(([name, data], index) => {
                  const maxQty = stats.topProducts[0][1].quantity;
                  const pct = (data.quantity / maxQty) * 100;
                  
                  return (
                    <div key={name} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold",
                            index === 0 ? "bg-yellow-500/15 text-yellow-500" :
                            index === 1 ? "bg-gray-400/15 text-gray-400" :
                            index === 2 ? "bg-orange-500/15 text-orange-500" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm line-clamp-1">{name}</p>
                            <p className="text-[11px] text-muted-foreground">{data.quantity} vendidos</p>
                          </div>
                        </div>
                        <span className="font-bold text-sm text-primary">{formatCurrency(data.revenue)}</span>
                      </div>
                      <Progress value={pct} className="h-1" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Zap className="h-10 w-10 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma venda ainda</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <ShoppingCart className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <CardTitle className="text-base">Pedidos Recentes</CardTitle>
                <CardDescription className="text-xs">Últimos 8 pedidos</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stats?.recentOrders && stats.recentOrders.length > 0 ? (
              <div className="space-y-1">
                {stats.recentOrders.map((order: any) => (
                  <div key={order.id} className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        order.payment_status === 'paid' ? "bg-green-500" :
                        order.payment_status === 'pending' ? "bg-yellow-500" : "bg-red-500"
                      )} />
                      <div>
                        <p className="font-medium text-sm">{order.customer_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">{formatCurrency(Number(order.total_amount))}</p>
                      <Badge variant="secondary" className={cn(
                        "text-[10px] px-1.5 py-0",
                        order.payment_status === 'paid' ? "bg-green-500/10 text-green-500" :
                        order.payment_status === 'pending' ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"
                      )}>
                        {order.payment_status === 'paid' ? 'Pago' : order.payment_status === 'pending' ? 'Pendente' : 'Falhou'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ShoppingCart className="h-10 w-10 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum pedido ainda</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
