import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFunction, invokeFunctionFireAndForget } from "@/lib/apiHelper";
import { requireAdminToken } from "@/lib/adminAuth";
import { AdminErrorState } from "./AdminErrorState";
import { generateEventId } from "@/lib/eventId";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useAutoVerifyPixPayments } from "@/hooks/firebase/useAutoVerifyPixPayments";
import { useAutoVerifyCardPayments } from "@/hooks/firebase/useAutoVerifyCardPayments";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package, Send, Loader2, RefreshCw, Trash2, Search, ChevronDown, ChevronLeft, ChevronRight,
  CreditCard, QrCode, Clock, CheckCircle2, XCircle, AlertCircle,
  Eye, Copy, Hash, Mail, Phone, User, Calendar, DollarSign,
  ShoppingBag, ArrowUpDown, Filter, MoreHorizontal, ExternalLink, Pencil, Zap
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
  product_category?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────
const getPaymentMethodIcon = (method: string | null, paymentStatus?: string) => {
  const resolved = method || (paymentStatus === 'paid' ? 'pix' : null);
  switch (resolved) {
    case 'pix': return <QrCode className="w-4 h-4" />;
    case 'card': return <CreditCard className="w-4 h-4" />;
    default: return <DollarSign className="w-4 h-4" />;
  }
};

