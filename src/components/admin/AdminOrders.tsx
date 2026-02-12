import { useState, useEffect } from "react";
import { db } from "@/integrations/firebase/config";
import { collection, getDocs, onSnapshot, doc, updateDoc, deleteDoc, Timestamp, query, where, getDoc } from "firebase/firestore";
import { useAutoVerifyPixPayments } from "@/hooks/firebase/useAutoVerifyPixPayments";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Package, Send, Loader2, RefreshCw, Trash2, Search, ChevronDown } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

export const AdminOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [deliveryCode, setDeliveryCode] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleaningProcessing, setCleaningProcessing] = useState(false);
  const [cleaningPending, setCleaningPending] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [cleanType, setCleanType] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Auto-verify pending PIX payments
  useAutoVerifyPixPayments(orders as any, () => fetchOrders());

  useEffect(() => {
    fetchOrders();
    
    // Real-time listener for Firestore orders
    const ordersRef = collection(db, "orders");
    const unsubscribe = onSnapshot(ordersRef, () => {
      fetchOrders();
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    applyFilter();
  }, [orders, filterType, searchTerm]);

  const fetchOrders = async () => {
    try {
      const ordersRef = collection(db, "orders");
      const snapshot = await getDocs(ordersRef);
      
      const ordersData = snapshot.docs.map(docSnapshot => {
        const data = docSnapshot.data();
        // Handle both Firestore Timestamp and string formats
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
        } as Order;
      });
      
      // Sort by created_at descending
      ordersData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setOrders(ordersData);
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      toast({
        title: "Erro ao carregar pedidos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
    toast({
      title: "Lista atualizada",
      description: "Os pedidos foram atualizados com sucesso.",
    });
  };

  const handleCleanUnpaid = async () => {
    setCleaning(true);
    try {
      const unpaidOrders = orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled');
      let deleted = 0;

      for (const order of unpaidOrders) {
        // Delete order items first
        const itemsRef = collection(db, "order_items");
        const itemsSnapshot = await getDocs(itemsRef);
        const orderItems = itemsSnapshot.docs.filter(d => d.data().order_id === order.id);
        for (const item of orderItems) {
          await deleteDoc(doc(db, "order_items", item.id));
        }
        // Delete order
        await deleteDoc(doc(db, "orders", order.id));
        deleted++;
      }

      toast({
        title: "Limpeza concluída!",
        description: `${deleted} pedido(s) não pago(s) removido(s).`,
      });
      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Erro ao limpar pedidos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCleaning(false);
    }
  };

  const handleCleanProcessing = async () => {
    setCleaningProcessing(true);
    try {
      const processingOrders = orders.filter(o => o.status === 'processing');
      let deleted = 0;

      for (const order of processingOrders) {
        const itemsRef = collection(db, "order_items");
        const itemsSnapshot = await getDocs(itemsRef);
        const items = itemsSnapshot.docs.filter(d => d.data().order_id === order.id);
        for (const item of items) {
          await deleteDoc(doc(db, "order_items", item.id));
        }
        await deleteDoc(doc(db, "orders", order.id));
        deleted++;
      }

      toast({
        title: "Limpeza concluída!",
        description: `${deleted} pedido(s) processando removido(s).`,
      });
      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Erro ao limpar pedidos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCleaningProcessing(false);
    }
  };

  const handleCleanPending = async () => {
    setCleaningPending(true);
    try {
      const pendingOrders = orders.filter(o => o.status === 'pending' && o.payment_status === 'pending');
      let deleted = 0;

      for (const order of pendingOrders) {
        const itemsRef = collection(db, "order_items");
        const itemsSnapshot = await getDocs(itemsRef);
        const items = itemsSnapshot.docs.filter(d => d.data().order_id === order.id);
        for (const item of items) {
          await deleteDoc(doc(db, "order_items", item.id));
        }
        await deleteDoc(doc(db, "orders", order.id));
        deleted++;
      }

      toast({
        title: "Limpeza concluída!",
        description: `${deleted} pedido(s) pendente(s) removido(s).`,
      });
      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Erro ao limpar pedidos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCleaningPending(false);
    }
  };

  const handleCleanCancelled = async () => {
    setCleaning(true);
    try {
      const cancelledOrders = orders.filter(o => o.status === 'cancelled');
      let deleted = 0;
      for (const order of cancelledOrders) {
        const itemsRef = collection(db, "order_items");
        const itemsSnapshot = await getDocs(itemsRef);
        const items = itemsSnapshot.docs.filter(d => d.data().order_id === order.id);
        for (const item of items) {
          await deleteDoc(doc(db, "order_items", item.id));
        }
        await deleteDoc(doc(db, "orders", order.id));
        deleted++;
      }
      toast({
        title: "Limpeza concluída!",
        description: `${deleted} pedido(s) cancelado(s) removido(s).`,
      });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Erro ao limpar pedidos", description: error.message, variant: "destructive" });
    } finally {
      setCleaning(false);
    }
  };

  const handleCleanByType = async () => {
    if (cleanType === "unpaid") await handleCleanUnpaid();
    else if (cleanType === "processing") await handleCleanProcessing();
    else if (cleanType === "pending") await handleCleanPending();
    else if (cleanType === "cancelled") await handleCleanCancelled();
    setCleanType(null);
  };

  const handleVerifyPayment = async (order: Order) => {
    if (!order.flowpay_charge_id) {
      toast({
        title: "Sem ID de cobrança",
        description: "Este pedido não tem um ID de cobrança FlowPay associado.",
        variant: "destructive",
      });
      return;
    }

    setVerifyingPayment(order.id);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${order.flowpay_charge_id}`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const data = await response.json();

      if (data.success && data.status === 'COMPLETED') {
        // Payment confirmed! Update order in Firestore
        const orderRef = doc(db, "orders", order.id);
        await updateDoc(orderRef, {
          payment_status: 'paid',
          status: 'processing',
          updated_at: Timestamp.now(),
        });

        toast({
          title: "Pagamento confirmado! ✅",
          description: `O pedido #${order.id.substring(0, 8)} foi pago. Status atualizado.`,
        });
        fetchOrders();
      } else {
        toast({
          title: "Pagamento não confirmado",
          description: `Status atual: ${data.status || 'desconhecido'}. O pagamento ainda não foi detectado.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Erro ao verificar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setVerifyingPayment(null);
    }
  };

  const applyFilter = async () => {
    let result = orders;

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(o => 
        o.customer_name.toLowerCase().includes(term) ||
        o.customer_email.toLowerCase().includes(term) ||
        o.customer_phone?.includes(term) ||
        o.id.toLowerCase().includes(term)
      );
    }

    if (filterType === "all") {
      setFilteredOrders(result);
      return;
    }

    if (filterType === "pending_delivery") {
      const pendingOrders = [];
      
      for (const order of result) {
        if (order.payment_status === 'paid' && order.status !== 'completed' && order.status !== 'cancelled') {
          try {
            const itemsRef = collection(db, "order_items");
            const itemsSnapshot = await getDocs(itemsRef);
            const orderItemsData = itemsSnapshot.docs
              .filter(doc => doc.data().order_id === order.id)
              .map(doc => doc.data());
            
            if (orderItemsData.some(item => !item.delivery_code)) {
              pendingOrders.push(order);
            }
          } catch (err) {
            pendingOrders.push(order);
          }
        }
      }
      
      setFilteredOrders(pendingOrders);
    }
  };

  const loadOrderItems = async (orderId: string) => {
    setLoadingItems(true);
    try {
      const itemsRef = collection(db, "order_items");
      const snapshot = await getDocs(itemsRef);
      
      const itemsData = snapshot.docs
        .filter(docSnapshot => docSnapshot.data().order_id === orderId)
        .map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        } as OrderItem));
      
      setOrderItems(itemsData);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar itens",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingItems(false);
    }
  };

  const handleViewItems = (order: Order) => {
    setSelectedOrder(order);
    loadOrderItems(order.id);
  };

  const handleAddDeliveryCode = async (itemId: string) => {
    if (!deliveryCode.trim()) {
      toast({
        title: "Código inválido",
        description: "Por favor, insira um código de entrega",
        variant: "destructive",
      });
      return;
    }

    setSendingEmail(true);
    try {
      // Update delivery code in Firestore only - no email sending
      const itemRef = doc(db, "order_items", itemId);
      await updateDoc(itemRef, { delivery_code: deliveryCode.trim() });

      if (!selectedOrder) throw new Error("Pedido não encontrado");

      // Update order status to completed in Firestore
      const orderRef = doc(db, "orders", selectedOrder.id);
      await updateDoc(orderRef, { status: "completed", updated_at: Timestamp.now() });

      toast({
        title: "Código salvo com sucesso!",
        description: "O cliente pode ver o código na página 'Meus Pedidos'.",
      });

      setDeliveryCode("");
      setSelectedItemId(null);
      loadOrderItems(selectedOrder.id);
      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Erro ao adicionar código",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const orderRef = doc(db, "orders", orderId);
      await updateDoc(orderRef, { status: newStatus, updated_at: Timestamp.now() });

      toast({
        title: "Status atualizado!",
        description: "O status do pedido foi atualizado com sucesso.",
      });

      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-500",
      processing: "bg-blue-500",
      completed: "bg-green-500",
      cancelled: "bg-red-500",
    };

    return (
      <Badge className={colors[status] || "bg-gray-500"}>
        {status === "pending" && "Pendente"}
        {status === "processing" && "Processando"}
        {status === "completed" && "Concluído"}
        {status === "cancelled" && "Cancelado"}
      </Badge>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {filteredOrders.length} {filteredOrders.length === 1 ? "pedido encontrado" : "pedidos encontrados"}
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="destructive" 
                size="sm"
                disabled={cleaning || cleaningProcessing || cleaningPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Limpar pedidos
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Remover pedidos por status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={cleaning || orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled').length === 0}
                onSelect={(e) => { e.preventDefault(); setCleanType("unpaid"); }}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Não pagos ({orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled').length})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={cleaningProcessing || orders.filter(o => o.status === 'processing').length === 0}
                onSelect={(e) => { e.preventDefault(); setCleanType("processing"); }}
                className="text-blue-400 focus:text-blue-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Processando ({orders.filter(o => o.status === 'processing').length})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={cleaningPending || orders.filter(o => o.status === 'pending' && o.payment_status === 'pending').length === 0}
                onSelect={(e) => { e.preventDefault(); setCleanType("pending"); }}
                className="text-yellow-500 focus:text-yellow-500"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Pendentes ({orders.filter(o => o.status === 'pending' && o.payment_status === 'pending').length})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={orders.filter(o => o.status === 'cancelled').length === 0}
                onSelect={(e) => { e.preventDefault(); setCleanType("cancelled"); }}
                className="text-muted-foreground"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Cancelados ({orders.filter(o => o.status === 'cancelled').length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Label className="text-sm whitespace-nowrap">Filtrar:</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Pedidos</SelectItem>
              <SelectItem value="pending_delivery">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-orange-500" />
                  Entrega Pendente
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Clean Confirmation Dialog */}
      <AlertDialog open={!!cleanType} onOpenChange={() => setCleanType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cleanType === "unpaid" && "Limpar pedidos não pagos?"}
              {cleanType === "processing" && "Limpar pedidos processando?"}
              {cleanType === "pending" && "Limpar pedidos pendentes?"}
              {cleanType === "cancelled" && "Limpar pedidos cancelados?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cleanType === "unpaid" && `Isso vai excluir permanentemente ${orders.filter(o => o.payment_status !== 'paid' && o.status !== 'cancelled').length} pedido(s) que não foram pagos.`}
              {cleanType === "processing" && `Isso vai excluir permanentemente ${orders.filter(o => o.status === 'processing').length} pedido(s) com status "Processando".`}
              {cleanType === "pending" && `Isso vai excluir permanentemente ${orders.filter(o => o.status === 'pending' && o.payment_status === 'pending').length} pedido(s) pendentes.`}
              {cleanType === "cancelled" && `Isso vai excluir permanentemente ${orders.filter(o => o.status === 'cancelled').length} pedido(s) cancelados.`}
              {" "}Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCleanByType} disabled={cleaning || cleaningProcessing || cleaningPending}>
              {(cleaning || cleaningProcessing || cleaningPending) ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirmar exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {filterType === "pending_delivery" 
                ? "Nenhum pedido com entrega pendente" 
                : "Nenhum pedido encontrado"
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredOrders.map((order) => (
            <Card key={order.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-semibold select-text">{order.customer_name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5 select-all cursor-text">{order.customer_email}</p>
                    {order.customer_phone && (
                      <p className="text-sm text-muted-foreground mt-0.5 select-all cursor-text">{order.customer_phone}</p>
                    )}
                  </div>
                  {getStatusBadge(order.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="font-semibold text-primary">R$ {order.total_amount.toFixed(2)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Pagamento</p>
                    <Badge variant={order.payment_status === 'paid' ? 'default' : 'secondary'}>
                      {order.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Data</p>
                    <p className="font-medium">
                      {new Date(order.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  {order.payment_method && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Método</p>
                      <p className="font-medium capitalize">{order.payment_method}</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-2 block">Status do Pedido</Label>
                    <Select
                      value={order.status}
                      onValueChange={(value) => updateOrderStatus(order.id, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="processing">Processando</SelectItem>
                        <SelectItem value="completed">Concluído</SelectItem>
                        <SelectItem value="cancelled">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {order.payment_status !== 'paid' && order.flowpay_charge_id && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-end"
                      disabled={verifyingPayment === order.id}
                      onClick={() => handleVerifyPayment(order)}
                    >
                      {verifyingPayment === order.id ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4 mr-2" />
                      )}
                      Verificar Pagamento
                    </Button>
                  )}

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline" 
                        className="self-end"
                        onClick={() => handleViewItems(order)}
                      >
                        <Package className="w-4 h-4 mr-2" />
                        Ver Itens
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Itens do Pedido #{order.id.slice(0, 8)}</DialogTitle>
                        <DialogDescription>
                          Adicione códigos de entrega para os produtos
                        </DialogDescription>
                      </DialogHeader>

                      {loadingItems ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {orderItems.map((item) => (
                            <Card key={item.id}>
                              <CardContent className="pt-6">
                                <div className="flex gap-4">
                                  {item.product_image && (
                                    <img
                                      src={item.product_image}
                                      alt={item.product_name}
                                      className="w-20 h-20 object-contain bg-secondary rounded"
                                    />
                                  )}
                                  <div className="flex-1 space-y-3">
                                    <div>
                                      <h4 className="font-semibold">{item.product_name}</h4>
                                      <p className="text-sm text-muted-foreground">
                                        {item.quantity}x R$ {item.unit_price.toFixed(2)} = R$ {item.total_price.toFixed(2)}
                                      </p>
                                    </div>

                                    {item.delivery_code ? (
                                      <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg p-3">
                                        <p className="text-sm font-medium text-green-900 dark:text-green-100 mb-2">
                                          ✓ Código já entregue
                                        </p>
                                        <code className="text-sm font-mono text-green-700 dark:text-green-300 break-all">
                                          {item.delivery_code}
                                        </code>
                                      </div>
                                    ) : selectedItemId === item.id ? (
                                      <div className="space-y-2">
                                        <Textarea
                                          placeholder="Cole os códigos aqui (um por linha ou separados por vírgula)"
                                          value={deliveryCode}
                                          onChange={(e) => setDeliveryCode(e.target.value)}
                                          rows={4}
                                          className="font-mono text-sm"
                                        />
                                        <div className="flex gap-2">
                                          <Button
                                            onClick={() => handleAddDeliveryCode(item.id)}
                                            disabled={sendingEmail}
                                            className="flex-1"
                                          >
                                            {sendingEmail ? (
                                              <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Enviando...
                                              </>
                                            ) : (
                                              <>
                                                <Send className="w-4 h-4 mr-2" />
                                                Salvar e Enviar Email
                                              </>
                                            )}
                                          </Button>
                                          <Button
                                            variant="outline"
                                            onClick={() => {
                                              setSelectedItemId(null);
                                              setDeliveryCode("");
                                            }}
                                          >
                                            Cancelar
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        onClick={() => setSelectedItemId(item.id)}
                                        className="w-full"
                                      >
                                        <Package className="w-4 h-4 mr-2" />
                                        Adicionar Código de Entrega
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
