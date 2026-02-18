import { 
  Package, ShoppingCart, FolderTree, Home, 
  BarChart3, ChevronLeft, ChevronRight, LogOut,
  Zap, TrendingUp
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
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
];

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps) {
  const { state, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const isCollapsed = state === "collapsed";

  const handleSignOut = () => {
    signOut();
    navigate("/");
  };

  const userInitials = "AD";

  const renderMenuItem = (item: typeof mainMenuItems[0]) => (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton
        onClick={() => onTabChange(item.id)}
        className={cn(
          "group relative transition-all duration-200 rounded-lg h-10",
          activeTab === item.id
            ? "bg-primary/15 text-primary font-medium border-l-3 border-primary shadow-sm"
            : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100"
        )}
      >
        <item.icon className={cn(
          "h-5 w-5 transition-colors flex-shrink-0",
          activeTab === item.id ? "text-primary" : "text-neutral-500 group-hover:text-neutral-300"
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
        "border-r border-neutral-800 bg-neutral-950 transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <SidebarContent className="flex flex-col h-full bg-neutral-950">
        {/* Logo/Header */}
        <div className={cn(
          "flex items-center gap-3 px-4 py-5 border-b border-neutral-800",
          isCollapsed && "justify-center px-2"
        )}>
          <div className="relative flex-shrink-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-neutral-950" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-lg text-white truncate">
                Admin Panel
              </span>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                Gerenciamento
              </span>
            </div>
          )}
        </div>

        {/* Main Navigation */}
        <SidebarGroup className="py-4 px-2">
          <SidebarGroupLabel className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-2 px-2",
            isCollapsed && "sr-only"
          )}>
            Principal
          </SidebarGroupLabel>
          
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={() => navigate("/")}
                  className="text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100 transition-colors rounded-lg h-10"
                >
                  <Home className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span>Voltar ao Site</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <Separator className="my-3 bg-neutral-800" />
              
              {mainMenuItems.map(renderMenuItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* System Section */}
        <SidebarGroup className="py-2 px-2">
          <SidebarGroupLabel className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-2 px-2",
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

        {/* Footer - User Profile */}
        <SidebarFooter className="mt-auto border-t border-neutral-800 p-3">
          <div className={cn(
            "flex items-center gap-3 p-2 rounded-lg bg-neutral-900/80",
            isCollapsed && "justify-center p-2"
          )}>
            <Avatar className="h-9 w-9 border-2 border-primary/30 flex-shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/10 text-primary text-sm font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-200 truncate">Admin</p>
                <p className="text-[10px] text-neutral-500">Administrador</p>
              </div>
            )}
            {!isCollapsed && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className={cn(
              "w-full mt-2 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800/60",
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
