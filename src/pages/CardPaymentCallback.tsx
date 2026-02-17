import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invokeFunction } from "@/lib/apiHelper";
import { sendPurchaseFromClient } from "@/lib/metaCapi";

type PaymentStatus = "checking" | "paid" | "pending" | "failed";

export default function CardPaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaymentStatus>("checking");
  const [pollCount, setPollCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmCalledRef = useRef(false); // Prevent double confirm

  const urlOrderId = searchParams.get("order_id");
  const urlPaymentId = searchParams.get("payment_id");
  
  const stored = (() => {
    try {
      const raw = sessionStorage.getItem('valnix_card_payment');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const orderId = urlOrderId || stored?.orderId;
  const paymentId = urlPaymentId || stored?.paymentId;

  useEffect(() => {
    if (!orderId || !paymentId) return;

    const checkStatus = async () => {
      try {
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
              console.warn('⚠️ Card confirm call failed (admin auto-verify will retry):', confirmErr);
            }
          }

          sessionStorage.removeItem('valnix_card_payment');

          // Send Purchase to Meta CAPI (card payments)
          sendPurchaseFromClient({
            orderId,
            value: stored?.amount,
            userId: stored?.userId,
            email: stored?.customerEmail,
            name: stored?.customerName,
            productNames: stored?.productNames,
            productIds: stored?.productIds,
            quantities: stored?.quantities,
            prices: stored?.prices,
            eventSourceUrl: stored?.eventSourceUrl,
          });

          // 🔒 FIX: Guest order is already created server-side by create-order edge function.
          // Do NOT call saveGuestOrder() here — it creates duplicates.
          // Use the guestHash from stored session data or from create-order response.
          const guestHash = stored?.guestHash;
          if (guestHash) {
            setTimeout(() => navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${guestHash}`), 3000);
          } else {
            setTimeout(() => navigate(`/entrega-prioritaria?order_id=${orderId}`), 3000);
          }

        } else if (result.status === "FAILED" || result.status === "CANCELLED") {
          setStatus("failed");
          if (intervalRef.current) clearInterval(intervalRef.current);
          sessionStorage.removeItem('valnix_card_payment');
        } else {
          setStatus("pending");
        }
      } catch (err) {
        console.error("Card status check error:", err);
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
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Pagamento confirmado!</h1>
            <p className="text-muted-foreground text-sm">
              Redirecionando para a entrega do seu pedido...
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
              <Button onClick={() => navigate("/checkout")} variant="outline">
                Tentar novamente
              </Button>
              <Button onClick={() => navigate("/")} variant="ghost">
                Voltar à loja
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
