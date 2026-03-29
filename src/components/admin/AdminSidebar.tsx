import { 
  Package, ShoppingCart, FolderTree, Home, 
  BarChart3, ChevronLeft, ChevronRight,
  Zap, TrendingUp, Shield, Database
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const mainMenuItems = [
  { id: "dashboard", title: "Dashboard", icon: BarChart3, badge: null },
  { id: "analytics", title: "Analytics", icon: TrendingUp, badge: null },
  { id: "orders", title: "Pedidos", icon: ShoppingCart, badge: null },
  { id: "products", title: "Produtos", icon: Package, badge: null },
  { id: "categories", title: "Categorias", icon: FolderTree, badge: null },
];

const systemMenuItems = [
  { id: "post-payment", title: "Pós-Venda", icon: Zap, badge: null },
  { id: "tracking", title: "Tracking", icon: Shield, badge: "new" as const },
  { id: "migration", title: "Migração", icon: Database, badge: null },
];

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps) {
  const { state, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const isCollapsed = state === "collapsed";

  const renderMenuItem = (item: typeof mainMenuItems[0]) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton
        onClick={() => onTabChange(item.id)}
        className={cn(
          "group relative transition-all duration-200 rounded-lg h-10",
          activeTab === item.id
            ? "bg-primary/15 text-primary font-medium border-l-2 border-primary shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <item.icon className={cn(
          "h-5 w-5 transition-colors flex-shrink-0",
          activeTab === item.id ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
        )} />
        {!isCollapsed && (
          <span className="flex-1 truncate">{item.title}</span>
        )}
        {!isCollapsed && item.badge === "hot" && (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 animate-pulse bg-primary">
            HOT
          </Badge>
        )}
        {!isCollapsed && item.badge === "new" && (
          <Badge className="ml-auto text-[10px] px-1.5 py-0 h-5 bg-green-600 text-white">
            NEW
          </Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar 
      className={cn(
        "border-r border-border bg-sidebar transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <SidebarContent className="flex flex-col h-full bg-sidebar">
        {/* Logo/Header */}
        <div className={cn(
          "flex items-center gap-3 px-4 py-5 border-b border-border",
          isCollapsed && "justify-center px-2"
        )}>
          <div className="relative flex-shrink-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-sidebar" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-lg text-sidebar-foreground truncate">
                Admin Panel
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Gerenciamento
              </span>
            </div>
          )}
        </div>

        {/* Main Navigation */}
        <SidebarGroup className="py-4 px-2">
          <SidebarGroupLabel className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2",
            isCollapsed && "sr-only"
          )}>
            Principal
          </SidebarGroupLabel>
          
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={() => navigate("/")}
                  className="text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors rounded-lg h-10"
                >
                  <Home className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span>Voltar ao Site</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <Separator className="my-3 bg-border" />
              
              {mainMenuItems.map(renderMenuItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* System Section */}
        <SidebarGroup className="py-2 px-2">
          <SidebarGroupLabel className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2",
            isCollapsed && "sr-only"
          )}>
            Sistema
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {systemMenuItems.map(renderMenuItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarFooter className="mt-auto border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className={cn(
              "w-full text-muted-foreground hover:text-foreground hover:bg-accent",
              isCollapsed && "px-0"
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span>Recolher</span>
              </>
            )}
          </Button>
        </SidebarFooter>
      </SidebarContent>
    </Sidebar>
  );
}
