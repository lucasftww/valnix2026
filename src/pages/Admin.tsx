import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/FirebaseAuthContext";
import { useAdminPrefetch } from "@/hooks/useAdminPrefetch";
import { Settings, ChevronRight } from "lucide-react";

import { AdminDashboard } from "@/components/admin/AdminDashboard";

const AdminAnalytics = lazy(() => import("@/components/admin/AdminAnalytics").then(m => ({ default: m.AdminAnalytics })));
const AdminProducts = lazy(() => import("@/components/admin/AdminProducts").then(m => ({ default: m.AdminProducts })));
const AdminOrders = lazy(() => import("@/components/admin/AdminOrders").then(m => ({ default: m.AdminOrders })));
const AdminCategories = lazy(() => import("@/components/admin/AdminCategories").then(m => ({ default: m.AdminCategories })));
const AdminPostPaymentPages = lazy(() => import("@/components/admin/AdminPostPaymentPages").then(m => ({ default: m.AdminPostPaymentPages })));
const AdminTrackingMonitor = lazy(() => import("@/components/admin/AdminTrackingMonitor").then(m => ({ default: m.AdminTrackingMonitor })));
const AdminMigration = lazy(() => import("@/components/admin/AdminMigration").then(m => ({ default: m.AdminMigration })));
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
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
  "post-payment": { title: "Pós-Venda", description: "Funil de upsell pós-pagamento" },
  tracking: { title: "Tracking Monitor", description: "Saúde do Meta CAPI e deduplicação" },
  migration: { title: "Migração de Dados", description: "Sincronize vendas históricas com o novo Pixel" },
};

function Admin() {
  const { isAdmin, loading, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  // Removed mountedTabs — render only active tab, React Query cache handles instant re-renders
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useAdminPrefetch();

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    const { error } = await signIn(password);
    if (error) {
      const msg = typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: string }).message || "Acesso negado")
        : "Acesso negado";
      setLoginError(msg);
      setPassword("");
    }
    setLoggingIn(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-2 border-primary/20 rounded-full relative">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <form onSubmit={handleLogin} className="w-full max-w-xs space-y-4" autoComplete="off">
          <input type="text" name="username" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden="true" defaultValue="admin" />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-center ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {loginError && <p className="text-sm text-destructive text-center">{loginError}</p>}
          <Button type="submit" className="w-full" disabled={loggingIn || !password}>
            {loggingIn ? "..." : "Entrar"}
          </Button>
        </form>
      </div>
    );
  }

  const currentTab = tabTitles[activeTab] || tabTitles.dashboard;

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-to-br from-background via-background to-primary/5">
        <AdminSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        
        <div className="flex-1 flex flex-col min-h-screen">
          <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95">
            <div className="flex h-16 items-center gap-4 px-6">
              <SidebarTrigger className="lg:hidden" />
              
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

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Settings className="h-5 w-5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Configurações</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/")}>
                      Voltar ao Site
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        signOut();
                        navigate("/", { replace: true });
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Sair do painel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <div className="border-b border-border/40 bg-background/50 px-6 py-4">
            <h1 className="text-2xl font-bold tracking-tight">{currentTab.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{currentTab.description}</p>
          </div>

          <main className="flex-1 overflow-auto">
            <div className="p-6 max-w-7xl mx-auto">
              <Suspense fallback={
                <div className="flex items-center justify-center h-64">
                  <div className="w-8 h-8 border-2 border-primary/20 rounded-full relative">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
                  </div>
                </div>
              }>
                {activeTab === "dashboard" && <AdminDashboard />}
                {activeTab === "analytics" && <AdminAnalytics />}
                {activeTab === "products" && <AdminProducts />}
                {activeTab === "categories" && <AdminCategories />}
                {activeTab === "orders" && <AdminOrders />}
                {activeTab === "post-payment" && <AdminPostPaymentPages />}
                {activeTab === "tracking" && <AdminTrackingMonitor />}
                {activeTab === "migration" && <AdminMigration />}
              </Suspense>
            </div>
          </main>

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

// Wrap with AuthProvider so useAuth works only when Admin is rendered
export default function AdminWithAuth() {
  return (
    <AuthProvider>
      <Admin />
    </AuthProvider>
  );
}
