import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { AdminProducts } from "@/components/admin/AdminProducts";
import { AdminOrders } from "@/components/admin/AdminOrders";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminCategories } from "@/components/admin/AdminCategories";
import { AdminBanners } from "@/components/admin/AdminBanners";
import AdminReviews from "@/components/admin/AdminReviews";
import { AdminCoupons } from "@/components/admin/AdminCoupons";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminSupport } from "@/components/admin/AdminSupport";
import { AdminAnalytics } from "@/components/admin/AdminAnalytics";
import { AdminPostPaymentPages } from "@/components/admin/AdminPostPaymentPages";
import { Loader2, Search, Bell, Settings, ChevronRight, Menu } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const tabTitles: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Dashboard", description: "Visão geral do seu negócio" },
  analytics: { title: "Analytics", description: "Funil de conversão e comportamento" },
  products: { title: "Produtos", description: "Gerencie seu catálogo de produtos" },
  categories: { title: "Categorias", description: "Organize suas categorias" },
  orders: { title: "Pedidos", description: "Acompanhe e gerencie pedidos" },
  users: { title: "Usuários", description: "Gerenciar usuários cadastrados" },
  coupons: { title: "Cupons de Desconto", description: "Crie promoções e descontos" },
  banners: { title: "Banners", description: "Banners da página inicial" },
  reviews: { title: "Avaliações", description: "Gerenciar avaliações de clientes" },
  support: { title: "Suporte", description: "Atenda clientes em tempo real" },
  "post-payment": { title: "Pós-Venda", description: "Funil de upsell pós-pagamento" },
};

export default function Admin() {
  const { isAdmin, loading, user } = useAuth();
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate("/auth");
      } else if (!isAdmin) {
        navigate("/");
      } else {
        setCheckingAuth(false);
      }
    }
  }, [isAdmin, loading, user, navigate]);

  if (loading || checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
          </div>
          <p className="text-muted-foreground animate-pulse">Carregando painel...</p>
        </div>
      </div>
    );
  }

  const currentTab = tabTitles[activeTab] || tabTitles.dashboard;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-to-br from-background via-background to-primary/5">
        <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <div className="flex-1 flex flex-col min-h-screen">
          {/* Header */}
          <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center gap-4 px-6">
              <SidebarTrigger className="lg:hidden" />
              
              {/* Breadcrumb */}
              <Breadcrumb className="hidden md:flex">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/" className="text-muted-foreground hover:text-foreground">
                      Home
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-4 w-4" />
                  </BreadcrumbSeparator>
                  <BreadcrumbItem>
                    <BreadcrumbLink className="text-muted-foreground">
                      Admin
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-4 w-4" />
                  </BreadcrumbSeparator>
                  <BreadcrumbItem>
                    <BreadcrumbPage className="font-medium">
                      {currentTab.title}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>

              {/* Search */}
              <div className="flex-1 flex justify-center max-w-md mx-auto">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-muted/50 border-border/50 focus:bg-background w-full"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Notifications */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                      <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
                        3
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuLabel className="flex items-center justify-between">
                      Notificações
                      <Badge variant="secondary" className="text-xs">3 novas</Badge>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                      <span className="font-medium">Novo pedido recebido</span>
                      <span className="text-xs text-muted-foreground">Há 5 minutos</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                      <span className="font-medium">Pagamento confirmado</span>
                      <span className="text-xs text-muted-foreground">Há 15 minutos</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
                      <span className="font-medium">Novo usuário cadastrado</span>
                      <span className="text-xs text-muted-foreground">Há 1 hora</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Settings */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Settings className="h-5 w-5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Configurações</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setActiveTab("users")}>
                      Gerenciar Usuários
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setActiveTab("coupons")}>
                      Cupons de Desconto
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/")}>
                      Voltar ao Site
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Page Title */}
          <div className="border-b border-border/40 bg-background/50 px-6 py-4">
            <h1 className="text-2xl font-bold tracking-tight">{currentTab.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{currentTab.description}</p>
          </div>

          {/* Main Content */}
          <main className="flex-1 overflow-auto">
            <div className="p-6 max-w-7xl mx-auto">
              {activeTab === "dashboard" && <AdminDashboard />}
              {activeTab === "analytics" && <AdminAnalytics />}
              {activeTab === "products" && <AdminProducts />}
              {activeTab === "categories" && <AdminCategories />}
              {activeTab === "orders" && <AdminOrders />}
              {activeTab === "users" && <AdminUsers />}
              {activeTab === "coupons" && <AdminCoupons />}
              {activeTab === "banners" && <AdminBanners />}
              {activeTab === "reviews" && <AdminReviews />}
              {activeTab === "support" && <AdminSupport />}
              {activeTab === "post-payment" && <AdminPostPaymentPages />}
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-border/40 bg-background/50 px-6 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>© 2024 Admin Panel. Todos os direitos reservados.</span>
              <span>v1.0.0</span>
            </div>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}