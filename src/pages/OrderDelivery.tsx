import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/integrations/firebase/config";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Copy, Check, CheckCircle2, Package, Bookmark, AlertTriangle, Loader2, ShoppingBag, ArrowRight, Star, Shield, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { usePostPaymentPage } from "@/hooks/usePostPaymentPage";
import { QRCodeSVG } from "qrcode.react";
import { Progress } from "@/components/ui/progress";
import { useIsMobile } from "@/hooks/use-mobile";
import vLogo from "@/assets/v-logo-red.png";
import vIcon from "@/assets/v-icon.png";

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

// Upsell sequence manager
const UPSELL_SEQUENCE = ["premium_benefits", "delivery_priority", "data_swap_warranty"];

function UpsellSequence({ orderId, userEmail, userName, userId }: {
  orderId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentType = UPSELL_SEQUENCE[currentIndex];
  
  if (!currentType) return null; // All upsells done

  return (
    <InlineUpsell
      key={currentType}
      orderId={orderId}
      addonType={currentType}
      userEmail={userEmail}
      userName={userName}
      userId={userId}
      onSkip={() => setCurrentIndex(prev => prev + 1)}
    />
  );
}

// Inline upsell component
function InlineUpsell({ orderId, addonType, userEmail, userName, userId, onSkip }: {
  orderId: string;
  addonType: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
  onSkip: () => void;
}) {
  const { config, loading: configLoading } = usePostPaymentPage(addonType);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [purchasing, setPurchasing] = useState(false);
  const [pixData, setPixData] = useState<{ qrCode: string; chargeId: string } | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10 * 60);
  const [skipping, setSkipping] = useState(false);

  // Timer
  useEffect(() => {
    if (!pixData || paymentConfirmed) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pixData, paymentConfirmed]);

  // Poll payment
  useEffect(() => {
    if (!pixData || paymentConfirmed || timeLeft === 0) return;
    const poll = setInterval(async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${pixData.chargeId}`
        );
        const data = await response.json();
        if (data.success && data.status === "COMPLETED") {
          clearInterval(poll);
          setPaymentConfirmed(true);
          toast({ title: "Pagamento confirmado! 🎉", description: "Benefício ativado com sucesso!" });
          // After payment confirmed, advance to next upsell after delay
          setTimeout(() => onSkip(), 2500);
        }
      } catch (err) {
        console.warn("Poll error:", err);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [pixData, paymentConfirmed, timeLeft, toast, onSkip]);

  // Auto-skip disabled/missing addons
  useEffect(() => {
    if (!configLoading && !config) {
      onSkip();
    }
  }, [configLoading, config, onSkip]);

  if (configLoading) {
    return (
      <Card className="bg-[#111] border-[#1f1f1f]">
        <CardContent className="p-5 flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!config) return null;

  const handleAccept = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const utmParams = JSON.parse(sessionStorage.getItem('valnix_utm_params') || '{}');
      
      await supabase.from("sale_addons").insert({
        order_id: orderId,
        user_id: userId || null,
        addon_type: config.addon_type,
        status: "pending",
        amount: config.price,
        customer_email: userEmail || null,
        customer_name: userName || null,
        utm_source: utmParams.utm_source || null,
        utm_medium: utmParams.utm_medium || null,
        utm_campaign: utmParams.utm_campaign || null,
      });

      const amountInCents = Math.round(config.price * 100);
      const pixResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountInCents,
            orderId: `upsell-${orderId}-${config.addon_type}`,
            description: `Upsell ${config.title}`,
            customer: { name: userName || "Cliente", email: userEmail || undefined },
          }),
        }
      );
      const data = await pixResponse.json();
      if (!pixResponse.ok || !data.success) throw new Error(data.error || "Erro ao gerar PIX");

      await supabase
        .from("sale_addons")
        .update({ pix_code: data.brCode, flowpay_charge_id: data.chargeId, updated_at: new Date().toISOString() })
        .eq("order_id", orderId)
        .eq("addon_type", config.addon_type);

      setPixData({ qrCode: data.brCode, chargeId: data.chargeId });
    } catch (err: any) {
      console.error("Upsell error:", err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    try {
      await supabase.from("sale_addons").insert({
        order_id: orderId,
        addon_type: config.addon_type,
        status: "skipped",
        amount: 0,
        user_id: userId || null,
      });
    } catch (e) { /* ignore */ }
    onSkip();
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const iconMap: Record<string, typeof Shield> = { premium_benefits: Star, delivery_priority: Zap, data_swap_warranty: Shield };
  const Icon = iconMap[config.addon_type] || Star;
  const badgeColorMap: Record<string, string> = { yellow: "bg-yellow-500 text-black", orange: "bg-orange-500 text-white", green: "bg-green-500 text-white" };
  const badgeClass = badgeColorMap[config.badge_color] || badgeColorMap.yellow;

  // PIX payment view (inline)
  if (pixData) {
    return (
      <Card className="bg-[#111] border-[#1f1f1f] overflow-hidden">
        <CardContent className="p-5 space-y-4">
          {paymentConfirmed ? (
            <div className="text-center space-y-3 py-6">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-green-500">Pagamento Confirmado!</h2>
              <p className="text-sm text-gray-400">Benefício ativado com sucesso. 🎉</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-lg font-bold text-white">{config.title}</h2>
                <p className="text-2xl font-bold text-primary mt-1">
                  R$ {config.price.toFixed(2).replace(".", ",")}
                </p>
              </div>

              <div className="flex items-center justify-between text-sm text-gray-400">
                <span><Clock className="w-4 h-4 inline mr-1" />Expira em</span>
                <span className="font-mono text-primary font-bold">{formatTime(timeLeft)}</span>
              </div>
              <Progress value={(timeLeft / (10 * 60)) * 100} className="h-1" />

              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-xl">
                  <QRCodeSVG
                    value={pixData.qrCode}
                    size={isMobile ? 180 : 220}
                    level="H"
                    imageSettings={{ src: vIcon, height: 30, width: 30, excavate: true }}
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => { navigator.clipboard.writeText(pixData.qrCode); toast({ title: "Copiado!" }); }}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copiar Código PIX
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Offer view (inline) — NO X button
  return (
    <Card className="bg-gradient-to-br from-yellow-500/5 to-orange-500/5 border-yellow-500/20 overflow-hidden">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          {config.badge_text && (
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
              {config.badge_text}
            </span>
          )}
        </div>

        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center mx-auto">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-bold text-white">{config.title}</h3>
          {config.subtitle && <p className="text-xs text-gray-400">{config.subtitle}</p>}
        </div>

        {/* Benefits */}
        <div className="space-y-2">
          {config.benefits.map((benefit, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-2.5 h-2.5 text-green-500" />
              </div>
              <span className="text-xs text-gray-300">{benefit}</span>
            </div>
          ))}
        </div>

        {/* Price */}
        <div className="text-center space-y-0.5">
          {config.original_price && (
            <p className="text-gray-500 line-through text-xs">
              De R$ {config.original_price.toFixed(2).replace(".", ",")}
            </p>
          )}
          <p className="text-2xl font-bold text-primary">
            R$ {config.price.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-[10px] text-gray-500">Pagamento único via PIX</p>
        </div>

        <Button
          size="lg"
          className="w-full h-12 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 animate-pulse"
          onClick={handleAccept}
          disabled={purchasing}
        >
          {purchasing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {config.button_accept_text}
        </Button>

        <button
          onClick={handleSkip}
          className="w-full text-center text-gray-600 hover:text-gray-400 text-xs py-1 transition-colors"
        >
          {config.button_skip_text}
        </button>
      </CardContent>
    </Card>
  );
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
  const [liveItems, setLiveItems] = useState<OrderItemData[] | null>(null);

  const upsellParam = searchParams.get("upsell");
  const orderIdParam = searchParams.get("order_id");

  // No longer need single upsell config — UpsellSequence handles it

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

  // Listen to Firebase order_items in realtime for delivery code updates
  useEffect(() => {
    if (!order) return;
    const firebaseOrderId = orderIdParam || order.order_id;
    if (!firebaseOrderId) return;

    const itemsRef = collection(db, 'order_items');
    const q = query(itemsRef, where('order_id', '==', firebaseOrderId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) return;
      const firebaseItems: OrderItemData[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          product_name: data.product_name || '',
          product_image: data.product_image || null,
          quantity: data.quantity || 1,
          unit_price: data.unit_price || 0,
          total_price: data.total_price || 0,
          delivery_code: data.delivery_code || null,
        };
      });
      setLiveItems(firebaseItems);
    }, (err) => {
      console.warn('⚠️ Firebase order_items listener error:', err);
    });

    return () => unsubscribe();
  }, [order, orderIdParam]);

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
  // Use live Firebase data if available, fallback to static snapshot
  const items = liveItems || orderData.items || [];
  const hasAnyCodes = items.some(i => i.delivery_code);
  const effectiveOrderId = orderIdParam || order.order_id;

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

        {/* Save Link Buttons */}
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
              navigator.clipboard.writeText(window.location.href.split("?")[0]);
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

        {/* Upsells now happen as full-screen pages before reaching this delivery page */}

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
