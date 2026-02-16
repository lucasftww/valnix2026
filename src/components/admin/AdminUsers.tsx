import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Loader2, Search, Mail, Phone, Calendar, User, Users, 
  ShoppingCart, DollarSign, TrendingUp, Crown, Star, 
  ChevronDown, Eye, Filter, UserCheck, Clock, Wallet, Trash2, AlertTriangle, Copy, Sparkles
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AdminEmptyState } from "./AdminEmptyState";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAdminUsers, useUserOrders, updateUserBalance, deleteFirebaseUser, type FirebaseUser } from "@/hooks/firebase/useFirebaseUsers";
import { auth } from "@/integrations/firebase/config";
import { invokeFunction } from "@/lib/apiHelper";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

type SortField = "email" | "total_orders" | "total_spent" | "created_at" | "last_order_date";
type SortOrder = "asc" | "desc";
type FilterType = "all" | "with_orders" | "without_orders";

const safeDate = (dateStr: string | undefined | null | { seconds: number; nanoseconds: number }): Date => {
  if (!dateStr) return new Date(0);
  if (typeof dateStr === 'object' && 'seconds' in dateStr) return new Date(dateStr.seconds * 1000);
  const d = new Date(dateStr as string);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ removed: string[]; removedCount: number; totalChecked: number } | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading, error } = useAdminUsers();
  const { data: userOrders = [] } = useUserOrders(selectedUser?.id || null);

  const handleUpdateBalance = async () => {
    if (!balanceDialogUser) return;
    const balanceValue = parseFloat(newBalance.replace(",", "."));
    if (isNaN(balanceValue) || balanceValue < 0) {
      toast({ title: "Valor inválido", description: "Digite um valor numérico válido.", variant: "destructive" });
      return;
    }
    setUpdatingBalance(true);
    try {
      await updateUserBalance(balanceDialogUser.id, balanceValue);
      toast({ title: "Saldo atualizado!", description: `Saldo definido para R$ ${balanceValue.toFixed(2)}` });
      queryClient.invalidateQueries({ queryKey: ["firebase-admin-users"] });
      setBalanceDialogUser(null);
      setNewBalance("");
    } catch (error) {
      console.error("Error updating balance:", error);
      toast({ title: "Erro ao atualizar saldo", variant: "destructive" });
    } finally { setUpdatingBalance(false); }
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
      toast({ title: "Usuário excluído!", description: `${deleteDialogUser.email} removido.` });
      queryClient.invalidateQueries({ queryKey: ["firebase-admin-users"] });
      setDeleteDialogUser(null);
    } catch (error) {
      console.error("Error deleting user:", error);
      toast({ title: "Erro ao excluir", variant: "destructive" });
    } finally { setDeletingUser(false); }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado!` });
  };

  const handleCleanup = useCallback(async () => {
    if (!confirm("Tem certeza? Isso vai remover perfis órfãos (sem conta no Firebase Auth) e emails bloqueados.")) return;
    setCleaningUp(true);
    setCleanupResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "cleanup-users" },
        headers: { "x-firebase-token": token },
        body: {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCleanupResult(data);
      toast({ 
        title: "Limpeza concluída!", 
        description: `${data.removedCount} usuários removidos de ${data.totalChecked} verificados.` 
      });
      queryClient.invalidateQueries({ queryKey: ["firebase-admin-users"] });
    } catch (err) {
      console.error("Cleanup error:", err);
      toast({ title: "Erro na limpeza", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCleaningUp(false);
    }
  }, [toast, queryClient]);

  const processedUsers = users
    .filter((user) => {
      const matchesSearch = 
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.phone?.includes(searchTerm) ||
        user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.nickname?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      switch (filter) {
        case "with_orders": return user.total_orders > 0;
        case "without_orders": return user.total_orders === 0;
        default: return true;
      }
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "email": comparison = a.email.localeCompare(b.email); break;
        case "total_orders": comparison = a.total_orders - b.total_orders; break;
        case "total_spent": comparison = a.total_spent - b.total_spent; break;
        case "created_at": comparison = safeDate(a.created_at).getTime() - safeDate(b.created_at).getTime(); break;
        case "last_order_date":
          const dateA = a.last_order_date ? safeDate(a.last_order_date).getTime() : 0;
          const dateB = b.last_order_date ? safeDate(b.last_order_date).getTime() : 0;
          comparison = dateA - dateB; break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("desc"); }
  };

  const getInitials = (user: FirebaseUser) => {
    if (user.nickname) return user.nickname.slice(0, 2).toUpperCase();
    if (user.full_name) return user.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    return user.email?.slice(0, 2).toUpperCase() || "??";
  };

  const getDisplayName = (user: FirebaseUser) => user.nickname || user.full_name || user.email?.split("@")[0] || "Usuário";

  const getUserTier = (_totalSpent: number) => {
    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-500/10 text-green-500";
      case "processing": return "bg-blue-500/10 text-blue-500";
      case "pending": return "bg-yellow-500/10 text-yellow-500";
      case "cancelled": return "bg-red-500/10 text-red-500";
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

  const stats = {
    total: users.length,
    withOrders: users.filter(u => u.total_orders > 0).length,
    totalSpent: users.reduce((sum, u) => sum + u.total_spent, 0),
    avgOrderValue: users.filter(u => u.total_orders > 0).length > 0 
      ? users.reduce((sum, u) => sum + u.total_spent, 0) / users.filter(u => u.total_orders > 0).reduce((sum, u) => sum + u.total_orders, 0) : 0,
    newThisMonth: users.filter(u => {
      const d = safeDate(u.created_at); const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    
    conversionRate: users.length > 0 ? ((users.filter(u => u.total_orders > 0).length / users.length) * 100).toFixed(0) : '0',
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative">
          <div className="w-12 h-12 border-4 border-primary/20 rounded-full" />
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
        </div>
        <p className="text-sm text-muted-foreground mt-4">Carregando usuários...</p>
      </div>
    );
  }

  if (error) return <AdminEmptyState icon={Users} title="Erro ao carregar" description={(error as Error).message} />;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Usuários</span>
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-500" />
                </div>
              </div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.newThisMonth} novos este mês</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Compradores</span>
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <UserCheck className="w-4 h-4 text-green-500" />
                </div>
              </div>
              <p className="text-2xl font-bold text-green-500">{stats.withOrders}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.conversionRate}% de conversão</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Receita</span>
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-purple-500" />
                </div>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(stats.totalSpent)}</p>
              <p className="text-xs text-muted-foreground mt-1">Ticket médio {formatCurrency(stats.avgOrderValue)}</p>
            </CardContent>
          </Card>

        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por email, telefone, nome..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-9 bg-card/50" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{processedUsers.length} de {users.length}</span>

            <Button 
              variant="outline" 
              size="sm" 
              className="gap-1.5 h-9 border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
              onClick={handleCleanup}
              disabled={cleaningUp}
            >
              {cleaningUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {cleaningUp ? "Limpando..." : "Limpar Órfãos"}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9">
                  <Filter className="h-3.5 w-3.5" />
                  {filter === "all" ? "Todos" : filter === "with_orders" ? "Compradores" : "Sem compras"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filtrar por</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setFilter("all")}>Todos</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter("with_orders")}>Compradores</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter("without_orders")}>Sem compras</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Ordenar
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {([
                  ["created_at", "Data de cadastro"],
                  ["total_spent", "Total gasto"],
                  ["total_orders", "Nº de pedidos"],
                  ["last_order_date", "Último pedido"],
                  ["email", "Email"],
                ] as [SortField, string][]).map(([field, label]) => (
                  <DropdownMenuItem key={field} onClick={() => toggleSort(field)}>
                    {label} {sortField === field && (sortOrder === "desc" ? "↓" : "↑")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Users Table */}
        {processedUsers.length === 0 ? (
          <AdminEmptyState icon={Users} title="Nenhum usuário encontrado" description="Ajuste os filtros ou busca" />
        ) : (
          <Card className="border-border/50 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold">Usuário</TableHead>
                    <TableHead className="hidden md:table-cell font-semibold">Contato</TableHead>
                    <TableHead className="text-center font-semibold">Pedidos</TableHead>
                    <TableHead className="text-right font-semibold">Total Gasto</TableHead>
                    <TableHead className="hidden lg:table-cell font-semibold">Saldo</TableHead>
                    <TableHead className="hidden lg:table-cell font-semibold">Último Pedido</TableHead>
                    <TableHead className="text-center font-semibold w-[120px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedUsers.map((user) => {
                    const tier = getUserTier(user.total_spent);
                    return (
                      <TableRow key={user.id} className="group hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => setSelectedUser(user)}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                              <Avatar className="h-9 w-9 border border-border/50">
                                <AvatarImage src={user.avatar_url || ""} alt="Avatar" />
                                <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">{getInitials(user)}</AvatarFallback>
                              </Avatar>
                              {tier && (
                                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background flex items-center justify-center border border-border/50">
                                  <tier.icon className="h-2.5 w-2.5 text-yellow-500" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium text-sm truncate max-w-[140px]">{getDisplayName(user)}</p>
                                {tier && (
                                  <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border hidden sm:inline-flex", tier.color)}>
                                    {tier.label}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate max-w-[160px] select-all cursor-text">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                          {user.phone ? (
                            <div className="flex items-center gap-1.5 text-sm">
                              <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="select-all cursor-text">{user.phone}</span>
                              <button onClick={() => copyToClipboard(user.phone!, "Telefone")} className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100">
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className={cn(
                            "font-bold text-xs",
                            user.total_orders > 0 && "bg-green-500/10 text-green-500",
                            user.total_orders >= 5 && "bg-blue-500/10 text-blue-500",
                            user.total_orders >= 10 && "bg-purple-500/10 text-purple-500"
                          )}>
                            {user.total_orders}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "font-semibold text-sm",
                            user.total_spent > 0 && "text-primary",
                            user.total_spent >= 500 && "text-yellow-500"
                          )}>
                            {formatCurrency(user.total_spent)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className={cn("text-sm font-medium", user.balance > 0 ? "text-green-500" : "text-muted-foreground/50")}>
                            {user.balance > 0 ? formatCurrency(user.balance) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {user.last_order_date ? (
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(safeDate(user.last_order_date), { addSuffix: true, locale: ptBR })}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Nunca</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedUser(user)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Ver detalhes</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10" onClick={() => openBalanceDialog(user)}>
                                  <Wallet className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Editar saldo</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => setDeleteDialogUser(user)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Excluir</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        {/* User Detail Dialog */}
        <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            {selectedUser && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <Avatar className="h-11 w-11 border border-border/50">
                      <AvatarImage src={selectedUser.avatar_url || ""} alt="Avatar" />
                      <AvatarFallback className="font-bold bg-primary/10 text-primary">{getInitials(selectedUser)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-lg">{getDisplayName(selectedUser)}</p>
                      <p className="text-sm font-normal text-muted-foreground select-all cursor-text">{selectedUser.email}</p>
                    </div>
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/20 rounded-xl p-3 border border-border/30 text-center">
                      <p className="text-xl font-bold text-primary">{selectedUser.total_orders}</p>
                      <p className="text-[11px] text-muted-foreground">Pedidos</p>
                    </div>
                    <div className="bg-muted/20 rounded-xl p-3 border border-border/30 text-center">
                      <p className="text-xl font-bold text-green-500">{formatCurrency(selectedUser.total_spent)}</p>
                      <p className="text-[11px] text-muted-foreground">Total Gasto</p>
                    </div>
                    <div className="bg-muted/20 rounded-xl p-3 border border-border/30 text-center">
                      <p className="text-xl font-bold text-emerald-500">{formatCurrency(selectedUser.balance)}</p>
                      <p className="text-[11px] text-muted-foreground">Saldo</p>
                    </div>
                  </div>

                  {/* Contact */}
                  <div className="space-y-2 p-3 rounded-xl bg-muted/10 border border-border/30">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contato</h4>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="select-all cursor-text">{selectedUser.email}</span>
                        <button onClick={() => copyToClipboard(selectedUser.email, "E-mail")} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                      </div>
                      {selectedUser.phone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="select-all cursor-text">{selectedUser.phone}</span>
                          <button onClick={() => copyToClipboard(selectedUser.phone!, "Telefone")} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span>Cadastrado em {format(safeDate(selectedUser.created_at), "dd/MM/yyyy 'às' HH:mm")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 border-green-500/30 text-green-500 hover:bg-green-500/10" onClick={() => { setSelectedUser(null); openBalanceDialog(selectedUser); }}>
                      <Wallet className="h-4 w-4 mr-1.5" /> Editar Saldo
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10" onClick={() => { setSelectedUser(null); setDeleteDialogUser(selectedUser); }}>
                      <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
                    </Button>
                  </div>

                  <Separator />

                  {/* Orders */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Últimos Pedidos</h4>
                    {userOrders.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido</p>
                    ) : (
                      <ScrollArea className="h-[180px]">
                        <div className="space-y-2">
                          {userOrders.map((order) => (
                            <div key={order.id} className="flex items-center justify-between p-2.5 bg-muted/15 rounded-lg border border-border/20">
                              <div>
                                <code className="text-xs font-mono text-muted-foreground">#{order.id.slice(0, 8)}</code>
                                <p className="text-[11px] text-muted-foreground">{format(safeDate(order.created_at), "dd/MM/yyyy")}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-primary">{formatCurrency(order.total_amount)}</p>
                                <Badge className={cn("text-[10px] px-1.5 py-0", getStatusColor(order.status || "pending"))}>
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
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Balance Dialog */}
        <Dialog open={!!balanceDialogUser} onOpenChange={() => setBalanceDialogUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-green-500" /> Definir Saldo
              </DialogTitle>
              <DialogDescription>
                Atualizar saldo de <strong>{balanceDialogUser?.email}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <div className="space-y-2">
                <Label htmlFor="balance">Novo saldo (R$)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                  <Input id="balance" type="text" inputMode="decimal" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} placeholder="0,00" className="pl-10 text-lg font-semibold" />
                </div>
                <p className="text-xs text-muted-foreground">Atual: R$ {balanceDialogUser?.balance.toFixed(2).replace(".", ",")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBalanceDialogUser(null)} disabled={updatingBalance}>Cancelar</Button>
              <Button onClick={handleUpdateBalance} disabled={updatingBalance} className="bg-green-600 hover:bg-green-700">
                {updatingBalance ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Salvando...</> : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <AlertDialog open={!!deleteDialogUser} onOpenChange={() => setDeleteDialogUser(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-500">
                <AlertTriangle className="h-5 w-5" /> Excluir Usuário
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>Excluir <strong>{deleteDialogUser?.email}</strong>?</p>
                <p className="text-red-500 font-medium">Esta ação não pode ser desfeita.</p>
                {deleteDialogUser && deleteDialogUser.total_orders > 0 && (
                  <p className="text-yellow-500">⚠️ {deleteDialogUser.total_orders} pedido(s) registrado(s).</p>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDeleteUser(); }} disabled={deletingUser} className="bg-red-600 hover:bg-red-700 text-white">
                {deletingUser ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Excluindo...</> : <><Trash2 className="h-4 w-4 mr-1.5" />Excluir</>}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};
