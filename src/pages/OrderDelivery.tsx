import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { db } from "@/integrations/firebase/config";
import { invokeFunction } from "@/lib/apiHelper";
import { collection, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { Copy, Check, CheckCircle2, Package, AlertTriangle, Loader2, Star, Shield, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
const UPSELL_SEQUENCE = ["delivery_priority", "data_swap_warranty"];

function UpsellSequence({ orderId, userEmail, userName, userId }: {
  orderId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentType = UPSELL_SEQUENCE[currentIndex];
  
  if (!currentType) return null;

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
        const response = await invokeFunction('flowpay-pix', {
          method: 'GET',
          queryParams: { action: 'status', chargeId: pixData.chargeId, orderId: `upsell-${orderId}-${addonType}` },
        });
        const data = await response.json();
        if (data.success && data.status === "COMPLETED") {
          clearInterval(poll);
          setPaymentConfirmed(true);
          toast({ title: "Pagamento confirmado! 🎉", description: "Benefício ativado com sucesso!" });
          setTimeout(() => onSkip(), 1500);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Poll error:", err);
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
      <Card className="bg-card border-border">
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
      
      const saleAddonsRef = collection(db, "sale_addons");
      const addonDocRef = await addDoc(saleAddonsRef, {
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
        pix_code: null,
        pix_qr_code: null,
        flowpay_charge_id: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      const amountInCents = Math.round(config.price * 100);
      const pixResponse = await invokeFunction('flowpay-pix', {
        method: "POST",
        queryParams: { action: 'create' },
        body: {
          amount: amountInCents,
          orderId: `upsell-${orderId}-${config.addon_type}`,
          description: `Upsell ${config.title}`,
          customer: { name: userName || "Cliente", email: userEmail || undefined },
        },
      });
      const data = await pixResponse.json();
      if (!pixResponse.ok || !data.success) throw new Error(data.error || "Erro ao gerar PIX");

      await updateDoc(addonDocRef, {
        pix_code: data.brCode,
        flowpay_charge_id: data.chargeId,
        updated_at: serverTimestamp(),
      });

      setPixData({ qrCode: data.brCode, chargeId: data.chargeId });
    } catch (err: any) {
      if (import.meta.env.DEV) console.error("Upsell error:", err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    try {
      const saleAddonsRef2 = collection(db, "sale_addons");
      await addDoc(saleAddonsRef2, {
        order_id: orderId,
        addon_type: config.addon_type,
        status: "skipped",
        amount: 0,
        user_id: userId || null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
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
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-5 space-y-4">
          {paymentConfirmed ? (
            <div className="text-center space-y-3 py-6">
              <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-bold text-success">Pagamento Confirmado!</h2>
              <p className="text-sm text-muted-foreground">Benefício ativado com sucesso. 🎉</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-lg font-bold text-foreground">{config.title}</h2>
                <p className="text-2xl font-bold text-primary mt-1">
                  R$ {config.price.toFixed(2).replace(".", ",")}
                </p>
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
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

  // Offer view (inline)
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
          <h3 className="text-lg font-bold text-foreground">{config.title}</h3>
          {config.subtitle && <p className="text-xs text-muted-foreground">{config.subtitle}</p>}
        </div>

        {/* Benefits */}
        <div className="space-y-2">
          {config.benefits.map((benefit, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full bg-success/20 flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-2.5 h-2.5 text-success" />
              </div>
              <span className="text-xs text-muted-foreground">{benefit}</span>
            </div>
          ))}
        </div>

        {/* Price */}
        <div className="text-center space-y-0.5">
          {config.original_price && (
            <p className="text-muted-foreground/60 line-through text-xs">
              De R$ {config.original_price.toFixed(2).replace(".", ",")}
            </p>
          )}
          <p className="text-2xl font-bold text-primary">
            R$ {config.price.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-[10px] text-muted-foreground/60">Pagamento único via PIX</p>
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
          className="w-full text-center text-muted-foreground/50 hover:text-muted-foreground text-xs py-1 transition-colors"
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
  // Auth removed — delivery is accessed via hash, no user needed
  const [order, setOrder] = useState<GuestOrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  
  const [liveItems, setLiveItems] = useState<OrderItemData[] | null>(null);

  const upsellParam = searchParams.get("upsell");
  const orderIdParam = searchParams.get("order_id");

  // No longer need single upsell config — UpsellSequence handles it

  // Fetch guest order + items via Edge Function (Firestore is deny-all for ordens)
  useEffect(() => {
    if (!hash) { setNotFound(true); setLoading(false); return; }

    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentDelay = 5000; // start at 5s
    let prevItemsJson = ''; // track changes to avoid unnecessary re-renders
    let pollStartTime = Date.now();
    const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 min max polling

    const fetchGuestOrder = async (): Promise<'ok' | 'done' | 'error'> => {
      try {
        const res = await invokeFunction('guest-order', {
          method: 'GET',
          queryParams: { hash },
        });

        if (res.status === 429) return 'error'; // rate limited
        if (res.status >= 500) return 'error'; // server error

        // Only mark notFound on definitive 404/410, not network errors
        if (res.status === 404 || res.status === 410) {
          if (!cancelled) setNotFound(true);
          return 'done';
        }

        if (!res.ok) return 'error'; // other client errors — retry

        const data = await res.json();

        if (!cancelled) {
          const newItemsJson = JSON.stringify(data.items || []);

          setOrder({
            id: hash,
            hash: hash,
            order_id: data.order_id,
            email: data.email,
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            order_data: {
              items: data.items || [],
              total_amount: data.total_amount || 0,
              payment_method: data.payment_method || 'pix',
              created_at: data.created_at,
            },
            linked: data.linked,
            created_at: data.created_at || new Date().toISOString(),
            expires_at: data.expires_at || new Date().toISOString(),
          } as GuestOrderData);

          // Only update liveItems if data actually changed
          if (newItemsJson !== prevItemsJson) {
            prevItemsJson = newItemsJson;
            if (data.items && data.items.length > 0) {
              setLiveItems(data.items);
            }
          }

          // Check if all items have delivery codes → stop polling
          const allDelivered = (data.items || []).length > 0 &&
            (data.items as OrderItemData[]).every((i: OrderItemData) => !!i.delivery_code);
          if (allDelivered) return 'done';

          // Safety: stop polling after 10 minutes
          if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) return 'done';
        }
        return 'ok';
      } catch (err) {
        if (import.meta.env.DEV) console.error("Error fetching guest order:", err);
        // Network error → don't mark notFound, just retry with backoff
        return 'error';
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // ✅ Fix #5a: Polling with backoff on errors
    const schedulePoll = (result: 'ok' | 'done' | 'error') => {
      if (cancelled || result === 'done') return;

      if (result === 'error') {
        // Backoff: double delay, cap at 30s
        currentDelay = Math.min(currentDelay * 2, 30_000);
      } else {
        // Reset to normal interval on success
        currentDelay = 5000;
      }

      pollTimeout = setTimeout(async () => {
        if (cancelled) return;
        const nextResult = await fetchGuestOrder();
        schedulePoll(nextResult);
      }, currentDelay);
    };

    // Initial fetch
    fetchGuestOrder().then((result) => {
      if (!cancelled) schedulePoll(result);
    });

    return () => {
      cancelled = true;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando seu pedido...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Pedido não encontrado</h1>
          <p className="text-sm text-muted-foreground">
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
  const items = liveItems || orderData.items || [];
  const hasAnyCodes = items.some(i => i.delivery_code);
  const effectiveOrderId = orderIdParam || order.order_id;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/">
            <img src={vLogo} alt="Valnix" className="h-8" />
          </Link>
          <Badge variant="outline" className="text-success border-success/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Pagamento Confirmado
          </Badge>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10 space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-success" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Pedido Confirmado! 🎉
          </h1>
          <p className="text-muted-foreground text-sm">
            Olá, <span className="text-foreground font-medium">{order.customer_name || "Cliente"}</span>! 
            Seu pedido #{order.order_id.slice(0, 8)} foi confirmado.
          </p>
        </div>

        {/* Order email reference */}

        {/* Products & Delivery Codes */}
        <Card className="bg-card border-border">
          <CardContent className="p-5 md:p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              {hasAnyCodes ? "Seus Códigos de Entrega" : "Itens do Pedido"}
            </h2>

            <div className="space-y-4">
              {items.map((item, itemIndex) => {
                const codes = item.delivery_code ? item.delivery_code.split(",").map(c => c.trim()) : [];

                return (
                  <div key={itemIndex} className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center gap-4 p-4 bg-secondary/30">
                      {item.product_image && (
                        <img
                          src={item.product_image}
                          alt={item.product_name}
                          className="w-14 h-14 object-contain bg-muted rounded-lg"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-foreground truncate">{item.product_name}</h3>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          {item.quantity}x R$ {item.unit_price.toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                      <p className="font-bold text-primary shrink-0">
                        R$ {item.total_price.toFixed(2).replace(".", ",")}
                      </p>
                    </div>

                    {codes.length > 0 ? (
                      <div className="border-t border-border bg-success/5 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-success flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {codes.length} código(s) entregue(s)
                          </p>
                          {codes.length > 1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-success/30 text-success hover:bg-success/10"
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
                              className="flex items-center justify-between gap-2 bg-secondary/30 p-3 rounded-lg border border-border"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">#{codeIndex + 1}</span>
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
                      <div className="border-t border-border bg-orange-500/5 p-4" data-delivery-pending>
                        <div className="flex items-center gap-3">
                          <div className="bg-orange-500/15 p-2 rounded-full shrink-0">
                            <Package className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-orange-500">Entrega Pendente</p>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
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
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Resumo</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Pedido</span>
                <span className="text-foreground font-mono">#{order.order_id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Total</span>
                <span className="text-primary font-bold text-lg">
                  R$ {orderData.total_amount?.toFixed(2).replace(".", ",") || "0,00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">E-mail</span>
                <span className="text-muted-foreground truncate max-w-[200px]">{order.email}</span>
              </div>
              {orderData.created_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Data</span>
                  <span className="text-muted-foreground">
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
        {/* CTA: Back to store */}

        {/* Back to store */}
        <div className="text-center pb-8">
          <Link to="/">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
              ← Voltar à Loja
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
