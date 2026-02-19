import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePostPaymentPage } from "@/hooks/usePostPaymentPage";
import { db } from "@/integrations/firebase/config";
import { collection, addDoc, query, where, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, Check, Zap, Star, Clock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Progress } from "@/components/ui/progress";
import { invokeFunction } from "@/lib/apiHelper";
import vIcon from "@/assets/v-icon.png";

interface DynamicPostPaymentPageProps {
  addonType: string;
}

const badgeColorMap: Record<string, string> = {
  yellow: "bg-red-600 text-white",
  orange: "bg-red-500 text-white",
  green: "bg-red-700 text-white",
  red: "bg-red-600 text-white",
};

const iconMap: Record<string, typeof Shield> = {
  premium_benefits: Star,
  delivery_priority: Zap,
  data_swap_warranty: Shield,
};

/** Fire-and-forget Firestore write — never blocks UI */
function insertSaleAddonAsync(data: Record<string, any>) {
  try {
    addDoc(collection(db, "sale_addons"), {
      ...data,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }).catch(() => {});
  } catch { /* ignore */ }
}

function updateSaleAddonAsync(orderId: string, addonType: string, updates: Record<string, any>) {
  try {
    const q = query(
      collection(db, "sale_addons"),
      where("order_id", "==", orderId),
      where("addon_type", "==", addonType)
    );
    getDocs(q).then((snapshot) => {
      for (const doc of snapshot.docs) {
        updateDoc(doc.ref, { ...updates, updated_at: serverTimestamp() }).catch(() => {});
      }
    }).catch(() => {});
  } catch { /* ignore */ }
}

