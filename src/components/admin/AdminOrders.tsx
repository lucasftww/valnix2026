import { useState, useEffect, useMemo } from "react";
import { db } from "@/integrations/firebase/config";
import { collection, getDocs, onSnapshot, doc, updateDoc, deleteDoc, Timestamp, query, where } from "firebase/firestore";
import { supabase } from "@/integrations/supabase/client";
import { useAutoVerifyPixPayments } from "@/hooks/firebase/useAutoVerifyPixPayments";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package, Send, Loader2, RefreshCw, Trash2, Search, ChevronDown,
  CreditCard, QrCode, Wallet, Clock, CheckCircle2, XCircle, AlertCircle,
  Eye, Copy, Hash, Mail, Phone, User, Calendar, DollarSign,
  ShoppingBag, ArrowUpDown, Filter, MoreHorizontal, ExternalLink
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Order {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
  payment_method: string | null;
  flowpay_charge_id: string | null;
  created_at: string;
  user_id?: string;
  notes?: string | null;
}

interface OrderItem {
  id: string;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_code: string | null;
  product_id: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────
const getPaymentMethodIcon = (method: string | null, paymentStatus?: string) => {
  const resolved = method || (paymentStatus === 'paid' ? 'pix' : null);
  switch (resolved) {
    case 'pix': return <QrCode className="w-4 h-4" />;
    case 'card': return <CreditCard className="w-4 h-4" />;
    case 'balance': return <Wallet className="w-4 h-4" />;
    default: return <DollarSign className="w-4 h-4" />;
  }
};

const getPaymentMethodLabel = (method: string | null, paymentStatus?: string) => {
  const resolved = method || (paymentStatus === 'paid' ? 'pix' : null);
  switch (resolved) {
    case 'pix': return 'PIX';
    case 'card': return 'Cartão';
    case 'balance': return 'Saldo';
    default: return 'N/A';
  }
};

const getStatusConfig = (status: string) => {
  const configs: Record<string, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
    pending: { label: "Pendente", color: "text-yellow-500", icon: <Clock className="w-3.5 h-3.5" />, bg: "bg-yellow-500/10 border-yellow-500/20" },
    processing: { label: "Processando", color: "text-blue-500", icon: <Loader2 className="w-3.5 h-3.5" />, bg: "bg-blue-500/10 border-blue-500/20" },
    completed: { label: "Concluído", color: "text-green-500", icon: <CheckCircle2 className="w-3.5 h-3.5" />, bg: "bg-green-500/10 border-green-500/20" },
    cancelled: { label: "Cancelado", color: "text-red-500", icon: <XCircle className="w-3.5 h-3.5" />, bg: "bg-red-500/10 border-red-500/20" },
  };
  return configs[status] || configs.pending;
};

