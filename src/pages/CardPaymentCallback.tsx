import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateOrderStatus } from "@/hooks/firebase";
import { trackPurchaseEvent } from "@/lib/analytics";
import { saveGuestOrder } from "@/lib/guestOrders";
import { doc, getDoc, updateDoc, increment, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { supabase } from "@/lib/supabaseHelper";

type PaymentStatus = "checking" | "paid" | "pending" | "failed";

export default function CardPaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaymentStatus>("checking");
  const [pollCount, setPollCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get payment info from URL params or sessionStorage
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
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-card?action=status&id=${paymentId}`,
          { headers: { "Content-Type": "application/json" } }
        );
        const result = await res.json();

        if (result.success && result.status === "COMPLETED") {
          setStatus("paid");
          if (intervalRef.current) clearInterval(intervalRef.current);
          sessionStorage.removeItem('valnix_card_payment');

          // Mark order as paid (only if not already paid by webhook)
          try {
            const orderDoc2 = await getDoc(doc(db, "orders", orderId));
            if (orderDoc2.exists() && orderDoc2.data()?.payment_status !== 'paid') {
              await updateOrderStatus(orderId, "processing", "paid");
              console.log(`✅ Card order ${orderId} marked as paid (client-side)`);
            } else {
              console.log(`ℹ️ Card order ${orderId} already paid (webhook handled it)`);
            }
          } catch (err) { console.warn('⚠️ Order status update error (card):', err); }

          // Auto-delivery for card payments (no webhook exists for card, so we handle it client-side)
          // Idempotent: skips items that already have delivery_code
          try {
            const itemsSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", orderId)));
            let allDelivered = true;

            for (const itemDoc of itemsSnap.docs) {
              const itemData = itemDoc.data();
              if (itemData.delivery_code) continue; // Already delivered

              const productId = itemData.product_id;
              if (!productId) { allDelivered = false; continue; }

              const productSnap = await getDoc(doc(db, "products", productId));
              if (!productSnap.exists()) { allDelivered = false; continue; }

              const product = productSnap.data();
              const deliveryType = product.delivery_type || 'manual';
              const qty = itemData.quantity || 1;

              if (deliveryType === 'auto_fake') {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                const codes: string[] = [];
                for (let q = 0; q < qty; q++) {
                  let code = '';
                  for (let i = 0; i < 16; i++) {
                    code += chars.charAt(Math.floor(Math.random() * chars.length));
                    if ((i + 1) % 4 === 0 && i < 15) code += '-';
                  }
                  codes.push(code);
                }
                await updateDoc(itemDoc.ref, { delivery_code: codes.join(',') });
                console.log(`✅ Auto-generated ${codes.length} fake code(s) for card item ${itemDoc.id}`);
              } else if (deliveryType === 'auto_real') {
                const autoCodes = product.auto_delivery_codes || [];
                if (autoCodes.length > 0) {
                  const needed = Math.min(qty, autoCodes.length);
                  const usedCodes = autoCodes.slice(0, needed);
                  const remaining = autoCodes.slice(needed);
                  await updateDoc(itemDoc.ref, { delivery_code: usedCodes.join(',') });
                  await updateDoc(doc(db, "products", productId), { auto_delivery_codes: remaining });
                  console.log(`✅ Assigned ${usedCodes.length} real code(s) for card item ${itemDoc.id}`);
                } else {
                  allDelivered = false;
                  console.warn(`⚠️ No auto_delivery_codes for product ${productId}`);
                }
              } else {
                allDelivered = false; // manual delivery
              }
            }

            if (allDelivered && itemsSnap.size > 0) {
              await updateDoc(doc(db, "orders", orderId), { status: 'completed', updated_at: new Date().toISOString() });
              console.log(`✅ Card order ${orderId} auto-completed`);
            }
          } catch (deliveryErr) {
            console.warn('⚠️ Card auto-delivery error:', deliveryErr);
          }

          // Track purchase
          const orderDoc = await getDoc(doc(db, "orders", orderId));
          if (orderDoc.exists()) {
            const od = orderDoc.data();
            trackPurchaseEvent(od.user_id || "guest", od.total_amount, orderId, "card");

            // Increment coupon usage (client-side for card — no card webhook exists)
            if (stored?.couponId) {
              try {
                await updateDoc(doc(db, "coupons", stored.couponId), { current_uses: increment(1) });
                console.log(`✅ Coupon ${stored.couponId} usage incremented (card client-side)`);
              } catch (err) {
                console.warn('⚠️ Failed to increment coupon usage:', err);
              }
            }

            // Send Meta CAPI Purchase event
            try {
              const nameParts = (stored?.customerName || od.customer_name || '').split(' ');
              supabase.functions.invoke('meta-capi', {
                body: {
                  event_name: 'Purchase',
                  event_id: `purchase_${orderId}_${Date.now()}`,
                  order_id: orderId,
                  value: od.total_amount,
                  currency: 'BRL',
                  content_name: stored?.productNames?.join(', ') || 'card purchase',
                  email: stored?.customerEmail || od.customer_email,
                  phone: stored?.customerPhone || od.customer_phone || undefined,
                  first_name: nameParts[0] || undefined,
                  last_name: nameParts.slice(1).join(' ') || undefined,
                  external_id: stored?.userId || od.user_id || 'guest',
                },
              }).then(({ error }: any) => {
                if (error) console.warn('⚠️ Meta CAPI card Purchase failed:', error);
                else console.log('📡 Meta CAPI Purchase sent (card payment)');
              });
            } catch (e) { console.warn('⚠️ Meta CAPI card error:', e); }

            // Send UTMify Purchase event
            try {
              const utmParams = JSON.parse(sessionStorage.getItem('valnix_utm_params') || '{}');
              supabase.functions.invoke('utmify-event', {
                body: {
                  order_id: orderId,
                  event_type: 'Purchase',
                  value: od.total_amount,
                  customer_name: stored?.customerName || od.customer_name,
                  customer_email: stored?.customerEmail || od.customer_email,
                  customer_phone: stored?.customerPhone || od.customer_phone || undefined,
                  product_name: stored?.productNames?.join(', ') || 'card purchase',
                  utm_source: utmParams.utm_source || undefined,
                  utm_medium: utmParams.utm_medium || undefined,
                  utm_campaign: utmParams.utm_campaign || undefined,
                  utm_content: utmParams.utm_content || undefined,
                  utm_term: utmParams.utm_term || undefined,
                },
              }).then(({ error }: any) => {
                if (error) console.warn('⚠️ UTMify card Purchase failed:', error);
                else console.log('📡 UTMify Purchase sent (card payment)');
              });
            } catch (e) { console.warn('⚠️ UTMify card error:', e); }

            // Save guest order for /order/:hash
            try {
              const itemsSnap = await getDocs(query(collection(db, "order_items"), where("order_id", "==", orderId)));
              const items = itemsSnap.docs.map(d => {
                const data = d.data();
                return {
                  product_name: data.product_name,
                  product_image: data.product_image || null,
                  quantity: data.quantity,
                  unit_price: data.unit_price,
                  total_price: data.total_price,
                  delivery_code: data.delivery_code || null,
                };
              });

              const hash = await saveGuestOrder({
                orderId,
                email: od.customer_email || "",
                customerName: od.customer_name || "",
                customerPhone: od.customer_phone || undefined,
                items,
                totalAmount: od.total_amount,
                paymentMethod: "card",
              });

              if (hash) {
                setTimeout(() => navigate(`/painel-pagar-entrega?order_id=${orderId}&hash=${hash}`), 3000);
                return;
              }
            } catch (err) { console.warn('⚠️ Guest order save error (card):', err); }
          }

          setTimeout(() => navigate(`/painel-pagar-entrega?order_id=${orderId}`), 3000);

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

    // Check immediately
    checkStatus();

    // Poll every 5s for up to 2 min
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
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Link inválido</h1>
          <p className="text-[#888] text-sm mb-6">Não foi possível encontrar informações do pagamento.</p>
          <Button onClick={() => navigate("/")} variant="outline" className="border-[#333]">
            Voltar à loja
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#111] border border-[#1f1f1f] rounded-xl p-8 text-center">
        {status === "checking" || status === "pending" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Verificando pagamento...</h1>
            <p className="text-[#888] text-sm">
              Aguarde enquanto confirmamos seu pagamento com cartão.
            </p>
            {status === "pending" && pollCount > 2 && (
              <p className="text-[#666] text-xs mt-4">
                Se você já pagou, aguarde alguns instantes...
              </p>
            )}
          </>
        ) : status === "paid" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Pagamento confirmado!</h1>
            <p className="text-[#888] text-sm">
              Redirecionando para a entrega do seu pedido...
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Pagamento não confirmado</h1>
            <p className="text-[#888] text-sm mb-6">
              O pagamento com cartão não foi concluído ou foi recusado.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate("/checkout")} variant="outline" className="border-[#333]">
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
