import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useUserOrders, useOrderItems, type Order } from "@/hooks/firebase/useFirebaseOrders";
import { useAutoVerifyPixPayments } from "@/hooks/firebase/useAutoVerifyPixPayments";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Calendar, DollarSign, Eye, Copy, Check, ArrowLeft, ShoppingBag, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
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

  useAutoVerifyPixPayments(orders);

  if (!authLoading && !user) {
    navigate("/auth");
    return null;
  }

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed": case "entregue": return <CheckCircle2 className="w-4 h-4" />;
      case "processing": case "processando": return <Clock className="w-4 h-4" />;
      case "cancelled": case "cancelado": return <XCircle className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status?.toLowerCase()) {
      case "paid": case "pago": case "completed": case "entregue": return "default";
      case "cancelled": case "cancelado": case "failed": case "falhou": return "destructive";
      default: return "secondary";
    }
  };

  const translateStatus = (status: string) => {
    const t: Record<string, string> = {
      pending: "Pendente", processing: "Processando", completed: "Concluído",
      shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado", refunded: "Reembolsado",
    };
    return t[status?.toLowerCase()] || status || "Pendente";
  };

  const translatePaymentStatus = (status: string) => {
    const t: Record<string, string> = {
      pending: "Pendente", paid: "Pago", failed: "Falhou", refunded: "Reembolsado", cancelled: "Cancelado",
    };
    return t[status?.toLowerCase()] || status || "Pendente";
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <Navigation />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Carregando pedidos...</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <Navigation />
        <main className="flex-1 container px-4 py-6 md:py-8">
          <div className="max-w-4xl mx-auto">
            <Button
              variant="ghost"
              onClick={() => setSelectedOrder(null)}
              className="mb-4 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar para Meus Pedidos
            </Button>

            <div className="space-y-4">
              {/* Order Header Card */}
              <Card className="border-border/50 overflow-hidden">
                <div className="bg-gradient-to-r from-primary/10 to-transparent p-5 md:p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Pedido</p>
                      <h1 className="text-xl md:text-2xl font-bold">#{selectedOrder.id.slice(0, 8)}</h1>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(selectedOrder.created_at).toLocaleDateString("pt-BR", {
                          day: "2-digit", month: "long", year: "numeric"
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {selectedOrder.payment_status === "paid" ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Pago
                        </Badge>
                      ) : (
                        <>
                          <Badge variant={getStatusVariant(selectedOrder.status)}>
                            {getStatusIcon(selectedOrder.status)}
                            <span className="ml-1">{translateStatus(selectedOrder.status)}</span>
                          </Badge>
                          <Badge variant={getStatusVariant(selectedOrder.payment_status)}>
                            {translatePaymentStatus(selectedOrder.payment_status)}
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Info Grid */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="border-border/50">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">Resumo</h3>
                    <div className="space-y-2.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-bold text-primary text-lg">R$ {selectedOrder.total_amount.toFixed(2).replace(".", ",")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pagamento</span>
                        <span>{selectedOrder.payment_method || "PIX"}</span>
                      </div>
                      {selectedOrder.tracking_code && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Rastreio</span>
                          <span className="font-mono text-xs">{selectedOrder.tracking_code}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-3 text-sm uppercase tracking-wider text-muted-foreground">Cliente</h3>
                    <div className="space-y-2.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Nome</span>
                        <span>{selectedOrder.customer_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span className="truncate max-w-[180px]">{selectedOrder.customer_email}</span>
                      </div>
                      {selectedOrder.customer_phone && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Telefone</span>
                          <span>{selectedOrder.customer_phone}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {selectedOrder.notes && (
                <Card className="border-border/50">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-2 text-sm uppercase tracking-wider text-muted-foreground">Observações</h3>
                    <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                  </CardContent>
                </Card>
              )}

              {/* Order Items */}
              <Card className="border-border/50">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Itens do Pedido</h3>
                  {loadingItems ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orderItems.map((item) => (
                        <div key={item.id} className="rounded-xl border border-border/50 overflow-hidden">
                          <div className="flex items-center gap-4 p-4">
                            {item.product_image && (
                              <img
                                src={item.product_image}
                                alt={item.product_name}
                                className="w-14 h-14 object-contain bg-muted/30 rounded-lg"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-sm truncate">{item.product_name}</h4>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {item.quantity}x R$ {item.unit_price.toFixed(2).replace(".", ",")}
                              </p>
                            </div>
                            <p className="font-bold text-primary shrink-0">R$ {item.total_price.toFixed(2).replace(".", ",")}</p>
                          </div>

                          {item.delivery_code ? (
                            <div className="border-t border-border/50 bg-green-500/5 p-4">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-medium text-green-500 flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {item.delivery_code.split(",").length} código(s) entregue(s)
                                </p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    navigator.clipboard.writeText(item.delivery_code!);
                                    toast({ title: "Copiado!", description: "Todos os códigos copiados." });
                                  }}
                                >
                                  <Copy className="w-3 h-3 mr-1" /> Copiar Todos
                                </Button>
                              </div>
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {item.delivery_code.split(",").map((code, index) => (
                                  <div key={index} className="flex items-center justify-between gap-2 bg-background/60 p-2 rounded-lg border border-border/30">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">#{index + 1}</span>
                                      <code className="text-xs font-mono text-primary font-bold break-all select-all">{code.trim()}</code>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="shrink-0 h-7 w-7 p-0"
                                      onClick={() => {
                                        navigator.clipboard.writeText(code.trim());
                                        setCopiedCode(code.trim());
                                        toast({ title: "Copiado!", description: `Código #${index + 1} copiado!` });
                                        setTimeout(() => setCopiedCode(null), 2000);
                                      }}
                                    >
                                      {copiedCode === code.trim() ? (
                                        <Check className="w-3.5 h-3.5 text-green-500" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : selectedOrder.payment_status === "paid" ? (
                            <div className="border-t border-border/50 bg-orange-500/5 p-4">
                              <div className="flex items-center gap-3">
                                <div className="bg-orange-500/15 p-2 rounded-full shrink-0">
                                  <Package className="w-4 h-4 text-orange-500" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-orange-500">Entrega Pendente</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">Os códigos aparecerão aqui quando estiverem disponíveis.</p>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <Navigation />
      <main className="flex-1 container px-4 py-6 md:py-8">
        <div className="max-w-5xl mx-auto">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-6 md:mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Meus Pedidos</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {orders.length > 0 ? `${orders.length} pedido(s) encontrado(s)` : "Acompanhe seus pedidos"}
              </p>
            </div>
            <Link to="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>

          {orders.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="flex flex-col items-center justify-center py-16 md:py-20">
                <div className="bg-muted/50 p-5 rounded-full mb-5">
                  <ShoppingBag className="w-10 h-10 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">Nenhum pedido ainda</h2>
                <p className="text-muted-foreground text-sm mb-6 text-center max-w-sm">
                  Quando você fizer sua primeira compra, seus pedidos aparecerão aqui.
                </p>
                <Link to="/">
                  <Button className="bg-primary hover:bg-primary/90">Explorar Produtos</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <Card
                  key={order.id}
                  className="border-border/50 hover:border-primary/30 transition-all cursor-pointer group"
                  onClick={() => setSelectedOrder(order)}
                >
                  <CardContent className="p-4 md:p-5">
                    <div className="flex items-center gap-4">
                      {/* Icon */}
                      <div className="hidden sm:flex bg-primary/10 p-3 rounded-xl shrink-0">
                        <Package className="w-5 h-5 text-primary" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-bold text-sm md:text-base">#{order.id.slice(0, 8)}</h3>
                          {order.payment_status === "paid" ? (
                            <Badge variant="default" className="bg-green-600 hover:bg-green-600 text-[10px] h-5">
                              Pago
                            </Badge>
                          ) : (
                            <Badge variant={getStatusVariant(order.payment_status)} className="text-[10px] h-5">
                              {translatePaymentStatus(order.payment_status)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: ptBR })}
                          </span>
                        </div>
                      </div>

                      {/* Price + Arrow */}
                      <div className="text-right shrink-0">
                        <p className="font-bold text-primary text-base md:text-lg">
                          R$ {order.total_amount.toFixed(2).replace(".", ",")}
                        </p>
                        <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors flex items-center justify-end gap-1 mt-0.5">
                          Ver detalhes <Eye className="w-3 h-3" />
                        </span>
                      </div>
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