export function DynamicPostPaymentPage({ addonType }: DynamicPostPaymentPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdParam = searchParams.get("order_id") || "";
  const hashParam = searchParams.get("hash") || "";
  const utmSource = searchParams.get("utm_source") || null;
  const utmMedium = searchParams.get("utm_medium") || null;
  const utmCampaign = searchParams.get("utm_campaign") || null;
  const isStandalone = !orderIdParam;
  const orderId = orderIdParam || `lead-${Date.now()}`;
  const { config, loading: configLoading } = usePostPaymentPage(addonType);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [purchasing, setPurchasing] = useState(false);
  const [pixData, setPixData] = useState<{ qrCode: string; chargeId: string } | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10 * 60);

  // Track page view on mount via server (immune to adblockers)
  const viewTracked = useRef(false);
  useEffect(() => {
    if (configLoading || !config || viewTracked.current) return;
    viewTracked.current = true;
    invokeFunction("admin-post-payment", {
      method: "POST",
      body: {
        action: "track-view",
        order_id: orderId,
        addon_type: addonType,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      },
    }).catch(() => {});
  }, [configLoading, config]);

  // Build next-route URL helper
  const buildNextUrl = useCallback((nextRoute: string) => {
    if (nextRoute === "/order" && hashParam) return `/order/${hashParam}`;
    if (nextRoute === "/order") return "/";
    const params = new URLSearchParams();
    params.set("order_id", orderId);
    if (hashParam) params.set("hash", hashParam);
    return `${nextRoute}?${params.toString()}`;
  }, [orderId, hashParam]);

  // If no config after loading, redirect home
  useEffect(() => {
    if (!configLoading && !config) navigate("/");
  }, [configLoading, config, navigate]);

  // Timer for PIX
  useEffect(() => {
    if (!pixData || paymentConfirmed) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pixData, paymentConfirmed]);

  // Poll payment status
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!pixData || paymentConfirmed || timeLeft === 0) return;
    const poll = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const response = await invokeFunction("flowpay-pix", {
          method: "GET",
          queryParams: { action: "status", chargeId: pixData.chargeId, orderId: `upsell-${orderId}-${addonType}` },
        });
        const data = await response.json();
        if (data.success && data.status === "COMPLETED") {
          clearInterval(poll);
          setPaymentConfirmed(true);
          toast({ title: "Pagamento confirmado! 🎉", description: "Benefício ativado com sucesso!" });
          const nextRoute = config?.next_route || "/";
          setTimeout(() => navigate(buildNextUrl(nextRoute), { replace: true }), 1500);
        }
      } catch (err) {
        console.warn("Poll error:", err);
      } finally {
        pollingRef.current = false;
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [pixData, paymentConfirmed, timeLeft, config, navigate, toast, buildNextUrl, orderId, addonType]);

  const handleAccept = async () => {
    if (!config || purchasing) return;
    setPurchasing(true);
    try {
      // Fire-and-forget: record addon attempt
      insertSaleAddonAsync({
        order_id: orderId,
        user_id: null,
        addon_type: addonType,
        status: "pending",
        amount: config.price,
        customer_email: null,
        customer_name: null,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      });

      // Create PIX charge immediately
      const amountInCents = Math.round(config.price * 100);
      const pixResponse = await invokeFunction("flowpay-pix", {
        method: "POST",
        queryParams: { action: "create" },
        body: {
          amount: amountInCents,
          orderId: `upsell-${orderId}-${addonType}`,
          description: `Upsell ${config.title}`,
          customer: { name: "Cliente" },
        },
      });
      const data = await pixResponse.json();
      if (!pixResponse.ok || !data.success) throw new Error(data.error || "Erro ao gerar PIX");

      // Fire-and-forget: update addon with charge info
      updateSaleAddonAsync(orderId, addonType, {
        pix_code: data.brCode,
        flowpay_charge_id: data.chargeId,
      });

      setPixData({ qrCode: data.brCode, chargeId: data.chargeId });
    } catch (err: any) {
      console.error("Upsell payment error:", err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const handleSkip = () => {
    insertSaleAddonAsync({
      order_id: orderId,
      addon_type: addonType,
      status: "skipped",
      amount: 0,
      user_id: null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    });

    const nextRoute = config?.next_route || "/";
    if (isStandalone) {
      navigate(nextRoute === "/" ? "/" : nextRoute, { replace: true });
    } else {
      navigate(buildNextUrl(nextRoute), { replace: true });
    }
  };

  if (configLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) return null;

  const Icon = iconMap[addonType] || Star;
  const badgeClass = badgeColorMap[config.badge_color] || badgeColorMap.yellow;
  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // PIX Payment view
  if (pixData) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
        <div className="bg-secondary border border-border/20 rounded-2xl p-6 max-w-md w-full space-y-4">
          {paymentConfirmed ? (
            <div className="text-center space-y-3 py-8">
              <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-bold text-success">Pagamento Confirmado!</h2>
              <p className="text-sm text-muted-foreground">Benefício ativado. Redirecionando...</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-lg font-bold text-foreground">Pague via PIX</h2>
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
                    size={isMobile ? 200 : 240}
                    level="H"
                    imageSettings={{ src: vIcon, height: 36, width: 36, excavate: true }}
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => { navigator.clipboard.writeText(pixData.qrCode); toast({ title: "Copiado!" }); }}
              >
                Copiar Código PIX
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Upsell offer view
  return (
    <div className="min-h-[100dvh] relative flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950 via-red-900 to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.3)_0%,transparent_70%)]" />
      
      <div className="max-w-lg w-full space-y-3 sm:space-y-5 relative z-10">
        <div className="text-center space-y-2">
          {config.badge_text && (
            <span className={`inline-block px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-widest ${badgeClass} shadow-[0_0_20px_rgba(220,38,38,0.5)] animate-[pulse_1.5s_ease-in-out_infinite]`}>
              {config.badge_text}
            </span>
          )}
          <div className="w-14 h-14 sm:w-20 sm:h-20 bg-red-600/30 border-2 border-red-500/50 rounded-2xl flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(220,38,38,0.4)]">
            <Icon className="w-7 h-7 sm:w-10 sm:h-10 text-red-400" />
          </div>
          <h1 className="text-xl sm:text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_10px_rgba(220,38,38,0.3)]">{config.title}</h1>
          {config.subtitle && (
            <p className="text-red-200/70 text-[11px] sm:text-sm md:text-base font-medium">{config.subtitle}</p>
          )}
        </div>

        <div className="bg-black/60 backdrop-blur-sm border border-red-900/50 rounded-2xl p-3.5 sm:p-5 space-y-2 sm:space-y-3 shadow-[0_0_20px_rgba(220,38,38,0.15)]">
          {config.benefits.map((benefit, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-red-500/30 border border-red-500/50 flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-3 h-3 text-red-400" />
              </div>
              <span className="text-[12px] sm:text-sm text-white font-medium">{benefit}</span>
            </div>
          ))}
        </div>

        <div className="text-center space-y-0.5">
          {config.original_price && (
            <p className="text-red-300/50 line-through text-xs sm:text-sm">
              De R$ {config.original_price.toFixed(2).replace(".", ",")}
            </p>
          )}
          <p className="text-2xl sm:text-4xl font-black text-red-400 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]">
            R$ {config.price.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-[10px] sm:text-xs text-red-300/60 font-medium">Pagamento único via PIX</p>
        </div>

        <Button
          size="lg"
          className="w-full h-12 sm:h-16 text-sm sm:text-lg font-black rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white shadow-[0_0_30px_rgba(220,38,38,0.6)] animate-[pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] border-2 border-red-400/30 uppercase tracking-wider transition-transform duration-150"
          onClick={handleAccept}
          disabled={purchasing}
        >
          {purchasing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          {config.button_accept_text}
        </Button>

        <button
          onClick={handleSkip}
          className="w-full text-center text-red-300/50 hover:text-red-300/80 active:text-red-300/80 text-xs sm:text-sm py-3 transition-colors underline underline-offset-4 min-h-[48px]"
        >
          {config.button_skip_text}
        </button>
      </div>
    </div>
  );
}