import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePostPaymentPage } from "@/hooks/usePostPaymentPage";
import { db } from "@/integrations/firebase/config";
import { collection, addDoc, query, where, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, Check, Shield, Zap, Star, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Progress } from "@/components/ui/progress";
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

/** Helper to insert a sale_addon doc into Firestore */
async function insertSaleAddon(data: Record<string, any>) {
  const saleAddonsRef = collection(db, "sale_addons");
  await addDoc(saleAddonsRef, {
    ...data,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}

/** Helper to update a sale_addon doc in Firestore by order_id + addon_type */
async function updateSaleAddon(orderId: string, addonType: string, updates: Record<string, any>) {
  const saleAddonsRef = collection(db, "sale_addons");
  const q = query(saleAddonsRef, where("order_id", "==", orderId), where("addon_type", "==", addonType));
  const snapshot = await getDocs(q);
  for (const doc of snapshot.docs) {
    await updateDoc(doc.ref, { ...updates, updated_at: serverTimestamp() });
  }
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
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [purchasing, setPurchasing] = useState(false);
  const [pixData, setPixData] = useState<{ qrCode: string; chargeId: string } | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10 * 60);

  // If no config after loading, redirect home
  useEffect(() => {
    if (!configLoading && !config) {
      navigate("/");
    }
  }, [configLoading, config, navigate]);

  // Timer for PIX
  useEffect(() => {
    if (!pixData || paymentConfirmed) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pixData, paymentConfirmed]);

  // Poll payment status
  useEffect(() => {
    if (!pixData || paymentConfirmed || timeLeft === 0) return;
    const poll = setInterval(async () => {
      try {
        const idToken = user ? await user.getIdToken() : null;
        const { invokeFunction } = await import("@/lib/apiHelper");
        const response = await invokeFunction("flowpay-pix", {
          method: "GET",
          queryParams: { action: "status", chargeId: pixData.chargeId },
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        const data = await response.json();
        if (data.success && data.status === "COMPLETED") {
          clearInterval(poll);
          setPaymentConfirmed(true);
          toast({ title: "Pagamento confirmado! 🎉", description: "Benefício ativado com sucesso!" });
          const nextRoute = config?.next_route || "/";
          if (nextRoute === "/order" && hashParam) {
            setTimeout(() => navigate(`/order/${hashParam}`, { replace: true }), 2500);
          } else if (nextRoute === "/order") {
            setTimeout(() => navigate("/", { replace: true }), 2500);
          } else {
            const params = new URLSearchParams();
            params.set("order_id", orderId);
            if (hashParam) params.set("hash", hashParam);
            setTimeout(() => navigate(`${nextRoute}?${params.toString()}`, { replace: true }), 2500);
          }
        }
      } catch (err) {
        console.warn("Poll error:", err);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [pixData, paymentConfirmed, timeLeft, orderId, addonType, config, navigate, toast]);

  const handleAccept = async () => {
    if (!config || purchasing) return;
    setPurchasing(true);
    try {
      // Record addon attempt in Firestore
      await insertSaleAddon({
        order_id: orderId,
        user_id: user?.uid || null,
        addon_type: addonType,
        status: "pending",
        amount: config.price,
        customer_email: user?.email || null,
        customer_name: user?.displayName || null,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      });

      // Create PIX charge with Firebase auth
      const amountInCents = Math.round(config.price * 100);
      const firebaseIdToken = await user?.getIdToken();
      const { invokeFunction } = await import("@/lib/apiHelper");
      const pixResponse = await invokeFunction("flowpay-pix", {
        method: "POST",
        queryParams: { action: "create" },
        headers: firebaseIdToken ? { Authorization: `Bearer ${firebaseIdToken}` } : {},
        body: {
          amount: amountInCents,
          orderId: `upsell-${orderId}-${addonType}`,
          description: `Upsell ${config.title}`,
          customer: { name: user?.displayName || "Cliente", email: user?.email || undefined },
        },
      });
      const data = await pixResponse.json();
      if (!pixResponse.ok || !data.success) throw new Error(data.error || "Erro ao gerar PIX");

      // Update addon with charge info in Firestore
      await updateSaleAddon(orderId, addonType, {
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

  const [skipping, setSkipping] = useState(false);
  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    // Record skip in Firestore
    try {
      await insertSaleAddon({
        order_id: orderId,
        addon_type: addonType,
        status: "skipped",
        amount: 0,
        user_id: user?.uid || null,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      });
    } catch (e) { /* ignore */ }

    const nextRoute = config?.next_route || "/";
    
    if (isStandalone) {
      navigate(nextRoute === "/" ? "/" : nextRoute, { replace: true });
    } else {
      if (nextRoute === "/order" && hashParam) {
        navigate(`/order/${hashParam}`, { replace: true });
      } else if (nextRoute === "/order" && !hashParam) {
        navigate("/", { replace: true });
      } else {
        const params = new URLSearchParams();
        params.set("order_id", orderId);
        if (hashParam) params.set("hash", hashParam);
        navigate(`${nextRoute}?${params.toString()}`, { replace: true });
      }
    }
  };

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) {
    return null;
  }

  const Icon = iconMap[addonType] || Star;
  const badgeClass = badgeColorMap[config.badge_color] || badgeColorMap.yellow;
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // PIX Payment view
  if (pixData) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="bg-[#111] border border-[#1f1f1f] rounded-2xl p-6 max-w-md w-full space-y-4">
          {paymentConfirmed ? (
            <div className="text-center space-y-3 py-8">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-green-500">Pagamento Confirmado!</h2>
              <p className="text-sm text-gray-400">Benefício ativado. Redirecionando...</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-lg font-bold text-white">Pague via PIX</h2>
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
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      {/* Aggressive red animated background */}
      <div className="absolute inset-0 bg-gradient-to-b from-red-950 via-red-900 to-black animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,38,38,0.3)_0%,transparent_70%)] animate-[pulse_3s_ease-in-out_infinite]" />
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-[pulse_1.5s_ease-in-out_infinite]" />
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent animate-[pulse_1.5s_ease-in-out_infinite]" />
      
      <div className="max-w-lg w-full space-y-6 relative z-10">
        {/* Header with badge */}
        <div className="text-center space-y-3">
          {config.badge_text && (
            <span className={`inline-block px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest ${badgeClass} shadow-[0_0_20px_rgba(220,38,38,0.5)] animate-[pulse_1.5s_ease-in-out_infinite]`}>
              {config.badge_text}
            </span>
          )}
          <div className="w-20 h-20 bg-red-600/30 border-2 border-red-500/50 rounded-2xl flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(220,38,38,0.4)] animate-[pulse_2s_ease-in-out_infinite]">
            <Icon className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_10px_rgba(220,38,38,0.3)]">{config.title}</h1>
          {config.subtitle && (
            <p className="text-red-200/70 text-sm md:text-base font-medium">{config.subtitle}</p>
          )}
        </div>

        {/* Benefits */}
        <div className="bg-black/60 backdrop-blur-sm border border-red-900/50 rounded-2xl p-5 space-y-3 shadow-[0_0_20px_rgba(220,38,38,0.15)]">
          {config.benefits.map((benefit, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-red-500/30 border border-red-500/50 flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-3.5 h-3.5 text-red-400" />
              </div>
              <span className="text-sm text-white font-medium">{benefit}</span>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div className="text-center space-y-1">
          {config.original_price && (
            <p className="text-red-300/50 line-through text-sm">
              De R$ {config.original_price.toFixed(2).replace(".", ",")}
            </p>
          )}
          <p className="text-4xl font-black text-red-400 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)] animate-[pulse_2s_ease-in-out_infinite]">
            R$ {config.price.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-xs text-red-300/60 font-medium">Pagamento único via PIX</p>
        </div>

        {/* CTA */}
        <Button
          size="lg"
          className="w-full h-16 text-lg font-black rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-[0_0_30px_rgba(220,38,38,0.6)] animate-[pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] border-2 border-red-400/30 uppercase tracking-wider"
          onClick={handleAccept}
          disabled={purchasing}
        >
          {purchasing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          {config.button_accept_text}
        </Button>

        {/* Skip */}
        <button
          onClick={handleSkip}
          className="w-full text-center text-red-300/30 hover:text-red-300/60 text-xs py-2 transition-colors"
        >
          {config.button_skip_text}
        </button>

      </div>
    </div>
  );
}
