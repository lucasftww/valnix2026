import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invokeFunction } from "@/lib/apiHelper";
import { sendPurchaseFromClient } from "@/lib/metaCapi";
import { trackPurchaseEvent } from "@/lib/analytics";

type PaymentStatus = "checking" | "paid" | "pending" | "failed";

export default function CardPaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaymentStatus>("checking");
  const [pollCount, setPollCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmCalledRef = useRef(false);

  const urlOrderId = searchParams.get("order_id");
  const urlPaymentId = searchParams.get("payment_id");
  
  // Check if this is an upsell callback
  const upsellContext = (() => {
    try {
      const raw = sessionStorage.getItem('valnix_card_upsell');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const stored = (() => {
    try {
      const raw = sessionStorage.getItem('valnix_card_payment');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const isUpsell = !!upsellContext;
  const orderId = isUpsell ? upsellContext?.orderId : (urlOrderId || stored?.orderId);
  const paymentId = isUpsell ? upsellContext?.paymentId : (urlPaymentId || stored?.paymentId);

  useEffect(() => {
    if (!orderId || !paymentId) return;

    const checkStatus = async () => {
      try {
        if (isUpsell) {
          // For upsell, use upsell-status action (no auth needed)
          const res = await invokeFunction('flowpay-card', {
            method: 'GET',
            queryParams: { action: 'upsell-status', id: paymentId },
          });
          const result = await res.json();

          if (result.success && result.status === "COMPLETED") {
            setStatus("paid");
            if (intervalRef.current) clearInterval(intervalRef.current);

            if (!confirmCalledRef.current) {
              confirmCalledRef.current = true;
              const nextRoute = upsellContext.nextRoute;
              const hash = upsellContext.hash || '';
              sessionStorage.removeItem('valnix_card_upsell');
              
              // Build redirect URL
              const params = new URLSearchParams();
              params.set("order_id", orderId);
              if (hash) params.set("hash", hash);
              
              const redirectUrl = nextRoute === "/order" && hash
                ? `/order/${hash}`
                : nextRoute === "/order"
                ? "/"
                : `${nextRoute}?${params.toString()}`;
              
              setTimeout(() => navigate(redirectUrl, { replace: true }), 1500);
            }
          } else if (result.status === "FAILED" || result.status === "CANCELLED") {
            setStatus("failed");
            if (intervalRef.current) clearInterval(intervalRef.current);
            sessionStorage.removeItem('valnix_card_upsell');
          } else {
            setStatus("pending");
          }
        } else {
          // Original flow for main order payment
          const statusHeaders: Record<string, string> = {};
          if (stored?.deliveryToken) {
            statusHeaders['x-delivery-token'] = stored.deliveryToken;
          }

          const res = await invokeFunction('flowpay-card', {
            method: 'GET',
            queryParams: { action: 'status', id: paymentId },
            headers: statusHeaders,
          });
          const result = await res.json();

          if (result.success && result.status === "COMPLETED") {
            setStatus("paid");
            if (intervalRef.current) clearInterval(intervalRef.current);

            if (!confirmCalledRef.current) {
              confirmCalledRef.current = true;
              try {
                const headers: Record<string, string> = {};
                if (stored?.deliveryToken) {
                  headers['x-delivery-token'] = stored.deliveryToken;
                }

                if (stored?.deliveryToken) {
                  const confirmRes = await invokeFunction('flowpay-card', {
                    method: 'POST',
                    queryParams: { action: 'confirm' },
                    headers,
                    body: { orderId, paymentId },
                  });
                  const confirmResult = await confirmRes.json();
                  if (import.meta.env.DEV) console.log(`🔒 Server-side card confirm result for ${orderId}:`, confirmResult);
                } else {
                  if (import.meta.env.DEV) console.log(`ℹ️ No auth — card payment will be handled by admin auto-verify`);
                }
              } catch (confirmErr) {
                if (import.meta.env.DEV) console.warn('⚠️ Card confirm call failed (admin auto-verify will retry):', confirmErr);
              }

              // Store payment_method=card so upsell pages know
              try {
                sessionStorage.setItem('valnix_payment_method', 'card');
              } catch {}

              sessionStorage.removeItem('valnix_card_payment');

              // Track Purchase events
              if (stored?.amount && stored?.orderId) {
                trackPurchaseEvent(stored?.userId || null, stored?.amount, orderId, stored?.productNames?.join(', '));
                sendPurchaseFromClient({
                  orderId,
                  value: stored?.amount,
                  userId: stored?.userId,
                  email: stored?.customerEmail,
                  phone: stored?.customerPhone,
                  name: stored?.customerName,
                  productNames: stored?.productNames,
                  productIds: stored?.productIds,
                  quantities: stored?.quantities,
                  prices: stored?.prices,
                  eventSourceUrl: stored?.eventSourceUrl,
                });
              }

              const guestHash = stored?.guestHash;
              if (guestHash) {
                setTimeout(() => navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${guestHash}`), 1500);
              } else {
                setTimeout(() => navigate(`/entrega-prioritaria?order_id=${orderId}`), 1500);
              }
            }

          } else if (result.status === "FAILED" || result.status === "CANCELLED") {
            setStatus("failed");
            if (intervalRef.current) clearInterval(intervalRef.current);
            sessionStorage.removeItem('valnix_card_payment');
          } else {
            setStatus("pending");
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("Card status check error:", err);
        setStatus("pending");
      }
    };

    checkStatus();

    intervalRef.current = setInterval(() => {
      setPollCount(prev => {
        if (prev >= 24) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatus("failed");
          return prev;
        }
        checkStatus();
        return prev + 1;
      });
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [orderId, paymentId, navigate]);

  if (!orderId || !paymentId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Link inválido</h1>
          <p className="text-muted-foreground text-sm mb-6">Não foi possível encontrar informações do pagamento.</p>
          <Button onClick={() => navigate("/")} variant="outline">
            Voltar à loja
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
        {status === "checking" || status === "pending" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Verificando pagamento...</h1>
            <p className="text-muted-foreground text-sm">
              Aguarde enquanto confirmamos seu pagamento com cartão.
            </p>
            {status === "pending" && pollCount > 2 && (
              <p className="text-muted-foreground/60 text-xs mt-4">
                Se você já pagou, aguarde alguns instantes...
              </p>
            )}
          </>
        ) : status === "paid" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Pagamento confirmado!</h1>
            <p className="text-muted-foreground text-sm">
              Redirecionando...
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Pagamento não confirmado</h1>
            <p className="text-muted-foreground text-sm mb-6">
              O pagamento com cartão não foi concluído ou foi recusado.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate(isUpsell ? "/" : "/checkout")} variant="outline">
                {isUpsell ? "Voltar à loja" : "Tentar novamente"}
              </Button>
              {!isUpsell && (
                <Button onClick={() => navigate("/")} variant="ghost">
                  Voltar à loja
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}