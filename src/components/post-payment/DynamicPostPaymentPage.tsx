import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePostPaymentPage } from "@/hooks/usePostPaymentPage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, Check, Shield, Zap, Star, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { Progress } from "@/components/ui/progress";
import vIcon from "@/assets/v-icon.png";

interface DynamicPostPaymentPageProps {
  addonType: string;
}

const badgeColorMap: Record<string, string> = {
  yellow: "bg-yellow-500 text-black",
  orange: "bg-orange-500 text-white",
  green: "bg-green-500 text-white",
};

const iconMap: Record<string, typeof Shield> = {
  premium_benefits: Star,
  delivery_priority: Zap,
  data_swap_warranty: Shield,
};

export function DynamicPostPaymentPage({ addonType }: DynamicPostPaymentPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdParam = searchParams.get("order_id") || "";
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
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${pixData.chargeId}`,
          { headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } }
        );
        const data = await response.json();
        if (data.success && data.status === "COMPLETED") {
          clearInterval(poll);
          setPaymentConfirmed(true);
          // Update sale_addon
          await supabase
            .from("sale_addons")
            .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("order_id", orderId)
            .eq("addon_type", addonType);
          toast({ title: "Pagamento confirmado! 🎉", description: "Benefício ativado com sucesso!" });
          setTimeout(() => navigate(config?.next_route || "/", { replace: true }), 2500);
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
      // Record addon attempt
      await supabase.from("sale_addons").insert({
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

      // Create PIX charge
      const amountInCents = Math.round(config.price * 100);
      const pixResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            amount: amountInCents,
            orderId: `upsell-${orderId}-${addonType}`,
            description: `Upsell ${config.title}`,
            customer: { name: user?.displayName || "Cliente", email: user?.email || undefined },
          }),
        }
      );
      const data = await pixResponse.json();
      if (!pixResponse.ok || !data.success) throw new Error(data.error || "Erro ao gerar PIX");

      // Update addon with charge info
      await supabase
        .from("sale_addons")
        .update({ pix_code: data.brCode, flowpay_charge_id: data.chargeId, updated_at: new Date().toISOString() })
        .eq("order_id", orderId)
        .eq("addon_type", addonType);

      setPixData({ qrCode: data.brCode, chargeId: data.chargeId });
    } catch (err: any) {
      console.error("Upsell payment error:", err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const handleSkip = async () => {
    // Record skip
    try {
      await supabase.from("sale_addons").insert({
        order_id: orderId,
        addon_type: addonType,
        status: "skipped",
        amount: 0,
        user_id: user?.uid || null,
      });
    } catch (e) { /* ignore */ }

    if (isStandalone) {
      // In standalone mode, skip goes to next upsell or home
      const nextRoute = config?.next_route || "/";
      if (nextRoute === "/") {
        navigate("/", { replace: true });
      } else {
        navigate(nextRoute, { replace: true });
      }
    } else {
      navigate(`${config?.next_route || "/"}${config?.next_route !== "/" ? `?order_id=${orderId}` : ""}`, { replace: true });
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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        {/* Header with badge */}
        <div className="text-center space-y-3">
          {config.badge_text && (
            <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${badgeClass}`}>
              {config.badge_text}
            </span>
          )}
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto">
            <Icon className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">{config.title}</h1>
          {config.subtitle && (
            <p className="text-gray-400 text-sm md:text-base">{config.subtitle}</p>
          )}
        </div>

        {/* Benefits */}
        <div className="bg-[#111] border border-[#1f1f1f] rounded-2xl p-5 space-y-3">
          {config.benefits.map((benefit, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5 shrink-0">
                <Check className="w-3 h-3 text-green-500" />
              </div>
              <span className="text-sm text-gray-200">{benefit}</span>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div className="text-center space-y-1">
          {config.original_price && (
            <p className="text-gray-500 line-through text-sm">
              De R$ {config.original_price.toFixed(2).replace(".", ",")}
            </p>
          )}
          <p className="text-3xl font-bold text-primary">
            R$ {config.price.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-xs text-gray-500">Pagamento único via PIX</p>
        </div>

        {/* CTA */}
        <Button
          size="lg"
          className="w-full h-14 text-base font-bold rounded-xl bg-primary hover:bg-primary/90 animate-pulse"
          onClick={handleAccept}
          disabled={purchasing}
        >
          {purchasing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
          {config.button_accept_text}
        </Button>

        {/* Skip */}
        <button
          onClick={handleSkip}
          className="w-full text-center text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
        >
          {config.button_skip_text}
        </button>

        {/* Trust */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-600">
          <Shield className="w-3 h-3" />
          <span>Pagamento seguro • Ativação imediata</span>
        </div>
      </div>
    </div>
  );
}
