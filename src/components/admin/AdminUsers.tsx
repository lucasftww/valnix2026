import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Loader2, Search, Mail, Phone, Calendar, User, Users, 
  ShoppingCart, DollarSign, TrendingUp, Crown, Star, 
  ArrowUpDown, ChevronDown, Eye, Filter,
  UserCheck, Clock, Wallet, Trash2, AlertTriangle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AdminCard } from "./AdminCard";
import { AdminEmptyState } from "./AdminEmptyState";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAdminUsers, useUserOrders, updateUserBalance, deleteFirebaseUser, type FirebaseUser } from "@/hooks/firebase/useFirebaseUsers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";

type SortField = "email" | "total_orders" | "total_spent" | "created_at" | "last_order_date";
type SortOrder = "asc" | "desc";
type FilterType = "all" | "with_orders" | "without_orders" | "vip";

export const AdminUsers = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedUser, setSelectedUser] = useState<FirebaseUser | null>(null);
  const [balanceDialogUser, setBalanceDialogUser] = useState<FirebaseUser | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [updatingBalance, setUpdatingBalance] = useState(false);
  const [deleteDialogUser, setDeleteDialogUser] = useState<FirebaseUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Usar hooks Firebase
  const { data: users = [], isLoading, error } = useAdminUsers();
  
  // Buscar pedidos do usuário selecionado
  const { data: userOrders = [] } = useUserOrders(selectedUser?.id || null);

  const handleUpdateBalance = async () => {
    if (!balanceDialogUser) return;
    
    const balanceValue = parseFloat(newBalance.replace(",", "."));
    if (isNaN(balanceValue) || balanceValue < 0) {
      toast({
        title: "Valor inválido",
        description: "Digite um valor numérico válido (maior ou igual a zero).",
        variant: "destructive",
      });
      return;
    }
    
    setUpdatingBalance(true);
    try {
      await updateUserBalance(balanceDialogUser.id, balanceValue);
      
      toast({
        title: "Saldo atualizado!",
        description: `Saldo de ${balanceDialogUser.email} definido para R$ ${balanceValue.toFixed(2)}`,
      });
      
      // Refresh users list
      queryClient.invalidateQueries({ queryKey: ["firebase-admin-users"] });
      
      setBalanceDialogUser(null);
      setNewBalance("");
    } catch (error) {
      console.error("Error updating balance:", error);
      toast({
        title: "Erro ao atualizar saldo",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setUpdatingBalance(false);
    }
  };

  const openBalanceDialog = (user: FirebaseUser) => {
    setBalanceDialogUser(user);
    setNewBalance(user.balance.toFixed(2).replace(".", ","));
  };

  const handleDeleteUser = async () => {
    if (!deleteDialogUser) return;
    
    setDeletingUser(true);
    try {
      await deleteFirebaseUser(deleteDialogUser.id);
      
      toast({
        title: "Usuário excluído!",
        description: `${deleteDialogUser.email} foi removido do sistema.`,
      });
      
      // Refresh users list
      queryClient.invalidateQueries({ queryKey: ["firebase-admin-users"] });
      
      setDeleteDialogUser(null);
    } catch (error) {
      console.error("Error deleting user:", error);
      toast({
        title: "Erro ao excluir usuário",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setDeletingUser(false);
    }
  };

  // Filtrar e ordenar usuários
  const processedUsers = users
    .filter((user) => {
      // Filtro de busca
      const matchesSearch = 
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.phone?.includes(searchTerm) ||
        user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.nickname?.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;

      // Filtro por tipo
      switch (filter) {
        case "with_orders":
          return user.total_orders > 0;
        case "without_orders":
          return user.total_orders === 0;
        case "vip":
          return user.total_spent >= 500;
        default:
          return true;
      }
    })
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case "email":
          comparison = a.email.localeCompare(b.email);
          break;
        case "total_orders":
          comparison = a.total_orders - b.total_orders;
          break;
        case "total_spent":
          comparison = a.total_spent - b.total_spent;
          break;
        case "created_at":
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "last_order_date":
          const dateA = a.last_order_date ? new Date(a.last_order_date).getTime() : 0;
          const dateB = b.last_order_date ? new Date(b.last_order_date).getTime() : 0;
          comparison = dateA - dateB;
          break;
      }
      
      return sortOrder === "asc" ? comparison : -comparison;
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const getInitials = (user: FirebaseUser) => {
    if (user.nickname) return user.nickname.slice(0, 2).toUpperCase();
    if (user.full_name) return user.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    return user.email?.slice(0, 2).toUpperCase() || "??";
  };

  const getDisplayName = (user: FirebaseUser) => {
    return user.nickname || user.full_name || user.email?.split("@")[0] || "Usuário";
  };

  const getUserTier = (totalSpent: number) => {
    if (totalSpent >= 1000) return { label: "Diamante", color: "bg-gradient-to-r from-cyan-400 to-blue-500", icon: Crown };
    if (totalSpent >= 500) return { label: "Ouro", color: "bg-gradient-to-r from-yellow-400 to-orange-500", icon: Star };
    if (totalSpent >= 100) return { label: "Prata", color: "bg-gradient-to-r from-gray-300 to-gray-400", icon: Star };
    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-500/10 text-green-600";
      case "processing": return "bg-blue-500/10 text-blue-600";
      case "pending": return "bg-yellow-500/10 text-yellow-600";
      case "cancelled": return "bg-red-500/10 text-red-600";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed": return "Concluído";
      case "processing": return "Processando";
      case "pending": return "Pendente";
      case "cancelled": return "Cancelado";
      default: return status;
    }
  };

  // Estatísticas
  const stats = {
    total: users.length,
    withOrders: users.filter(u => u.total_orders > 0).length,
    totalSpent: users.reduce((sum, u) => sum + u.total_spent, 0),
    avgOrderValue: users.filter(u => u.total_orders > 0).length > 0 
      ? users.reduce((sum, u) => sum + u.total_spent, 0) / users.filter(u => u.total_orders > 0).reduce((sum, u) => sum + u.total_orders, 0)
      : 0,
    newThisMonth: users.filter(u => {
      const userDate = new Date(u.created_at);
      const now = new Date();
      return userDate.getMonth() === now.getMonth() && userDate.getFullYear() === now.getFullYear();
    }).length,
    vipUsers: users.filter(u => u.total_spent >= 500).length,
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative">
          <div className="w-12 h-12 border-4 border-primary/20 rounded-full" />
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
        </div>
        <p className="text-muted-foreground mt-4">Carregando usuários...</p>
      </div>
    );
  }

  if (error) {
    return (
      <AdminEmptyState
        icon={Users}
        title="Erro ao carregar usuários"
        description={(error as Error).message}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards - Grid responsivo melhorado */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 border-0 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10" />
          <CardContent className="flex items-center gap-4 py-5 relative">
            <div className="h-11 w-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl lg:text-3xl font-bold">{stats.total}</p>
              <p className="text-xs lg:text-sm text-white/80 truncate">Total de Usuários</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-emerald-600 border-0 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10" />
          <CardContent className="flex items-center gap-4 py-5 relative">
            <div className="h-11 w-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <UserCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl lg:text-3xl font-bold">{stats.withOrders}</p>
              <p className="text-xs lg:text-sm text-white/80 truncate">Com Compras</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-violet-600 border-0 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10" />
          <CardContent className="flex items-center gap-4 py-5 relative">
            <div className="h-11 w-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xl lg:text-2xl font-bold truncate">
                R$ {stats.totalSpent.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs lg:text-sm text-white/80 truncate">Total em Vendas</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500 to-orange-600 border-0 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10" />
          <CardContent className="flex items-center gap-4 py-5 relative">
            <div className="h-11 w-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Crown className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl lg:text-3xl font-bold">{stats.vipUsers}</p>
              <p className="text-xs lg:text-sm text-white/80 truncate">Clientes VIP</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mini stats secundários */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-lg font-bold">
              R$ {stats.avgOrderValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">Ticket Médio</p>
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Clock className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="text-lg font-bold">{stats.newThisMonth}</p>
            <p className="text-xs text-muted-foreground">Novos este mês</p>
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <p className="text-lg font-bold">
              {users.reduce((sum, u) => sum + u.total_orders, 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total de Pedidos</p>
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <Star className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-lg font-bold">
              {((stats.withOrders / stats.total) * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <AdminCard
        title="Lista de Usuários"
        description={`${processedUsers.length} de ${users.length} usuários`}
        icon={User}
      >
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email, telefone, nome ou apelido..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Filter className="h-4 w-4" />
                    {filter === "all" ? "Todos" : 
                     filter === "with_orders" ? "Com Compras" :
                     filter === "without_orders" ? "Sem Compras" : "VIP"}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Filtrar por</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilter("all")}>
                    Todos os usuários
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter("with_orders")}>
                    Com compras
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter("without_orders")}>
                    Sem compras
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilter("vip")}>
                    <Crown className="h-4 w-4 mr-2 text-amber-500" />
                    Clientes VIP (R$500+)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <ArrowUpDown className="h-4 w-4" />
                    Ordenar
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => toggleSort("created_at")}>
                    Data de cadastro {sortField === "created_at" && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("total_spent")}>
                    Total gasto {sortField === "total_spent" && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("total_orders")}>
                    Nº de pedidos {sortField === "total_orders" && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("last_order_date")}>
                    Último pedido {sortField === "last_order_date" && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleSort("email")}>
                    Email {sortField === "email" && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Table */}
          {processedUsers.length === 0 ? (
            <AdminEmptyState
              icon={Users}
              title="Nenhum usuário encontrado"
              description="Tente alterar os termos da busca ou filtros"
            />
          ) : (
            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Usuário</TableHead>
                    <TableHead className="hidden md:table-cell">Contato</TableHead>
                    <TableHead className="text-center">Pedidos</TableHead>
                    <TableHead className="text-right">Total Gasto</TableHead>
                    <TableHead className="hidden lg:table-cell">Último Pedido</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedUsers.map((user) => {
                    const tier = getUserTier(user.total_spent);
                    
                    return (
                      <TableRow key={user.id} className="hover:bg-muted/30">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar className="h-10 w-10 border-2 border-primary/20">
                                <AvatarImage src={user.avatar_url || ""} alt="Avatar" />
                                <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
                                  {getInitials(user)}
                                </AvatarFallback>
                              </Avatar>
                              {tier && (
                                <div className={cn(
                                  "absolute -bottom-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center",
                                  tier.color
                                )}>
                                  <tier.icon className="h-3 w-3 text-white" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium truncate">{getDisplayName(user)}</p>
                                {tier && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 hidden sm:inline-flex">
                                    {tier.label}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="space-y-1">
                            {user.phone ? (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="truncate">{user.phone}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sem telefone</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge 
                            variant={user.total_orders > 0 ? "default" : "secondary"}
                            className={cn(
                              "font-bold",
                              user.total_orders > 0 && "bg-green-500/10 text-green-600 hover:bg-green-500/20",
                              user.total_orders >= 5 && "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20",
                              user.total_orders >= 10 && "bg-purple-500/10 text-purple-600 hover:bg-purple-500/20"
                            )}
                          >
                            {user.total_orders}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "font-bold",
                            user.total_spent > 0 && "text-primary",
                            user.total_spent >= 500 && "text-amber-500"
                          )}>
                            R$ {user.total_spent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {user.last_order_date ? (
                            <div className="text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(user.last_order_date), { 
                                addSuffix: true, 
                                locale: ptBR 
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Nunca</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setSelectedUser(user)}
                              title="Ver detalhes"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                              onClick={() => openBalanceDialog(user)}
                              title="Definir saldo"
                            >
                              <Wallet className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              onClick={() => setDeleteDialogUser(user)}
                              title="Excluir usuário"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </AdminCard>

      {/* User Detail Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-primary/20">
                <AvatarImage src={selectedUser?.avatar_url || ""} alt="Avatar" />
                <AvatarFallback className="text-lg font-bold bg-primary/10 text-primary">
                  {selectedUser && getInitials(selectedUser)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg">{selectedUser && getDisplayName(selectedUser)}</p>
                <p className="text-sm font-normal text-muted-foreground">{selectedUser?.email}</p>
              </div>
            </DialogTitle>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-4">
              {/* User Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Total de Pedidos</p>
                  <p className="text-xl font-bold text-primary">{selectedUser.total_orders}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Total Gasto</p>
                  <p className="text-xl font-bold text-green-500">
                    R$ {selectedUser.total_spent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Balance */}
              <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-lg p-4 border border-green-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Wallet className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Saldo Disponível</p>
                      <p className="text-xl font-bold text-green-500">
                        R$ {selectedUser.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setSelectedUser(null);
                      openBalanceDialog(selectedUser);
                    }}
                    className="border-green-500/30 text-green-600 hover:bg-green-500/10"
                  >
                    Editar
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Contact Info */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Informações de Contato</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{selectedUser.email}</span>
                  </div>
                  {selectedUser.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{selectedUser.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Cadastrado em {format(new Date(selectedUser.created_at), "dd/MM/yyyy 'às' HH:mm")}</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Recent Orders */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Últimos Pedidos</p>
                {userOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhum pedido encontrado
                  </p>
                ) : (
                  <ScrollArea className="h-[180px]">
                    <div className="space-y-2">
                      {userOrders.map((order) => (
                        <div key={order.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                          <div>
                            <p className="text-sm font-medium">#{order.id.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(order.created_at), "dd/MM/yyyy")}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-primary">
                              R$ {order.total_amount.toFixed(2)}
                            </p>
                            <Badge className={cn("text-xs", getStatusColor(order.status || "pending"))}>
                              {getStatusLabel(order.status || "pending")}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Balance Edit Dialog */}
      <Dialog open={!!balanceDialogUser} onOpenChange={() => setBalanceDialogUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-green-500" />
              Definir Saldo
            </DialogTitle>
            <DialogDescription>
              Atualize o saldo da conta de <strong>{balanceDialogUser?.email}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="balance">Novo saldo (R$)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                <Input
                  id="balance"
                  type="text"
                  inputMode="decimal"
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  placeholder="0,00"
                  className="pl-10 text-lg font-semibold"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Saldo atual: R$ {balanceDialogUser?.balance.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBalanceDialogUser(null)}
              disabled={updatingBalance}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleUpdateBalance}
              disabled={updatingBalance}
              className="bg-green-600 hover:bg-green-700"
            >
              {updatingBalance ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar Saldo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={!!deleteDialogUser} onOpenChange={() => setDeleteDialogUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              Excluir Usuário
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Tem certeza que deseja excluir o usuário <strong>{deleteDialogUser?.email}</strong>?
              </p>
              <p className="text-red-500 font-medium">
                Esta ação não pode ser desfeita. O perfil e permissões do usuário serão removidos permanentemente.
              </p>
              {deleteDialogUser && deleteDialogUser.total_orders > 0 && (
                <p className="text-amber-500">
                  ⚠️ Este usuário possui {deleteDialogUser.total_orders} pedido(s) registrado(s).
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deletingUser}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingUser ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Excluindo...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir Usuário
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
