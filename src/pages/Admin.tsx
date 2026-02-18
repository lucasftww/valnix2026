import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useAdminPrefetch } from "@/hooks/useAdminPrefetch";
import { Search, Bell, Settings, ChevronRight } from "lucide-react";

import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminAnalytics } from "@/components/admin/AdminAnalytics";
import { AdminProducts } from "@/components/admin/AdminProducts";
import { AdminOrders } from "@/components/admin/AdminOrders";
import { AdminCategories } from "@/components/admin/AdminCategories";
import { AdminPostPaymentPages } from "@/components/admin/AdminPostPaymentPages";
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
  "post-payment": { title: "Pós-Venda", description: "Funil de upsell pós-pagamento" },
};

export default function Admin() {
  const { isAdmin, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(["dashboard"]));
  const [searchQuery, setSearchQuery] = useState("");
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
      setLoginError("Acesso negado");
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
        <form onSubmit={handleLogin} className="w-full max-w-xs space-y-4">
          <Input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="new-password"
            className="text-center"
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
    setMountedTabs(prev => new Set(prev).add(tab));
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

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                </Button>

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
              {mountedTabs.has("dashboard") && <div style={{ display: activeTab === "dashboard" ? "block" : "none" }}><AdminDashboard /></div>}
              {mountedTabs.has("analytics") && <div style={{ display: activeTab === "analytics" ? "block" : "none" }}><AdminAnalytics /></div>}
              {mountedTabs.has("products") && <div style={{ display: activeTab === "products" ? "block" : "none" }}><AdminProducts /></div>}
              {mountedTabs.has("categories") && <div style={{ display: activeTab === "categories" ? "block" : "none" }}><AdminCategories /></div>}
              {mountedTabs.has("orders") && <div style={{ display: activeTab === "orders" ? "block" : "none" }}><AdminOrders /></div>}
              {mountedTabs.has("post-payment") && <div style={{ display: activeTab === "post-payment" ? "block" : "none" }}><AdminPostPaymentPages /></div>}
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
