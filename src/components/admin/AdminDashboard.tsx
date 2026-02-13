import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  DollarSign, ShoppingCart, Package, TrendingUp, RefreshCw, 
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle2, AlertCircle,
  BarChart2, Users, Zap, PieChart as PieChartIcon, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from "recharts";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
  gradient: string;
  delay?: number;
}

const StatCard = ({ title, value, subtitle, icon, trend, gradient, delay = 0 }: StatCardProps) => {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <Card className={cn(
      "relative overflow-hidden border-0 shadow-lg transition-all duration-500 ease-out",
      "bg-gradient-to-br hover:scale-[1.02] hover:shadow-xl",
      gradient,
      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
    )}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 animate-pulse" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
      
      <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
        <CardTitle className="text-sm font-medium text-white/80">
          {title}
        </CardTitle>
        <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center transition-transform duration-300 hover:rotate-12 hover:scale-110">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative z-10">
        <div className="text-3xl font-bold text-white">{value}</div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-white/70">{subtitle}</p>
          {trend && (
            <Badge 
              variant="secondary" 
              className={cn(
                "text-[10px] px-1.5 py-0 animate-pulse",
                trend.positive ? "bg-green-500/20 text-green-100" : "bg-red-500/20 text-red-100"
              )}
            >
              {trend.positive ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {trend.value}%
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// Animated wrapper component
const AnimatedCard = ({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div className={cn(
      "transition-all duration-700 ease-out",
      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
      className
    )}>
      {children}
    </div>
  );
};

const COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export const AdminDashboard = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Real-time listener for Firestore orders
    const ordersRef = collection(db, "orders");
    const unsubscribe = onSnapshot(ordersRef, () => {
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    });

    return () => unsubscribe();
  }, [queryClient]);

  const { data: stats, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      // Fetch all from Firebase Firestore
      const [ordersSnapshot, productsSnapshot, profilesSnapshot, orderItemsSnapshot] = await Promise.all([
        getDocs(collection(db, "orders")),
        getDocs(collection(db, "products")),
        getDocs(collection(db, "profiles")),
        getDocs(collection(db, "order_items"))
      ]);

      const totalUsers = profilesSnapshot.size;
      const totalProducts = productsSnapshot.docs.filter(doc => doc.data().is_active !== false).length;

      // Parse orders
      const orders = ordersSnapshot.docs.map(doc => {
        const data = doc.data();
        // Handle both Firestore Timestamp and string formats
        let createdAt: string;
        if (data.created_at?.toDate) {
          createdAt = data.created_at.toDate().toISOString();
        } else if (typeof data.created_at === 'string') {
          createdAt = data.created_at;
        } else {
          createdAt = new Date().toISOString();
        }
        
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
      
      // Parse order items
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

      // Calculate today's stats
      const today = new Date().toISOString().split('T')[0];
      const todayOrders = orders.filter(o => o.created_at?.startsWith(today));
      const todayRevenue = todayOrders.filter(o => o.payment_status === 'paid')
        .reduce((sum, o) => sum + Number(o.total_amount), 0);

      // Revenue by day (last 7 days)
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

      // Payment status distribution
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
        recentOrders: orders.slice(0, 8),
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
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
          </div>
          <p className="text-muted-foreground animate-pulse">Carregando estatísticas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <AnimatedCard delay={0}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              Dashboard
            </h2>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Activity className="h-4 w-4 animate-pulse text-green-500" />
              Visão geral do seu negócio em tempo real
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2 transition-all duration-200 hover:scale-105"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </AnimatedCard>

      {/* Quick Actions Alert */}
      {stats?.pendingDelivery && stats.pendingDelivery > 0 && (
        <AnimatedCard delay={100}>
          <Card className="border-orange-500/50 bg-orange-500/5 animate-pulse-slow">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center animate-bounce">
                <AlertCircle className="h-6 w-6 text-orange-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-orange-700 dark:text-orange-400">
                  {stats.pendingDelivery} {stats.pendingDelivery === 1 ? 'pedido aguarda' : 'pedidos aguardam'} entrega
                </p>
                <p className="text-sm text-muted-foreground">
                  Clientes pagaram e estão esperando o código de ativação
                </p>
              </div>
              <Button variant="outline" size="sm" className="border-orange-500/50 text-orange-600 hover:bg-orange-500/10 transition-all hover:scale-105">
                Ver Pedidos
              </Button>
            </CardContent>
          </Card>
        </AnimatedCard>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Receita Total"
          value={`R$ ${stats?.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          subtitle={`De ${stats?.paidOrdersCount} pedidos pagos`}
          icon={<DollarSign className="h-5 w-5 text-white" />}
          gradient="from-emerald-500 to-emerald-700"
          delay={100}
        />
        <StatCard
          title="Pedidos Hoje"
          value={stats?.todayOrders || 0}
          subtitle={`R$ ${stats?.todayRevenue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}`}
          icon={<ShoppingCart className="h-5 w-5 text-white" />}
          gradient="from-blue-500 to-blue-700"
          delay={200}
        />
        <StatCard
          title="Ticket Médio"
          value={`R$ ${stats?.avgTicket?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0,00'}`}
          subtitle="Por pedido pago"
          icon={<TrendingUp className="h-5 w-5 text-white" />}
          gradient="from-purple-500 to-purple-700"
          delay={300}
        />
        <StatCard
          title="Produtos Ativos"
          value={stats?.totalProducts || 0}
          subtitle="No catálogo"
          icon={<Package className="h-5 w-5 text-white" />}
          gradient="from-orange-500 to-orange-700"
          delay={400}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Revenue Chart */}
        <AnimatedCard delay={500} className="lg:col-span-2">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Receita dos Últimos 7 Dias</CardTitle>
                  <CardDescription>Evolução diária de vendas</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stats?.revenueByDay && stats.revenueByDay.some(d => d.receita > 0) ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={stats.revenueByDay}>
                    <defs>
                      <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis 
                      dataKey="name" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `R$${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                      }}
                      formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Receita']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="receita" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorReceita)"
                      animationDuration={1500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <TrendingUp className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Sem dados de receita ainda</p>
                  <p className="text-sm text-muted-foreground/70">O gráfico aparecerá quando houver vendas</p>
                </div>
              )}
            </CardContent>
          </Card>
        </AnimatedCard>

        {/* Payment Status Pie Chart */}
        <AnimatedCard delay={600}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-500/10 flex items-center justify-center">
                  <PieChartIcon className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Status de Pagamentos</CardTitle>
                  <CardDescription>Distribuição por status</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stats?.paymentDistribution && stats.paymentDistribution.length > 0 ? (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={stats.paymentDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={5}
                        dataKey="value"
                        animationDuration={1000}
                        animationBegin={600}
                      >
                        {stats.paymentDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [value, 'Pedidos']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 flex-wrap">
                    {stats.paymentDistribution.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-sm text-muted-foreground">
                          {entry.name}: {entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <PieChartIcon className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Sem pedidos ainda</p>
                </div>
              )}
            </CardContent>
          </Card>
        </AnimatedCard>
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <AnimatedCard delay={700}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 transition-all duration-300 hover:shadow-lg hover:border-primary/30">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center transition-transform duration-300 hover:scale-110">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalUsers || 0}</p>
                <p className="text-sm text-muted-foreground">Usuários cadastrados</p>
              </div>
            </CardContent>
          </Card>
        </AnimatedCard>
        <AnimatedCard delay={800}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 transition-all duration-300 hover:shadow-lg hover:border-green-500/30">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center transition-transform duration-300 hover:scale-110">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.paidOrdersCount || 0}</p>
                <p className="text-sm text-muted-foreground">Pedidos concluídos</p>
              </div>
            </CardContent>
          </Card>
        </AnimatedCard>
        <AnimatedCard delay={900}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50 transition-all duration-300 hover:shadow-lg hover:border-yellow-500/30">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="h-12 w-12 rounded-xl bg-yellow-500/10 flex items-center justify-center transition-transform duration-300 hover:scale-110">
                <Clock className="h-6 w-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.pendingDelivery || 0}</p>
                <p className="text-sm text-muted-foreground">Aguardando entrega</p>
              </div>
            </CardContent>
          </Card>
        </AnimatedCard>
      </div>

      {/* Charts and Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Products */}
        <AnimatedCard delay={1000}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart2 className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Produtos Mais Vendidos</CardTitle>
                  <CardDescription>Top 5 por quantidade vendida</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stats?.topProducts && stats.topProducts.length > 0 ? (
                <div className="space-y-4">
                  {stats.topProducts.map(([name, data], index) => {
                    const maxQuantity = stats.topProducts[0][1].quantity;
                    const percentage = (data.quantity / maxQuantity) * 100;
                    
                    return (
                      <div 
                        key={name} 
                        className="space-y-2 transition-all duration-300 hover:translate-x-1"
                        style={{ animationDelay: `${index * 100}ms` }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold transition-transform duration-300 hover:scale-110",
                              index === 0 ? "bg-yellow-500/20 text-yellow-600" :
                              index === 1 ? "bg-gray-400/20 text-gray-500" :
                              index === 2 ? "bg-orange-600/20 text-orange-600" :
                              "bg-muted text-muted-foreground"
                            )}>
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium text-sm line-clamp-1">{name}</p>
                              <p className="text-xs text-muted-foreground">
                                {data.quantity} vendidos
                              </p>
                            </div>
                          </div>
                          <p className="font-bold text-primary">
                            R$ {data.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="relative">
                          <Progress value={percentage} className="h-1.5" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Zap className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Nenhuma venda ainda</p>
                  <p className="text-sm text-muted-foreground/70">As vendas aparecerão aqui</p>
                </div>
              )}
            </CardContent>
          </Card>
        </AnimatedCard>

        {/* Recent Orders */}
        <AnimatedCard delay={1100}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <ShoppingCart className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Pedidos Recentes</CardTitle>
                  <CardDescription>Últimos 8 pedidos</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {stats?.recentOrders && stats.recentOrders.length > 0 ? (
                <div className="space-y-3">
                  {stats.recentOrders.map((order: any, index: number) => (
                    <div 
                      key={order.id} 
                      className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 transition-all duration-300 hover:bg-muted/30 hover:px-2 rounded-lg"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-2 w-2 rounded-full transition-transform duration-300 hover:scale-150",
                          order.payment_status === 'paid' ? "bg-green-500 shadow-sm shadow-green-500/50" :
                          order.payment_status === 'pending' ? "bg-yellow-500 shadow-sm shadow-yellow-500/50" : "bg-red-500 shadow-sm shadow-red-500/50"
                        )} />
                        <div>
                          <p className="font-medium text-sm">{order.customer_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm">
                          R$ {Number(order.total_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <Badge 
                          variant="secondary" 
                          className={cn(
                            "text-[10px]",
                            order.payment_status === 'paid' ? "bg-green-500/10 text-green-600" :
                            order.payment_status === 'pending' ? "bg-yellow-500/10 text-yellow-600" : 
                            "bg-red-500/10 text-red-600"
                          )}
                        >
                          {order.payment_status === 'paid' ? 'Pago' : 
                           order.payment_status === 'pending' ? 'Pendente' : 'Falhou'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ShoppingCart className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Nenhum pedido ainda</p>
                  <p className="text-sm text-muted-foreground/70">Os pedidos aparecerão aqui</p>
                </div>
              )}
            </CardContent>
          </Card>
        </AnimatedCard>
      </div>
    </div>
  );
};