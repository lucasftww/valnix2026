import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Check, CheckCircle2, Package, Bookmark, AlertTriangle, Loader2, ShoppingBag, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import vLogo from "@/assets/v-logo-red.png";

interface OrderItemData {
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_code: string | null;
}

interface GuestOrderData {
  id: string;
  hash: string;
  order_id: string;
  email: string;
  customer_name: string | null;
  customer_phone: string | null;
  order_data: {
    items: OrderItemData[];
    total_amount: number;
    payment_method?: string;
    created_at?: string;
  };
  linked: boolean;
  created_at: string;
  expires_at: string;
}

export default function OrderDelivery() {
  const { hash } = useParams<{ hash: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [order, setOrder] = useState<GuestOrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);

  const upsellParam = searchParams.get("upsell");
  const orderIdParam = searchParams.get("order_id");

  useEffect(() => {
    if (!hash) { setNotFound(true); setLoading(false); return; }

    const fetchOrder = async () => {
      try {
        const { data, error } = await supabase
          .from("guest_orders")
          .select("*")
          .eq("hash", hash)
          .maybeSingle();

        if (error || !data) {
          setNotFound(true);
        } else {
          // Check expiry
          if (new Date(data.expires_at) < new Date()) {
            setNotFound(true);
          } else {
            setOrder(data as unknown as GuestOrderData);
          }
        }
      } catch (err) {
        console.error("Error fetching guest order:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [hash]);

  const copyCode = (code: string, index: number) => {
    navigator.clipboard.writeText(code.trim());
    setCopiedCode(code.trim());
    toast({ title: "Copiado!", description: `Código #${index + 1} copiado!` });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyAllCodes = (codes: string[]) => {
    navigator.clipboard.writeText(codes.join("\n"));
    toast({ title: "Copiado!", description: "Todos os códigos copiados!" });
  };

  const handleBookmark = () => {
    setBookmarked(true);
    toast({
      title: "💡 Dica",
      description: "Use Ctrl+D (ou ⌘+D no Mac) para salvar nos favoritos!",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-gray-400">Carregando seu pedido...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-white">Pedido não encontrado</h1>
          <p className="text-sm text-gray-400">
            Este link pode ter expirado ou ser inválido. Se você fez uma compra, verifique o e-mail usado no checkout.
          </p>
          <Link to="/">
            <Button className="mt-4">Voltar à Loja</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const orderData = order.order_data;
  const items = orderData.items || [];
  const hasAnyCodes = items.some(i => i.delivery_code);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="border-b border-[#1a1a1a] bg-[#0d0d0d]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/">
            <img src={vLogo} alt="Valnix" className="h-8" />
          </Link>
          <Badge variant="outline" className="text-green-500 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Pagamento Confirmado
          </Badge>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10 space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            Pedido Confirmado! 🎉
          </h1>
          <p className="text-gray-400 text-sm">
            Olá, <span className="text-white font-medium">{order.customer_name || "Cliente"}</span>! 
            Seu pedido #{order.order_id.slice(0, 8)} foi confirmado.
          </p>
        </div>

        {/* Warning Banner */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-500">Salve este link!</p>
            <p className="text-xs text-gray-400 mt-1">
              Se perder acesso, use o e-mail <span className="text-white">{order.email}</span> para recuperar.
              {!user && " Ou cadastre-se para vincular este pedido à sua conta."}
            </p>
          </div>
        </div>

        {/* Save Link Button */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 h-11 border-[#2a2a2a] text-gray-300 hover:text-white"
            onClick={handleBookmark}
          >
            <Bookmark className={`w-4 h-4 mr-2 ${bookmarked ? "fill-primary text-primary" : ""}`} />
            {bookmarked ? "Salvo!" : "Salvar nos Favoritos"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-11 border-[#2a2a2a] text-gray-300 hover:text-white"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast({ title: "Link copiado!", description: "Cole em algum lugar seguro." });
            }}
          >
            <Copy className="w-4 h-4 mr-2" />
            Copiar Link
          </Button>
        </div>

        {/* Products & Delivery Codes */}
        <Card className="bg-[#111] border-[#1f1f1f]">
          <CardContent className="p-5 md:p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {hasAnyCodes ? "Seus Códigos de Entrega" : "Itens do Pedido"}
            </h2>

            <div className="space-y-4">
              {items.map((item, itemIndex) => {
                const codes = item.delivery_code ? item.delivery_code.split(",").map(c => c.trim()) : [];

                return (
                  <div key={itemIndex} className="rounded-xl border border-[#1f1f1f] overflow-hidden">
                    {/* Product Info */}
                    <div className="flex items-center gap-4 p-4 bg-[#0d0d0d]">
                      {item.product_image && (
                        <img
                          src={item.product_image}
                          alt={item.product_name}
                          className="w-14 h-14 object-contain bg-[#1a1a1a] rounded-lg"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-white truncate">{item.product_name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {item.quantity}x R$ {item.unit_price.toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                      <p className="font-bold text-primary shrink-0">
                        R$ {item.total_price.toFixed(2).replace(".", ",")}
                      </p>
                    </div>

                    {/* Delivery Codes */}
                    {codes.length > 0 ? (
                      <div className="border-t border-[#1f1f1f] bg-green-500/5 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-green-500 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {codes.length} código(s) entregue(s)
                          </p>
                          {codes.length > 1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-green-500/30 text-green-500 hover:bg-green-500/10"
                              onClick={() => copyAllCodes(codes)}
                            >
                              <Copy className="w-3 h-3 mr-1" /> Copiar Todos
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {codes.map((code, codeIndex) => (
                            <div
                              key={codeIndex}
                              className="flex items-center justify-between gap-2 bg-[#0d0d0d] p-3 rounded-lg border border-[#1a1a1a]"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-[10px] text-gray-600 font-mono shrink-0">#{codeIndex + 1}</span>
                                <code className="text-sm font-mono text-primary font-bold break-all select-all">
                                  {code}
                                </code>
                              </div>
                              <Button
                                size="sm"
                                className="shrink-0 h-9 px-3 bg-primary hover:bg-primary/90"
                                onClick={() => copyCode(code, codeIndex)}
                              >
                                {copiedCode === code.trim() ? (
                                  <Check className="w-4 h-4" />
                                ) : (
                                  <>
                                    <Copy className="w-4 h-4 mr-1" />
                                    <span className="text-xs">Copiar</span>
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-[#1f1f1f] bg-orange-500/5 p-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-orange-500/15 p-2 rounded-full shrink-0">
                            <Package className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-orange-500">Entrega Pendente</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Os códigos aparecerão aqui quando disponíveis. Recarregue a página.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card className="bg-[#111] border-[#1f1f1f]">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Resumo</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Pedido</span>
                <span className="text-white font-mono">#{order.order_id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total</span>
                <span className="text-primary font-bold text-lg">
                  R$ {orderData.total_amount?.toFixed(2).replace(".", ",") || "0,00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">E-mail</span>
                <span className="text-gray-300 truncate max-w-[200px]">{order.email}</span>
              </div>
              {orderData.created_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Data</span>
                  <span className="text-gray-300">
                    {new Date(orderData.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upsell CTA - shown after payment */}
        {upsellParam === "1" && orderIdParam && (
          <Card className="bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border-yellow-500/20">
            <CardContent className="p-5 text-center space-y-3">
              <div className="text-3xl">🎁</div>
              <h3 className="font-bold text-white">Oferta Especial!</h3>
              <p className="text-xs text-gray-400">
                Aproveite uma oferta exclusiva disponível apenas agora.
              </p>
              <Button
                className="w-full h-11 bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                onClick={() => navigate(`/painel-pagar?order_id=${orderIdParam}`)}
              >
                Ver Oferta Especial
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* CTA: Create account */}
        {!user && !order.linked && (
          <Card className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
            <CardContent className="p-5 text-center space-y-3">
              <ShoppingBag className="w-8 h-8 text-primary mx-auto" />
              <h3 className="font-bold text-white">Quer acompanhar seus pedidos?</h3>
              <p className="text-xs text-gray-400">
                Crie uma conta grátis e vincule este pedido. Assim você pode acessar de qualquer lugar.
              </p>
              <Link to={`/auth?redirect=/order/${hash}`}>
                <Button className="w-full h-11 bg-primary hover:bg-primary/90">
                  Criar Conta Grátis
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Back to store */}
        <div className="text-center pb-8">
          <Link to="/">
            <Button variant="ghost" className="text-gray-500 hover:text-white">
              ← Voltar à Loja
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