const getPaymentMethodLabel = (method: string | null, paymentStatus?: string) => {
  const resolved = method || (paymentStatus === 'paid' ? 'pix' : null);
  switch (resolved) {
    case 'pix': return 'PIX';
    case 'card': return 'Cartão';
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
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const { data: rawOrders, isLoading: loading, isError: ordersError, refetch: refetchOrders, isFetching: ordersFetching } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const token = requireAdminToken();
      if (!token) return [];
      const res = await invokeFunction("admin-data", {
        method: "GET",
        queryParams: { resource: "orders" },
        headers: { "x-admin-token": token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ordersArr = Array.isArray(data.orders) ? data.orders : Array.isArray(data) ? data : [];
      if (import.meta.env.DEV) console.log(`[AdminOrders] fetched ${ordersArr.length} orders from API`);
      const ordersData: Order[] = ordersArr.map((o: any) => ({
        id: o.id,
        customer_name: o.customer_name || '',
        customer_email: o.customer_email || '',
        customer_phone: o.customer_phone || null,
        total_amount: Number(o.total_amount) || 0,
        status: o.status || 'pending',
        payment_status: o.payment_status || 'pending',
        payment_method: o.payment_method || null,
        flowpay_charge_id: o.flowpay_charge_id || null,
        created_at: o.created_at ?? o.updated_at ?? '',
        user_id: o.user_id || undefined,
        notes: o.notes || null,
      }));
      ordersData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return ordersData;
    },
    enabled: isAdmin && !authLoading,
    retry: 1,
    refetchInterval: isAdmin ? 120_000 : false,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  });

  // Fetch all sale_addons to identify orders with upsells
  const { data: allAddons } = useQuery({
    queryKey: ['admin-addons-summary'],
    queryFn: async () => {
      const token = requireAdminToken();
      if (!token) return [];
      const res = await invokeFunction("admin-post-payment", {
        method: "GET",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.addons) ? data.addons : [];
    },
    enabled: isAdmin && !authLoading,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  });

  // Map of orderId → addon info (paid addons count + total value)
  const orderAddonsMap = useMemo(() => {
    const map = new Map<string, { count: number; paidCount: number; totalValue: number }>();
    if (!allAddons) return map;
    for (const a of allAddons) {
      if (!a.order_id) continue;
      const existing = map.get(a.order_id) || { count: 0, paidCount: 0, totalValue: 0 };
      existing.count++;
      if (a.status === 'paid') {
        existing.paidCount++;
        existing.totalValue += Number(a.amount) || 0;
      }
      map.set(a.order_id, existing);
    }
    return map;
  }, [allAddons]);

  const orders: Order[] = Array.isArray(rawOrders) ? rawOrders : [];

  const fetchOrders = useCallback(() => { refetchOrders(); }, [refetchOrders]);

  const [deliveryCode, setDeliveryCode] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
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
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailAddons, setDetailAddons] = useState<any[]>([]);
  
  const [reprocessingDelivery, setReprocessingDelivery] = useState(false);
  const [cleanupEmail, setCleanupEmail] = useState("");
  const [cleanupEmailDialogOpen, setCleanupEmailDialogOpen] = useState(false);
  const [cleaningEmail, setCleaningEmail] = useState(false);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDeliveryCode, setEditDeliveryCode] = useState("");

  useAutoVerifyPixPayments(orders as any, fetchOrders);
  useAutoVerifyCardPayments(orders as any, fetchOrders);

  // Keep detailOrder in sync with orders list
  useEffect(() => {
    if (detailOrder) {
      const updated = orders.find(o => o.id === detailOrder.id);
      if (updated && (updated.status !== detailOrder.status || updated.payment_status !== detailOrder.payment_status)) {
        setDetailOrder(updated);
      }
    }
  }, [orders]);

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

  // Reset page on filter changes
  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterStatus, filterPayment, filterMethod]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ITEMS_PER_PAGE));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredOrders, currentPage]);

  // ── Stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
    const paidOrders = orders.filter(o => o.payment_status === 'paid');
    const todayPaid = todayOrders.filter(o => o.payment_status === 'paid');
    const pendingDelivery = orders.filter(o => o.payment_status === 'paid' && o.status !== 'completed' && o.status !== 'cancelled');

    // Sum paid upsell values
    let upsellRevenue = 0;
    let todayUpsellRevenue = 0;
    if (allAddons) {
      for (const a of allAddons) {
        if (a.status === 'paid') {
          const val = Number(a.amount) || 0;
          upsellRevenue += val;
          if (a.paid_at && new Date(a.paid_at) >= today) {
            todayUpsellRevenue += val;
          }
        }
      }
    }

    return {
      total: orders.length,
      todayCount: todayOrders.length,
      todayRevenue: todayPaid.reduce((sum, o) => sum + o.total_amount, 0) + todayUpsellRevenue,
      totalRevenue: paidOrders.reduce((sum, o) => sum + o.total_amount, 0) + upsellRevenue,
      upsellRevenue,
      pendingDelivery: pendingDelivery.length,
      paidCount: paidOrders.length,
      pixCount: orders.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === 'pix' && o.payment_status === 'paid').length,
      cardCount: orders.filter(o => (o.payment_method || (o.payment_status === 'paid' ? 'pix' : null)) === 'card' && o.payment_status === 'paid').length,
    };
  }, [orders, allAddons]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const handleCleanByType = async () => {
    setCleaningActive(true);
    try {
      // Safety: never delete orders created in the last 5 minutes (webhook may still confirm payment)
      const safetyThreshold = new Date(Date.now() - 5 * 60 * 1000).getTime();
      const isSafeToDelete = (o: Order) => new Date(o.created_at).getTime() < safetyThreshold;

      let toDelete: Order[] = [];
      if (cleanType === "unpaid") toDelete = orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled' && isSafeToDelete(o));
      else if (cleanType === "processing") toDelete = orders.filter(o => o.status === 'processing' && o.payment_status !== 'paid' && isSafeToDelete(o));
      else if (cleanType === "pending") toDelete = orders.filter(o => o.status === 'pending' && o.payment_status === 'pending' && isSafeToDelete(o));
      else if (cleanType === "cancelled") toDelete = orders.filter(o => o.status === 'cancelled' && o.payment_status !== 'paid');

      const skipped = orders.length - toDelete.length;
      if (skipped > 0 && cleanType !== "cancelled") {
        // Safety: recent orders (< 5min) preserved
      }

      const token = requireAdminToken();
      await Promise.all(toDelete.map(order =>
        invokeFunction("admin-data", {
          method: "DELETE",
          queryParams: { resource: "orders", id: order.id },
          headers: { "x-admin-token": token },
        })
      ));

      toast({ title: "Limpeza concluída", description: `${toDelete.length} pedido(s) removidos.` });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao limpar pedidos", description: error.message, variant: "destructive" });
    } finally {
      setCleaningActive(false);
      setCleanType(null);
    }
  };

  const handleDeleteSingleOrder = async () => {
    if (!deleteOrderId) return;
    setDeletingOrder(true);
    try {
      const token = requireAdminToken();
      await invokeFunction("admin-data", {
        method: "DELETE",
        queryParams: { resource: "orders", id: deleteOrderId },
        headers: { "x-admin-token": token },
      });
      toast({ title: "Pedido excluído" });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao excluir pedido", description: error.message, variant: "destructive" });
    } finally {
      setDeletingOrder(false);
      setDeleteOrderId(null);
    }
  };

  const handleVerifyPayment = async (order: Order) => {
    if (!order.flowpay_charge_id) {
      toast({ title: "Sem ID de cobrança", description: "Este pedido não tem um ID FlowPay.", variant: "destructive" });
      return;
    }
    setVerifyingPayment(order.id);
    try {
      const isCard = order.payment_method === 'card';

      const endpoint = isCard
        ? 'flowpay-card'
        : 'invictuspay-pix';
      const qp = isCard
        ? { action: 'status', id: order.flowpay_charge_id }
        : { action: 'status', chargeId: order.flowpay_charge_id, orderId: order.id };
      const response = await invokeFunction(endpoint, {
        method: 'GET',
        queryParams: qp,
      });

      const data = await response.json();
      if (data.success && data.status === 'COMPLETED') {
        const token = requireAdminToken();
        await invokeFunction("admin-data", {
          method: "PUT",
          queryParams: { resource: "verify-payment" },
          headers: { "x-admin-token": token },
          body: { id: order.id, payment_status: 'paid', status: 'processing' },
        });
        
        // Trigger delivery processing (same as force confirm)
        try {
          await invokeFunction("process-delivery", {
            method: "POST",
            body: { orderId: order.id },
            headers: { "x-admin-token": token },
          });
        } catch (e) {
          if (import.meta.env.DEV) console.warn('⚠️ process-delivery call failed (non-blocking):', e);
        }
        
        // 3. Send CAPI Purchase + analytics (fire-and-forget)
        sendAdminCapiPurchase(order);
        toast({ title: "✅ Pagamento confirmado", description: `Pedido #${order.id.slice(0, 6)} pago e entrega processada.` });
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

  // ── Send CAPI Purchase + UTMify + analytics after admin confirms payment ──
  const sendAdminCapiPurchase = async (order: Order) => {
    const eventId = generateEventId('Purchase', order.id);
    const nameParts = (order.customer_name || '').split(' ');

    // Fetch order items for enriched tracking (fire-and-forget, don't block UI)
    let productNames: string | undefined;
    let contentCategory: string | undefined;
    let contentIds: string[] | undefined;
    let contents: Array<{ id: string; quantity: number; item_price: number }> | undefined;
    try {
      const token = requireAdminToken();
      const itemsRes = await invokeFunction("admin-data", {
        method: "GET",
        queryParams: { resource: "order-items", orderId: order.id },
        headers: { "x-admin-token": token },
      });
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        const items: OrderItem[] = Array.isArray(itemsData.items) ? itemsData.items : [];
        if (items.length > 0) {
          productNames = items.map(i => i.product_name).join(', ');
          const categories = [...new Set(items.map(i => i.product_category).filter(Boolean))];
          contentCategory = categories.length > 0 ? categories.join(', ') : undefined;
          contentIds = items.map(i => i.product_id || i.id).filter(Boolean) as string[];
          contents = items.map(i => ({ id: i.product_id || i.id, quantity: i.quantity, item_price: i.unit_price }));
        }
      }
    } catch { /* non-blocking */ }

    // Fire-and-forget: CAPI Purchase with enriched product data
    invokeFunctionFireAndForget('meta-capi', {
      event_name: 'Purchase',
      event_id: eventId,
      order_id: order.id,
      value: order.total_amount,
      currency: 'BRL',
      content_name: productNames || `Pedido #${order.id.substring(0, 8)}`,
      content_category: contentCategory,
      content_ids: contentIds,
      contents,
      content_type: 'product',
      num_items: contents?.reduce((sum, c) => sum + c.quantity, 0),
      email: order.customer_email || undefined,
      phone: order.customer_phone || undefined,
      first_name: nameParts[0] || undefined,
      last_name: nameParts.slice(1).join(' ') || undefined,
      external_id: order.user_id || undefined,
      event_source_url: 'https://www.valnix.com.br/checkout',
    });
    // Fire-and-forget: UTMify Purchase
    invokeFunctionFireAndForget('utmify-event', {
      order_id: order.id,
      event_type: 'Purchase',
      value: order.total_amount,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone || undefined,
      product_name: productNames || `Pedido #${order.id.substring(0, 8)}`,
      product_id: contentIds?.[0] || order.id,
    });
    // Fire-and-forget: Analytics Purchase
    invokeFunctionFireAndForget('track-analytics', {
      event_name: 'Purchase',
      user_id: order.user_id || null,
      page_url: 'https://www.valnix.com.br/checkout',
      value: order.total_amount,
      currency: 'BRL',
      order_id: order.id,
      content_name: productNames || `Pedido #${order.id.substring(0, 8)}`,
      content_category: contentCategory || null,
    });
  };

  const handleForceConfirm = async (order: Order) => {
    setVerifyingPayment(order.id);
    try {
      const token = requireAdminToken();
      // 1. Mark as paid in Firestore
      await invokeFunction("admin-data", {
        method: "PUT",
        queryParams: { resource: "verify-payment" },
        headers: { "x-admin-token": token },
        body: { id: order.id, payment_status: 'paid', status: 'processing' },
      });
      // 2. Trigger delivery processing
      try {
        await invokeFunction("process-delivery", {
          method: "POST",
          body: { orderId: order.id },
          headers: { "x-admin-token": token },
        });
      } catch (e) {
        console.warn('⚠️ process-delivery call failed (non-blocking):', e);
      }
      // 3. Send CAPI Purchase + analytics (fire-and-forget)
      sendAdminCapiPurchase(order);
      toast({ title: "✅ Pagamento confirmado", description: `Pedido #${order.id.slice(0, 6)} marcado como pago e entrega processada.` });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao confirmar", description: error.message, variant: "destructive" });
    } finally {
      setVerifyingPayment(null);
    }
  };


  const handleViewDetail = async (order: Order) => {
    setDetailOrder(order);
    setLoadingDetail(true);
    setDetailAddons([]);
    try {
      const token = requireAdminToken();
      const itemsRes = await invokeFunction("admin-data", {
        method: "GET",
        queryParams: { resource: "order-items", orderId: order.id },
        headers: { "x-admin-token": token },
      });
      if (!itemsRes.ok) throw new Error(`HTTP ${itemsRes.status}`);
      const itemsData = await itemsRes.json();
      setDetailItems(Array.isArray(itemsData.items) ? itemsData.items : []);

      // Fetch upsell addons for this specific order
      try {
        const token2 = requireAdminToken();
        const res = await invokeFunction("admin-post-payment", {
          method: "GET",
          headers: { "x-admin-token": token2 },
          queryParams: { orderId: order.id },
        });
        if (res.ok) {
          const result = await res.json();
          setDetailAddons(Array.isArray(result.addons) ? result.addons : []);
        } else {
          setDetailAddons([]);
        }
      } catch {
        setDetailAddons([]);
      }
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
      const token = requireAdminToken();
      const targetOrder = detailOrder;
      // Run both writes in parallel
      const saveCode = invokeFunction("admin-data", {
        method: "PUT",
        queryParams: { resource: "order-items" },
        headers: { "x-admin-token": token },
        body: { id: itemId, orderId: targetOrder!.id, delivery_code: deliveryCode.trim() },
      });
      const updateStatus = targetOrder ? invokeFunction("admin-data", {
        method: "PUT",
        queryParams: { resource: "orders" },
        headers: { "x-admin-token": token },
        body: { id: targetOrder.id, status: "completed" },
      }) : Promise.resolve();
      await Promise.all([saveCode, updateStatus]);
      
      setDeliveryCode("");
      setSelectedItemId(null);
      // Refresh detail and orders in parallel
      if (targetOrder) handleViewDetail(targetOrder);
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao adicionar código", description: error.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleEditDeliveryCode = async (itemId: string) => {
    if (!editDeliveryCode.trim()) {
      toast({ title: "Código inválido", description: "Insira um código de entrega", variant: "destructive" });
      return;
    }
    setSendingEmail(true);
    try {
      const token = requireAdminToken();
      await invokeFunction("admin-data", {
        method: "PUT",
        queryParams: { resource: "order-items" },
        headers: { "x-admin-token": token },
        body: { id: itemId, orderId: detailOrder!.id, delivery_code: editDeliveryCode.trim() },
      });
      
      setEditingItemId(null);
      setEditDeliveryCode("");
      // Refresh in background without blocking UI
      if (detailOrder) handleViewDetail(detailOrder);
    } catch (error: any) {
      toast({ title: "Erro ao editar código", description: error.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const token = requireAdminToken();
      await invokeFunction("admin-data", {
        method: "PUT",
        queryParams: { resource: "orders" },
        headers: { "x-admin-token": token },
        body: { id: orderId, status: newStatus },
      });
      
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado` });
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
    <div className="space-y-4">
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-28 bg-muted animate-pulse rounded" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );

  if (ordersError) {
    return <AdminErrorState title="Erro ao carregar pedidos" message="Não foi possível carregar os pedidos. Verifique sua conexão e tente novamente." onRetry={() => refetchOrders()} retrying={ordersFetching} />;
  }

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
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(stats.totalRevenue)}
                {stats.upsellRevenue > 0 && (
                  <span className="ml-1 text-emerald-500">(⚡+{formatCurrency(stats.upsellRevenue)})</span>
                )}
              </p>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCleanupEmailDialogOpen(true); }} className="text-orange-500 focus:text-orange-500">
                  <Mail className="w-4 h-4 mr-2" /> Limpar por email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Cleanup by Email Dialog ──────────────────────────────── */}
        <AlertDialog open={cleanupEmailDialogOpen} onOpenChange={setCleanupEmailDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Limpar pedidos por email</AlertDialogTitle>
              <AlertDialogDescription>
                Todos os pedidos, itens e sale_addons deste email serão excluídos permanentemente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              placeholder="email@exemplo.com"
              value={cleanupEmail}
              onChange={(e) => setCleanupEmail(e.target.value)}
              className="my-2"
            />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setCleanupEmail("")}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!cleanupEmail.includes("@") || cleaningEmail}
                onClick={async (e) => {
                  e.preventDefault();
                  setCleaningEmail(true);
                  try {
                    const token = requireAdminToken();
                    const res = await invokeFunction("admin-data", {
                      method: "POST",
                      queryParams: { resource: "cleanup-orders" },
                      headers: { "x-admin-token": token },
                      body: { email: cleanupEmail },
                    });
                    const data = await res.json();
                    if (data.success) {
                      setCleanupEmail("");
                      setCleanupEmailDialogOpen(false);
                      await fetchOrders();
                    } else {
                      toast({ title: "Erro", description: data.error || "Falha na limpeza", variant: "destructive" });
                    }
                  } catch (err: any) {
                    toast({ title: "Erro", description: err.message, variant: "destructive" });
                  } finally {
                    setCleaningEmail(false);
                  }
                }}
              >
                {cleaningEmail && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Excluir tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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

        {/* ── Delete Single Order Confirmation ──────────────────────── */}
        <AlertDialog open={!!deleteOrderId} onOpenChange={() => setDeleteOrderId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir pedido</AlertDialogTitle>
              <AlertDialogDescription>
                Excluir permanentemente o pedido <strong>#{deleteOrderId?.slice(0, 6)}</strong>? Essa ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteSingleOrder} disabled={deletingOrder}>
                {deletingOrder && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
                  {paginatedOrders.map((order) => {
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
                          <div>
                            <span className="font-semibold text-sm">{formatCurrency(order.total_amount)}</span>
                            {(() => {
                              const addonInfo = orderAddonsMap.get(order.id);
                              if (!addonInfo || addonInfo.count === 0) return null;
                              if (addonInfo.paidCount > 0) {
                                return (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 cursor-help">
                                        <Zap className="w-2.5 h-2.5" />
                                        +{formatCurrency(addonInfo.totalValue)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p className="text-xs">{addonInfo.paidCount} upsell(s) pago(s)</p>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground cursor-help">
                                      <Zap className="w-2.5 h-2.5" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p className="text-xs">{addonInfo.count} upsell(s) — não pago(s)</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })()}
                          </div>
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
                              {order.payment_status !== 'paid' && (
                                <DropdownMenuItem onClick={() => handleForceConfirm(order)} disabled={verifyingPayment === order.id}>
                                  {verifyingPayment === order.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                                  Forçar confirmação
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
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteOrderId(order.id)} className="text-red-500 focus:text-red-500">
                                <Trash2 className="w-4 h-4 mr-2" /> Excluir pedido
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-border/30">
                <p className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages} ({filteredOrders.length} pedidos)
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) page = i + 1;
                    else if (currentPage <= 3) page = i + 1;
                    else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                    else page = currentPage - 2 + i;
                    return (
                      <Button key={page} variant={currentPage === page ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setCurrentPage(page)}>
                        {page}
                      </Button>
                    );
                  })}
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── Order Detail Dialog ──────────────────────────────────── */}
        <Dialog open={!!detailOrder} onOpenChange={(open) => { if (!open) { setDetailOrder(null); setDetailItems([]); setSelectedItemId(null); setDeliveryCode(""); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
            {detailOrder && (() => {
              const statusCfg = getStatusConfig(detailOrder.status);
              const paymentCfg = getPaymentStatusConfig(detailOrder.payment_status);

              return (
                <div className="flex flex-col">
                  {/* Header */}
                  <div className="sticky top-0 z-10 bg-background border-b border-border/50 px-6 pt-6 pb-4">
                    <DialogHeader className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <DialogTitle className="text-xl font-bold tracking-tight">
                          Pedido <span className="text-primary">#{detailOrder.id.slice(0, 8)}</span>
                        </DialogTitle>
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusCfg.icon}
                          {statusCfg.label}
                        </div>
                      </div>
                      <DialogDescription className="flex items-center gap-1.5 text-xs">
                        <Calendar className="w-3.5 h-3.5" />
                        Criado em {new Date(detailOrder.created_at).toLocaleString('pt-BR')}
                      </DialogDescription>
                    </DialogHeader>
                  </div>

                  <div className="px-6 py-5 space-y-5">
                    {/* Customer & Payment Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Customer */}
                      <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Cliente</h4>
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <User className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <span className="text-sm font-semibold select-text">{detailOrder.customer_name}</span>
                          </div>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                              <Mail className="w-3.5 h-3.5 text-blue-500" />
                            </div>
                            <span className="text-sm select-all cursor-text break-all min-w-0">{detailOrder.customer_email}</span>
                            <button onClick={() => copyToClipboard(detailOrder.customer_email, "E-mail")} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {detailOrder.customer_phone && (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                                <Phone className="w-3.5 h-3.5 text-green-500" />
                              </div>
                              <span className="text-sm select-all cursor-text">{detailOrder.customer_phone}</span>
                              <button onClick={() => copyToClipboard(detailOrder.customer_phone!, "Telefone")} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Payment */}
                      <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Pagamento</h4>
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <DollarSign className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <span className="text-lg font-bold text-primary">{formatCurrency(detailOrder.total_amount)}</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              (detailOrder.payment_method || (detailOrder.payment_status === 'paid' ? 'pix' : null)) === 'pix' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'
                            }`}>
                              {getPaymentMethodIcon(detailOrder.payment_method, detailOrder.payment_status)}
                            </div>
                            <span className="text-sm font-semibold">{getPaymentMethodLabel(detailOrder.payment_method, detailOrder.payment_status)}</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${paymentCfg.bg} ${paymentCfg.color}`}>
                              {paymentCfg.icon}
                              {paymentCfg.label}
                            </div>
                          </div>
                          {detailOrder.flowpay_charge_id && (
                            <div className="flex items-start gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <code className="text-[11px] font-mono text-muted-foreground select-all break-all min-w-0 leading-relaxed">{detailOrder.flowpay_charge_id}</code>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status Change */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/30">
                      <Label className="text-sm font-semibold whitespace-nowrap">Status:</Label>
                      <Select value={detailOrder.status} onValueChange={(value) => { updateOrderStatus(detailOrder.id, value); setDetailOrder({ ...detailOrder, status: value }); }}>
                        <SelectTrigger className="flex-1 bg-background">
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
                      {detailOrder.payment_status !== 'paid' && (
                        <Button variant="default" size="sm" disabled={verifyingPayment === detailOrder.id} onClick={() => handleForceConfirm(detailOrder)}>
                          {verifyingPayment === detailOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
                          Forçar confirmação
                        </Button>
                      )}
                      {detailOrder.payment_status === 'paid' && detailOrder.status !== 'completed' && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          disabled={
                            detailOrder.status === 'cancelled' ||
                            (detailItems.length > 0 && detailItems.every((it: any) => !!it.delivery_code)) ||
                            reprocessingDelivery
                          }
                          onClick={async () => {
                            setReprocessingDelivery(true);
                            try {
                              const token = requireAdminToken();
                              if (!token) {
                                toast({ title: "Sem autenticação", description: "Faça login como admin novamente.", variant: "destructive" });
                                return;
                              }
                              const res = await invokeFunction("process-delivery", {
                                method: "POST",
                                headers: { "x-admin-token": token },
                                body: { orderId: detailOrder.id },
                              });
                              const data = await res.json();
                              if (!res.ok || data?.success === false) {
                                toast({ title: "Erro ao reprocessar", description: data?.error || `HTTP ${res.status}`, variant: "destructive" });
                                return;
                              }
                              const delivered = Number(data?.deliveredCount || 0);
                              const failed = Number(data?.failedCount || 0);
                              const skipped = Number(data?.skippedCount || 0);
                              if (failed > 0) {
                                toast({ title: "Entrega parcial", description: `${delivered} entregue(s), ${failed} falha(s). Verifique logs/estoque.`, variant: "destructive" });
                              } else if (delivered > 0) {
                                toast({ title: "Entrega reprocessada!", description: `${delivered} código(s) entregue(s).` });
                              } else if (skipped > 0) {
                                toast({ title: "Já entregue", description: "Os itens já possuíam código de entrega." });
                              } else {
                                toast({ title: "Sem códigos disponíveis", description: "Verifique o estoque (auto_real) ou tipo de entrega do produto.", variant: "destructive" });
                              }
                              await handleViewDetail(detailOrder);
                              await fetchOrders();
                            } catch (err: any) {
                              toast({ title: "Erro ao reprocessar", description: err?.message || "Falha inesperada", variant: "destructive" });
                            } finally {
                              setReprocessingDelivery(false);
                            }
                          }}
                        >
                          {reprocessingDelivery ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                          {detailItems.length > 0 && detailItems.every((it: any) => !!it.delivery_code) ? "Já entregue" : "Reprocessar"}
                        </Button>
                      )}
                    </div>

                    {/* Order Items */}
                    <div className="space-y-3">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
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
                            <div key={item.id} className="flex gap-3 p-3.5 rounded-xl border border-border/50 bg-card/50">
                              {item.product_image && (
                                <img src={item.product_image} alt={item.product_name} className="w-16 h-16 object-contain bg-muted/50 rounded-lg flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0 space-y-2.5">
                                <div>
                                  <h5 className="font-bold text-sm">{item.product_name}</h5>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {item.quantity}× {formatCurrency(item.unit_price)} = <span className="font-bold text-foreground">{formatCurrency(item.total_price)}</span>
                                  </p>
                                </div>

                                {item.delivery_code && editingItemId !== item.id ? (
                                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-xs font-semibold text-green-500 flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Código entregue
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <button 
                                          onClick={() => { setEditingItemId(item.id); setEditDeliveryCode(item.delivery_code!); }}
                                          className="text-muted-foreground hover:text-primary transition-colors" 
                                          title="Editar código"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => copyToClipboard(item.delivery_code!, "Código")} className="text-green-500/70 hover:text-green-500 transition-colors">
                                          <Copy className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                    <code className="text-xs font-mono text-green-400 break-all select-all leading-relaxed block">{item.delivery_code}</code>
                                  </div>
                                ) : editingItemId === item.id ? (
                                  <div className="space-y-2">
                                    <div className="text-xs font-semibold text-primary flex items-center gap-1 mb-1">
                                      <Pencil className="w-3 h-3" /> Editando código
                                    </div>
                                    <Textarea
                                      placeholder="Novo código de entrega..."
                                      value={editDeliveryCode}
                                      onChange={(e) => setEditDeliveryCode(e.target.value)}
                                      rows={3}
                                      className="font-mono text-sm"
                                      autoFocus
                                    />
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={() => handleEditDeliveryCode(item.id)} disabled={sendingEmail} className="flex-1">
                                        {sendingEmail ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                                        Salvar alteração
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => { setEditingItemId(null); setEditDeliveryCode(""); }}>
                                        Cancelar
                                      </Button>
                                    </div>
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
                                  <Button size="sm" variant="outline" onClick={() => setSelectedItemId(item.id)} className="w-full h-9 text-xs">
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
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
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
                              <div key={addon.id} className={`flex items-center justify-between p-3.5 rounded-xl border ${
                                isPaid ? "border-green-500/20 bg-green-500/5" : isSkipped ? "border-border/30 bg-muted/20" : "border-yellow-500/20 bg-yellow-500/5"
                              }`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{addonLabels[addon.addon_type] || addon.addon_type}</span>
                                  <Badge variant={isPaid ? "default" : isSkipped ? "secondary" : "outline"} className={`text-[10px] ${isPaid ? "bg-green-600" : ""}`}>
                                    {isPaid ? "Pago" : isSkipped ? "Recusado" : "Pendente"}
                                  </Badge>
                                </div>
                                <span className={`text-sm font-bold ${isPaid ? "text-green-500" : "text-muted-foreground"}`}>
                                  {addon.amount > 0 ? formatCurrency(addon.amount) : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="sticky bottom-0 bg-background border-t border-border/50 px-6 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                        <Hash className="w-3 h-3 flex-shrink-0" />
                        <code className="font-mono select-all break-all">{detailOrder.id}</code>
                        <button onClick={() => copyToClipboard(detailOrder.id, "ID completo")} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      {detailOrder.user_id && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0 cursor-default">
                              <User className="w-3 h-3" />
                              <span className="font-mono">UID: {detailOrder.user_id.slice(0, 10)}…</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <code className="text-xs font-mono break-all">{detailOrder.user_id}</code>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};
