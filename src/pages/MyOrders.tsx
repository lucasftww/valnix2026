import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useUserOrders, useOrderItems, Order } from "@/hooks/firebase";
import { useAutoVerifyPixPayments } from "@/hooks/firebase/useAutoVerifyPixPayments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Calendar, DollarSign, Eye, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

export default function MyOrders() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { orders, loading } = useUserOrders(user?.uid);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { items: orderItems, loading: loadingItems } = useOrderItems(selectedOrder?.id);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Auto-verify pending PIX payments when orders load
  useAutoVerifyPixPayments(orders);

  if (!authLoading && !user) {
    navigate("/auth");
    return null;
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
      case "entregue":
        return "bg-green-500";
      case "processing":
      case "processando":
        return "bg-yellow-500";
      case "shipped":
      case "enviado":
        return "bg-blue-500";
      case "cancelled":
      case "cancelado":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "paid":
      case "pago":
        return "bg-green-500";
      case "pending":
      case "pendente":
        return "bg-yellow-500";
      case "failed":
      case "falhou":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const translateStatus = (status: string) => {
    const translations: Record<string, string> = {
      'pending': 'Pendente',
      'processing': 'Processando',
      'completed': 'Concluído',
      'shipped': 'Enviado',
      'delivered': 'Entregue',
      'cancelled': 'Cancelado',
      'refunded': 'Reembolsado',
    };
    return translations[status?.toLowerCase()] || status || 'Pendente';
  };

  const translatePaymentStatus = (status: string) => {
    const translations: Record<string, string> = {
      'pending': 'Pendente',
      'paid': 'Pago',
      'failed': 'Falhou',
      'refunded': 'Reembolsado',
      'cancelled': 'Cancelado',
    };
    return translations[status?.toLowerCase()] || status || 'Pendente';
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <main className="flex-1 container px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <Button
              variant="outline"
              onClick={() => setSelectedOrder(null)}
              className="mb-6"
            >
              ← Voltar para Meus Pedidos
            </Button>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Pedido #{selectedOrder.id.slice(0, 8)}</span>
                  <div className="flex gap-2">
                    {selectedOrder.payment_status === 'paid' ? (
                      <Badge className="bg-green-500">Pago</Badge>
                    ) : (
                      <>
                        <Badge className={getStatusColor(selectedOrder.status)}>
                          {translateStatus(selectedOrder.status)}
                        </Badge>
                        <Badge className={getPaymentStatusColor(selectedOrder.payment_status)}>
                          {translatePaymentStatus(selectedOrder.payment_status)}
                        </Badge>
                      </>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-bold mb-2">Informações do Pedido</h3>
                    <div className="space-y-2 text-sm">
                      <p><span className="text-muted-foreground">Data:</span> {new Date(selectedOrder.created_at).toLocaleDateString("pt-BR")}</p>
                      <p><span className="text-muted-foreground">Total:</span> <span className="text-primary font-bold">R$ {selectedOrder.total_amount.toFixed(2)}</span></p>
                      <p><span className="text-muted-foreground">Método de Pagamento:</span> {selectedOrder.payment_method || "Não informado"}</p>
                      {selectedOrder.tracking_code && (
                        <p><span className="text-muted-foreground">Código de Rastreio:</span> <span className="font-mono">{selectedOrder.tracking_code}</span></p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold mb-2">Informações de Entrega</h3>
                    <div className="space-y-2 text-sm">
                      <p><span className="text-muted-foreground">Nome:</span> {selectedOrder.customer_name}</p>
                      <p><span className="text-muted-foreground">Email:</span> {selectedOrder.customer_email}</p>
                      {selectedOrder.customer_phone && (
                        <p><span className="text-muted-foreground">Telefone:</span> {selectedOrder.customer_phone}</p>
                      )}
                      {selectedOrder.shipping_address && (
                        <p><span className="text-muted-foreground">Endereço:</span> {selectedOrder.shipping_address}</p>
                      )}
                      {selectedOrder.shipping_method && (
                        <p><span className="text-muted-foreground">Método de Envio:</span> {selectedOrder.shipping_method}</p>
                      )}
                    </div>
                  </div>
                </div>

                {selectedOrder.notes && (
                  <div>
                    <h3 className="font-bold mb-2">Observações</h3>
                    <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                  </div>
                )}

                <div>
                  <h3 className="font-bold mb-4">Itens do Pedido</h3>
                  {loadingItems ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orderItems.map((item) => (
                        <div key={item.id} className="flex flex-col gap-3 p-4 bg-secondary/20 rounded-lg">
                          <div className="flex items-center gap-4">
                            {item.product_image && (
                              <img
                                src={item.product_image}
                                alt={item.product_name}
                                className="w-16 h-16 object-contain bg-background rounded"
                              />
                            )}
                            <div className="flex-1">
                              <h4 className="font-semibold">{item.product_name}</h4>
                              <p className="text-sm text-muted-foreground">
                                Quantidade: {item.quantity} x R$ {item.unit_price.toFixed(2)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-primary">R$ {item.total_price.toFixed(2)}</p>
                            </div>
                          </div>
                          
                          {/* Códigos de Entrega ou Status Pendente */}
                          {item.delivery_code ? (
                            <div className="border-t border-border pt-3">
                              <div className="bg-accent/30 p-3 rounded-lg space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-muted-foreground font-medium">
                                    🎮 Códigos de Entrega ({item.delivery_code.split(',').length} códigos)
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      navigator.clipboard.writeText(item.delivery_code!);
                                      toast({
                                        title: "Sucesso",
                                        description: "Todos os códigos copiados!"
                                      });
                                    }}
                                  >
                                    <Copy className="w-4 h-4 mr-1" />
                                    Copiar Todos
                                  </Button>
                                </div>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {item.delivery_code.split(',').map((code, index) => (
                                    <div 
                                      key={index}
                                      className="flex items-center justify-between gap-2 bg-background/50 p-2 rounded border border-border/50"
                                    >
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <span className="text-xs text-muted-foreground font-medium shrink-0">
                                          #{index + 1}
                                        </span>
                                        <code className="text-sm font-mono text-primary font-bold break-all select-all">
                                          {code.trim()}
                                        </code>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="shrink-0"
                                        onClick={() => {
                                          navigator.clipboard.writeText(code.trim());
                                          setCopiedCode(code.trim());
                                          toast({
                                            title: "Sucesso",
                                            description: `Código #${index + 1} copiado!`
                                          });
                                          setTimeout(() => setCopiedCode(null), 2000);
                                        }}
                                      >
                                        {copiedCode === code.trim() ? (
                                          <Check className="w-4 h-4 text-green-500" />
                                        ) : (
                                          <Copy className="w-4 h-4" />
                                        )}
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : selectedOrder.payment_status === 'paid' ? (
                            <div className="border-t border-border pt-3">
                              <div className="bg-orange-500/10 border border-orange-500/30 p-4 rounded-lg">
                                <div className="flex items-center gap-3">
                                  <div className="bg-orange-500/20 p-2 rounded-full">
                                    <Package className="w-5 h-5 text-orange-500" />
                                  </div>
                                  <div className="flex-1">
                                    <p className="font-semibold text-orange-500">Entrega Pendente</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Este produto será entregue manualmente em breve. Os códigos aparecerão aqui quando estiverem disponíveis.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 container px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2">Meus Pedidos</h1>
              <p className="text-muted-foreground">Acompanhe o histórico e status dos seus pedidos</p>
            </div>
            <Link to="/">
              <Button variant="outline">Voltar à Loja</Button>
            </Link>
          </div>

          {orders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Package className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-bold mb-2">Nenhum pedido encontrado</h2>
                <p className="text-muted-foreground mb-6">Você ainda não realizou nenhum pedido</p>
                <Link to="/">
                  <Button className="bg-primary hover:bg-primary/90">
                    Começar a Comprar
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {orders.map((order) => (
                <Card key={order.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-bold text-lg">Pedido #{order.id.slice(0, 8)}</h3>
                          {order.payment_status === 'paid' ? (
                            <Badge className="bg-green-500">Pago</Badge>
                          ) : (
                            <>
                              <Badge className={getStatusColor(order.status)}>
                                {translateStatus(order.status)}
                              </Badge>
                              <Badge className={getPaymentStatusColor(order.payment_status)}>
                                {translatePaymentStatus(order.payment_status)}
                              </Badge>
                            </>
                          )}
                        </div>

                        <div className="grid sm:grid-cols-3 gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              {formatDistanceToNow(new Date(order.created_at), { 
                                addSuffix: true,
                                locale: ptBR 
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-primary" />
                            <span className="font-bold text-primary">
                              R$ {order.total_amount.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedOrder(order)}
                        className="shrink-0"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        Detalhes
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
