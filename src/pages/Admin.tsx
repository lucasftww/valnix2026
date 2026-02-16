import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Search, Bell, Settings, ChevronRight, Loader2 } from "lucide-react";

// Lazy-load each admin tab for code splitting
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const AdminAnalytics = lazy(() => import("@/components/admin/AdminAnalytics").then(m => ({ default: m.AdminAnalytics })));
const AdminProducts = lazy(() => import("@/components/admin/AdminProducts").then(m => ({ default: m.AdminProducts })));
const AdminOrders = lazy(() => import("@/components/admin/AdminOrders").then(m => ({ default: m.AdminOrders })));
const AdminUsers = lazy(() => import("@/components/admin/AdminUsers").then(m => ({ default: m.AdminUsers })));
const AdminCategories = lazy(() => import("@/components/admin/AdminCategories").then(m => ({ default: m.AdminCategories })));
const AdminCoupons = lazy(() => import("@/components/admin/AdminCoupons").then(m => ({ default: m.AdminCoupons })));
const AdminPostPaymentPages = lazy(() => import("@/components/admin/AdminPostPaymentPages").then(m => ({ default: m.AdminPostPaymentPages })));
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

const tabTitles: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Dashboard", description: "Visão geral do seu negócio" },
  analytics: { title: "Analytics", description: "Funil de conversão e comportamento" },
  products: { title: "Produtos", description: "Gerencie seu catálogo de produtos" },
  categories: { title: "Categorias", description: "Organize suas categorias" },
  orders: { title: "Pedidos", description: "Acompanhe e gerencie pedidos" },
  users: { title: "Usuários", description: "Gerenciar usuários cadastrados" },
  coupons: { title: "Cupons de Desconto", description: "Crie promoções e descontos" },
  
  "post-payment": { title: "Pós-Venda", description: "Funil de upsell pós-pagamento" },
};

export default function Admin() {
  const { isAdmin, loading, user } = useAuth();
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");

  // Strip UTM and other query params from admin URLs
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
                  <label htmlFor="admin-search" className="sr-only">Buscar</label>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="admin-search"
                    name="admin-search"
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
                <Button variant="ghost" size="icon">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                </Button>

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
              <Suspense fallback={
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              }>
                {activeTab === "dashboard" && <AdminDashboard />}
                {activeTab === "analytics" && <AdminAnalytics />}
                {activeTab === "products" && <AdminProducts />}
                {activeTab === "categories" && <AdminCategories />}
                {activeTab === "orders" && <AdminOrders />}
                {activeTab === "users" && <AdminUsers />}
                {activeTab === "coupons" && <AdminCoupons />}
                {activeTab === "post-payment" && <AdminPostPaymentPages />}
              </Suspense>
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-border/40 bg-background/50 px-6 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>© 2026 VALNIX. Todos os direitos reservados.</span>
              <span>v2.1</span>
            </div>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}