const getPaymentStatusConfig = (status: string) => {
  if (status === 'paid') return { label: "Pago", color: "text-green-500", bg: "bg-green-500/10 border-green-500/20", icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  return { label: "Pendente", color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", icon: <AlertCircle className="w-3.5 h-3.5" /> };
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// ── Component ─────────────────────────────────────────────────────
export const AdminOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [deliveryCode, setDeliveryCode] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPayment, setFilterPayment] = useState<string>("all");
  const [filterMethod, setFilterMethod] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [cleanType, setCleanType] = useState<string | null>(null);
  const [cleaningActive, setCleaningActive] = useState(false);
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailAddons, setDetailAddons] = useState<any[]>([]);
  const [restoringOrders, setRestoringOrders] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useAutoVerifyPixPayments(orders as any, () => fetchOrders());

  // Keep detailOrder in sync with orders list
  useEffect(() => {
    if (detailOrder) {
      const updated = orders.find(o => o.id === detailOrder.id);
      if (updated && (updated.status !== detailOrder.status || updated.payment_status !== detailOrder.payment_status)) {
        setDetailOrder(updated);
      }
    }
  }, [orders]);
  useEffect(() => {
    const ordersRef = collection(db, "orders");
    const unsubscribe = onSnapshot(ordersRef, () => { fetchOrders(); });
    return () => unsubscribe();
  }, []);

  const fetchOrders = async () => {
    try {
      const ordersRef = collection(db, "orders");
      const snapshot = await getDocs(ordersRef);
      const ordersData = snapshot.docs.map(docSnapshot => {
        const data = docSnapshot.data();
        let createdAt: string;
        if (data.created_at?.toDate) {
          createdAt = data.created_at.toDate().toISOString();
        } else if (typeof data.created_at === 'string') {
          createdAt = data.created_at;
        } else {
          createdAt = new Date().toISOString();
        }
        return {
          id: docSnapshot.id,
          customer_name: data.customer_name || '',
          customer_email: data.customer_email || '',
          customer_phone: data.customer_phone || null,
          total_amount: data.total_amount || 0,
          status: data.status || 'pending',
          payment_status: data.payment_status || 'pending',
          payment_method: data.payment_method || null,
          flowpay_charge_id: data.flowpay_charge_id || null,
          created_at: createdAt,
          user_id: data.user_id || undefined,
          notes: data.notes || null,
        } as Order;
      });
      ordersData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setOrders(ordersData);
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      toast({ title: "Erro ao carregar pedidos", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Filtered & sorted list ──────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let result = orders;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(o =>
        o.customer_name.toLowerCase().includes(term) ||
        o.customer_email.toLowerCase().includes(term) ||
        o.customer_phone?.includes(term) ||
        o.id.toLowerCase().includes(term)
      );
    }

    if (filterStatus !== "all") result = result.filter(o => o.status === filterStatus);
    if (filterPayment !== "all") result = result.filter(o => o.payment_status === filterPayment);
    if (filterMethod !== "all") result = result.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === filterMethod);

    result = [...result].sort((a, b) => {
      if (sortField === "date") {
        const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      const diff = a.total_amount - b.total_amount;
      return sortDir === "asc" ? diff : -diff;
    });

    return result;
  }, [orders, searchTerm, filterStatus, filterPayment, filterMethod, sortField, sortDir]);

  // ── Stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
    const paidOrders = orders.filter(o => o.payment_status === 'paid');
    const todayPaid = todayOrders.filter(o => o.payment_status === 'paid');
    const pendingDelivery = orders.filter(o => o.payment_status === 'paid' && o.status !== 'completed' && o.status !== 'cancelled');

    return {
      total: orders.length,
      todayCount: todayOrders.length,
      todayRevenue: todayPaid.reduce((sum, o) => sum + o.total_amount, 0),
      totalRevenue: paidOrders.reduce((sum, o) => sum + o.total_amount, 0),
      pendingDelivery: pendingDelivery.length,
      paidCount: paidOrders.length,
      pixCount: orders.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === 'pix' && o.payment_status === 'paid').length,
      cardCount: orders.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === 'card' && o.payment_status === 'paid').length,
      balanceCount: orders.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === 'balance' && o.payment_status === 'paid').length,
    };
  }, [orders]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleRestoreOrders = async () => {
    setRestoringOrders(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/restore-orders`,
        { headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } }
      );
      const data = await response.json();
      if (data.success) {
        toast({ title: `Restauração concluída!`, description: `${data.restored} pedido(s) restaurado(s), ${data.skipped} já existente(s).` });
        if (data.restored > 0) fetchOrders();
      } else {
        toast({ title: "Erro na restauração", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Erro ao restaurar", description: error.message, variant: "destructive" });
    } finally {
      setRestoringOrders(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
    toast({ title: "Lista atualizada" });
  };

  const handleCleanByType = async () => {
    setCleaningActive(true);
    try {
      // Safety: never delete orders created in the last 30 minutes (webhook may still confirm payment)
      const safetyThreshold = new Date(Date.now() - 5 * 60 * 1000).getTime();
      const isSafeToDelete = (o: Order) => new Date(o.created_at).getTime() < safetyThreshold;

      let toDelete: Order[] = [];
      if (cleanType === "unpaid") toDelete = orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled' && isSafeToDelete(o));
      else if (cleanType === "processing") toDelete = orders.filter(o => o.status === 'processing' && o.payment_status !== 'paid' && isSafeToDelete(o));
      else if (cleanType === "pending") toDelete = orders.filter(o => o.status === 'pending' && o.payment_status === 'pending' && isSafeToDelete(o));
      else if (cleanType === "cancelled") toDelete = orders.filter(o => o.status === 'cancelled' && o.payment_status !== 'paid');

      const skipped = orders.length - toDelete.length;
      if (skipped > 0 && cleanType !== "cancelled") {
        console.log(`⚠️ ${skipped} pedido(s) recente(s) preservado(s) (< 30min)`);
      }

      for (const order of toDelete) {
        const q = query(collection(db, "order_items"), where("order_id", "==", order.id));
        const itemsSnapshot = await getDocs(q);
        for (const item of itemsSnapshot.docs) {
          await deleteDoc(doc(db, "order_items", item.id));
        }
        await deleteDoc(doc(db, "orders", order.id));
      }

      toast({ title: "Limpeza concluída!", description: `${toDelete.length} pedido(s) removido(s).` });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao limpar pedidos", description: error.message, variant: "destructive" });
    } finally {
      setCleaningActive(false);
      setCleanType(null);
    }
  };

  const handleVerifyPayment = async (order: Order) => {
    if (!order.flowpay_charge_id) {
      toast({ title: "Sem ID de cobrança", description: "Este pedido não tem um ID FlowPay.", variant: "destructive" });
      return;
    }
    setVerifyingPayment(order.id);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${order.flowpay_charge_id}`,
        { headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } }
      );
      const data = await response.json();
      if (data.success && data.status === 'COMPLETED') {
        const orderRef = doc(db, "orders", order.id);
        await updateDoc(orderRef, { payment_status: 'paid', status: 'processing', updated_at: Timestamp.now() });
        toast({ title: "Pagamento confirmado! ✅", description: `Pedido #${order.id.substring(0, 8)} pago.` });
        fetchOrders();
      } else {
        toast({ title: "Pagamento não confirmado", description: `Status: ${data.status || 'desconhecido'}` });
      }
    } catch (error: any) {
      toast({ title: "Erro ao verificar", description: error.message, variant: "destructive" });
    } finally {
      setVerifyingPayment(null);
    }
  };

  const loadOrderItems = async (orderId: string) => {
    setLoadingItems(true);
    try {
      const q = query(collection(db, "order_items"), where("order_id", "==", orderId));
      const snapshot = await getDocs(q);
      const itemsData = snapshot.docs.map(docSnapshot => ({ id: docSnapshot.id, ...docSnapshot.data() } as OrderItem));
      setOrderItems(itemsData);
    } catch (error: any) {
      toast({ title: "Erro ao carregar itens", description: error.message, variant: "destructive" });
    } finally {
      setLoadingItems(false);
    }
  };

  const handleViewDetail = async (order: Order) => {
    setDetailOrder(order);
    setLoadingDetail(true);
    setDetailAddons([]);
    try {
      const q = query(collection(db, "order_items"), where("order_id", "==", order.id));
      const snapshot = await getDocs(q);
      const itemsData = snapshot.docs.map(docSnapshot => ({ id: docSnapshot.id, ...docSnapshot.data() } as OrderItem));
      setDetailItems(itemsData);

      // Fetch upsell addons from Supabase
      const { data: addons } = await supabase
        .from("sale_addons")
        .select("*")
        .eq("order_id", order.id);
      setDetailAddons(addons || []);
    } catch (error: any) {
      toast({ title: "Erro ao carregar itens", description: error.message, variant: "destructive" });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAddDeliveryCode = async (itemId: string) => {
    if (!deliveryCode.trim()) {
      toast({ title: "Código inválido", description: "Insira um código de entrega", variant: "destructive" });
      return;
    }
    setSendingEmail(true);
    try {
      const itemRef = doc(db, "order_items", itemId);
      await updateDoc(itemRef, { delivery_code: deliveryCode.trim() });
      const targetOrder = detailOrder || selectedOrder;
      if (targetOrder) {
        const orderRef = doc(db, "orders", targetOrder.id);
        await updateDoc(orderRef, { status: "completed", updated_at: Timestamp.now() });
      }
      toast({ title: "Código salvo!", description: "O cliente pode ver na página 'Meus Pedidos'." });
      setDeliveryCode("");
      setSelectedItemId(null);
      if (detailOrder) handleViewDetail(detailOrder);
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao adicionar código", description: error.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const orderRef = doc(db, "orders", orderId);
      await updateDoc(orderRef, { status: newStatus, updated_at: Timestamp.now() });
      toast({ title: "Status atualizado!" });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado!` });
  };

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando pedidos...</p>
      </div>
    </div>
  );

  const safetyThresholdForCounts = new Date(Date.now() - 5 * 60 * 1000).getTime();
  const isSafeForCount = (o: Order) => new Date(o.created_at).getTime() < safetyThresholdForCounts;

  const cleanCounts = {
    unpaid: orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled' && isSafeForCount(o)).length,
    processing: orders.filter(o => o.status === 'processing' && o.payment_status !== 'paid' && isSafeForCount(o)).length,
    pending: orders.filter(o => o.status === 'pending' && o.payment_status === 'pending' && isSafeForCount(o)).length,
    cancelled: orders.filter(o => o.status === 'cancelled' && o.payment_status !== 'paid').length,
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* ── Stats Cards ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hoje</span>
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold">{stats.todayCount}</p>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(stats.todayRevenue)}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pagos</span>
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                </div>
              </div>
              <p className="text-2xl font-bold text-green-500">{stats.paidCount}</p>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(stats.totalRevenue)}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Entregas</span>
                <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Package className="w-4 h-4 text-orange-500" />
                </div>
              </div>
              <p className="text-2xl font-bold text-orange-500">{stats.pendingDelivery}</p>
              <p className="text-xs text-muted-foreground mt-1">aguardando entrega</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Métodos</span>
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-blue-500" />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-sm">
                      <QrCode className="w-3.5 h-3.5 text-green-500" />
                      <span className="font-semibold">{stats.pixCount}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>PIX</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-sm">
                      <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                      <span className="font-semibold">{stats.cardCount}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Cartão</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-sm">
                      <Wallet className="w-3.5 h-3.5 text-purple-500" />
                      <span className="font-semibold">{stats.balanceCount}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Saldo</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nome, email, telefone, ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 bg-card/50"
              />
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px] h-9 bg-card/50">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="processing">Processando</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterPayment} onValueChange={setFilterPayment}>
              <SelectTrigger className="w-[140px] h-9 bg-card/50">
                <DollarSign className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger className="w-[130px] h-9 bg-card/50">
                <CreditCard className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Método" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
                <SelectItem value="balance">Saldo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''}
            </span>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
              <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>

            <Button variant="outline" size="sm" onClick={handleRestoreOrders} disabled={restoringOrders} className="h-9">
              {restoringOrders ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Package className="w-4 h-4 mr-1.5" />}
              Restaurar Pagos
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="destructive" size="sm" disabled={cleaningActive} className="h-9">
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Limpar
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Remover por status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={cleanCounts.unpaid === 0} onSelect={(e) => { e.preventDefault(); setCleanType("unpaid"); }} className="text-red-500 focus:text-red-500">
                  <Trash2 className="w-4 h-4 mr-2" /> Não pagos ({cleanCounts.unpaid})
                </DropdownMenuItem>
                <DropdownMenuItem disabled={cleanCounts.processing === 0} onSelect={(e) => { e.preventDefault(); setCleanType("processing"); }} className="text-blue-400 focus:text-blue-400">
                  <Trash2 className="w-4 h-4 mr-2" /> Processando ({cleanCounts.processing})
                </DropdownMenuItem>
                <DropdownMenuItem disabled={cleanCounts.pending === 0} onSelect={(e) => { e.preventDefault(); setCleanType("pending"); }} className="text-yellow-500 focus:text-yellow-500">
                  <Trash2 className="w-4 h-4 mr-2" /> Pendentes ({cleanCounts.pending})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={cleanCounts.cancelled === 0} onSelect={(e) => { e.preventDefault(); setCleanType("cancelled"); }} className="text-muted-foreground">
                  <Trash2 className="w-4 h-4 mr-2" /> Cancelados ({cleanCounts.cancelled})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Clean Confirmation ───────────────────────────────────── */}
        <AlertDialog open={!!cleanType} onOpenChange={() => setCleanType(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Confirmar exclusão em massa
              </AlertDialogTitle>
              <AlertDialogDescription>
                {cleanType === "unpaid" && `Excluir permanentemente ${cleanCounts.unpaid} pedido(s) não pago(s).`}
                {cleanType === "processing" && `Excluir permanentemente ${cleanCounts.processing} pedido(s) processando.`}
                {cleanType === "pending" && `Excluir permanentemente ${cleanCounts.pending} pedido(s) pendente(s).`}
                {cleanType === "cancelled" && `Excluir permanentemente ${cleanCounts.cancelled} pedido(s) cancelado(s).`}
                {" "}Essa ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleCleanByType} disabled={cleaningActive}>
                {cleaningActive && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Orders Table ─────────────────────────────────────────── */}
        {filteredOrders.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <ShoppingBag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Nenhum pedido encontrado</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Ajuste os filtros ou aguarde novas vendas</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-[80px] font-semibold">ID</TableHead>
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="font-semibold">
                      <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => toggleSort("amount")}>
                        Valor
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </TableHead>
                    <TableHead className="font-semibold">Método</TableHead>
                    <TableHead className="font-semibold">Pagamento</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">
                      <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => toggleSort("date")}>
                        Data
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </TableHead>
                    <TableHead className="w-[80px] font-semibold text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => {
                    const statusCfg = getStatusConfig(order.status);
                    const paymentCfg = getPaymentStatusConfig(order.payment_status);

                    return (
                      <TableRow
                        key={order.id}
                        className="group cursor-pointer hover:bg-muted/20 transition-colors"
                        onClick={() => handleViewDetail(order)}
                      >
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                #{order.id.slice(0, 6)}
                              </code>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p className="font-mono text-xs">{order.id}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate max-w-[180px]">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[180px]">{order.customer_email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold text-sm">{formatCurrency(order.total_amount)}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
                              (order.payment_method || (order.payment_status === 'paid' ? 'pix' : null)) === 'pix' ? 'bg-green-500/10 text-green-500' :
                              (order.payment_method || (order.payment_status === 'paid' ? 'pix' : null)) === 'card' ? 'bg-blue-500/10 text-blue-500' :
                              (order.payment_method || (order.payment_status === 'paid' ? 'pix' : null)) === 'balance' ? 'bg-purple-500/10 text-purple-500' :
                              'bg-muted text-muted-foreground'
                            }`}>
                               {getPaymentMethodIcon(order.payment_method, order.payment_status)}
                            </div>
                            <span className="text-xs font-medium">{getPaymentMethodLabel(order.payment_method, order.payment_status)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${paymentCfg.bg} ${paymentCfg.color}`}>
                            {paymentCfg.icon}
                            {paymentCfg.label}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${statusCfg.bg} ${statusCfg.color}`}>
                            {statusCfg.icon}
                            {statusCfg.label}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{formatDate(order.created_at)}</p>
                            <p className="text-xs text-muted-foreground">{formatTime(order.created_at)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => handleViewDetail(order)}>
                                <Eye className="w-4 h-4 mr-2" /> Ver detalhes
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(order.id, "ID")}>
                                <Copy className="w-4 h-4 mr-2" /> Copiar ID
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(order.customer_email, "E-mail")}>
                                <Mail className="w-4 h-4 mr-2" /> Copiar e-mail
                              </DropdownMenuItem>
                              {order.customer_phone && (
                                <DropdownMenuItem onClick={() => copyToClipboard(order.customer_phone!, "Telefone")}>
                                  <Phone className="w-4 h-4 mr-2" /> Copiar telefone
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {order.payment_status !== 'paid' && order.flowpay_charge_id && (
                                <DropdownMenuItem onClick={() => handleVerifyPayment(order)} disabled={verifyingPayment === order.id}>
                                  {verifyingPayment === order.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                                  Verificar pagamento
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel className="text-xs">Alterar status</DropdownMenuLabel>
                              {["pending", "processing", "completed", "cancelled"].map(s => (
                                <DropdownMenuItem key={s} onClick={() => updateOrderStatus(order.id, s)} disabled={order.status === s}>
                                  <div className={`w-2 h-2 rounded-full mr-2 ${getStatusConfig(s).color.replace('text-', 'bg-')}`} />
                                  {getStatusConfig(s).label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        {/* ── Order Detail Dialog ──────────────────────────────────── */}
        <Dialog open={!!detailOrder} onOpenChange={(open) => { if (!open) { setDetailOrder(null); setDetailItems([]); setSelectedItemId(null); setDeliveryCode(""); } }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {detailOrder && (() => {
              const statusCfg = getStatusConfig(detailOrder.status);
              const paymentCfg = getPaymentStatusConfig(detailOrder.payment_status);

              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center justify-between">
                      <DialogTitle className="text-lg">
                        Pedido #{detailOrder.id.slice(0, 8)}
                      </DialogTitle>
                      <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.icon}
                        {statusCfg.label}
                      </div>
                    </div>
                    <DialogDescription>Criado em {new Date(detailOrder.created_at).toLocaleString('pt-BR')}</DialogDescription>
                  </DialogHeader>

                  {/* Customer Info */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 border border-border/50">
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium select-text">{detailOrder.customer_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm select-all cursor-text">{detailOrder.customer_email}</span>
                          <button onClick={() => copyToClipboard(detailOrder.customer_email, "E-mail")} className="text-muted-foreground hover:text-foreground transition-colors">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {detailOrder.customer_phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm select-all cursor-text">{detailOrder.customer_phone}</span>
                            <button onClick={() => copyToClipboard(detailOrder.customer_phone!, "Telefone")} className="text-muted-foreground hover:text-foreground transition-colors">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pagamento</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-bold text-primary">{formatCurrency(detailOrder.total_amount)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {getPaymentMethodIcon(detailOrder.payment_method, detailOrder.payment_status)}
                          <span className="text-sm font-medium">{getPaymentMethodLabel(detailOrder.payment_method, detailOrder.payment_status)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${paymentCfg.bg} ${paymentCfg.color}`}>
                            {paymentCfg.icon}
                            {paymentCfg.label}
                          </div>
                        </div>
                        {detailOrder.flowpay_charge_id && (
                          <div className="flex items-center gap-2">
                            <Hash className="w-4 h-4 text-muted-foreground" />
                            <code className="text-xs font-mono text-muted-foreground select-all">{detailOrder.flowpay_charge_id.slice(0, 20)}...</code>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Change */}
                  <div className="flex items-center gap-3">
                    <Label className="text-sm font-medium whitespace-nowrap">Alterar status:</Label>
                    <Select value={detailOrder.status} onValueChange={(value) => { updateOrderStatus(detailOrder.id, value); setDetailOrder({ ...detailOrder, status: value }); }}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="processing">Processando</SelectItem>
                        <SelectItem value="completed">Concluído</SelectItem>
                        <SelectItem value="cancelled">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                    {detailOrder.payment_status !== 'paid' && detailOrder.flowpay_charge_id && (
                      <Button variant="secondary" size="sm" disabled={verifyingPayment === detailOrder.id} onClick={() => handleVerifyPayment(detailOrder)}>
                        {verifyingPayment === detailOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                        Verificar
                      </Button>
                    )}
                  </div>

                  {/* Order Items */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Itens do pedido ({detailItems.length})
                    </h4>

                    {loadingDetail ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : detailItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Nenhum item encontrado</p>
                    ) : (
                      <div className="space-y-3">
                        {detailItems.map((item) => (
                          <div key={item.id} className="flex gap-3 p-3 rounded-lg border border-border/50 bg-card/50">
                            {item.product_image && (
                              <img src={item.product_image} alt={item.product_name} className="w-14 h-14 object-contain bg-muted/50 rounded-lg flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h5 className="font-semibold text-sm">{item.product_name}</h5>
                                  <p className="text-xs text-muted-foreground">
                                    {item.quantity}× {formatCurrency(item.unit_price)} = <span className="font-semibold text-foreground">{formatCurrency(item.total_price)}</span>
                                  </p>
                                </div>
                              </div>

                              {item.delivery_code ? (
                                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2.5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-green-500 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" /> Código entregue
                                    </span>
                                    <button onClick={() => copyToClipboard(item.delivery_code!, "Código")} className="text-green-500/70 hover:text-green-500 transition-colors">
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <code className="text-xs font-mono text-green-400 break-all select-all">{item.delivery_code}</code>
                                </div>
                              ) : selectedItemId === item.id ? (
                                <div className="space-y-2">
                                  <Textarea
                                    placeholder="Cole os códigos aqui..."
                                    value={deliveryCode}
                                    onChange={(e) => setDeliveryCode(e.target.value)}
                                    rows={3}
                                    className="font-mono text-sm"
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => handleAddDeliveryCode(item.id)} disabled={sendingEmail} className="flex-1">
                                      {sendingEmail ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                                      Salvar código
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => { setSelectedItemId(null); setDeliveryCode(""); }}>
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => setSelectedItemId(item.id)} className="w-full h-8 text-xs">
                                  <Package className="w-3.5 h-3.5 mr-1.5" /> Adicionar código
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Upsell Addons */}
                  {detailAddons.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Upsells ({detailAddons.length})
                      </h4>
                      <div className="space-y-2">
                        {detailAddons.map((addon: any) => {
                          const addonLabels: Record<string, string> = {
                            premium_benefits: "🔥 Turbine Gift Card",
                            delivery_priority: "⚡ Entrega Prioritária",
                            data_swap_warranty: "🎁 Proteção Total",
                          };
                          const isPaid = addon.status === "paid";
                          const isSkipped = addon.status === "skipped";
                          return (
                            <div key={addon.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                              isPaid ? "border-green-500/20 bg-green-500/5" : isSkipped ? "border-border/30 bg-muted/20" : "border-yellow-500/20 bg-yellow-500/5"
                            }`}>
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{addonLabels[addon.addon_type] || addon.addon_type}</span>
                                <Badge variant={isPaid ? "default" : isSkipped ? "secondary" : "outline"} className={`text-[10px] ${isPaid ? "bg-green-600" : ""}`}>
                                  {isPaid ? "Pago" : isSkipped ? "Recusado" : "Pendente"}
                                </Badge>
                              </div>
                              <span className={`text-sm font-semibold ${isPaid ? "text-green-500" : "text-muted-foreground"}`}>
                                {addon.amount > 0 ? formatCurrency(addon.amount) : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Hash className="w-3 h-3" />
                      <code className="font-mono select-all">{detailOrder.id}</code>
                      <button onClick={() => copyToClipboard(detailOrder.id, "ID completo")} className="text-muted-foreground hover:text-foreground transition-colors">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    {detailOrder.user_id && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        <span>UID: {detailOrder.user_id.slice(0, 12)}...</span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};
