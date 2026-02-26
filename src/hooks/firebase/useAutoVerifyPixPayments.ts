import { useEffect, useRef } from 'react';

interface Order {
  id: string;
  payment_status: string;
  status: string;
  payment_method: string | null;
  flowpay_charge_id?: string | null;
}

/**
 * Auto-verifies pending PIX payments by calling the FlowPay status endpoint.
 * The server-side fallback in the status endpoint handles:
 * - Marking order as paid
 * - Calling process-delivery (single-writer, atomic)
 * - Incrementing coupon usage (idempotent)
 * - Firing analytics events
 * NO client-side Firestore writes needed.
 */
export function useAutoVerifyPixPayments(orders: Order[], onOrderUpdated?: () => void) {
  const verifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!orders.length) return;

    const pendingPixOrders = orders.filter(
      o => o.payment_status !== 'paid' && 
           o.status !== 'cancelled' && 
           o.payment_method !== 'card' &&
           o.flowpay_charge_id &&
           !verifiedRef.current.has(o.id)
    );

    if (!pendingPixOrders.length) return;

    const verifyOrders = async () => {
      for (const order of pendingPixOrders) {
        verifiedRef.current.add(order.id);
        
        try {
          const { invokeFunction } = await import("@/lib/apiHelper");
          const response = await invokeFunction('flowpay-pix', {
            method: 'GET',
            queryParams: { action: 'status', chargeId: order.flowpay_charge_id, orderId: order.id },
          });
          const data = await response.json();

          if (data.success && data.status === 'COMPLETED') {
            if (import.meta.env.DEV) console.log(`✅ Auto-verified PIX payment for order ${order.id}`);
            onOrderUpdated?.();
          }
        } catch (error) {
          if (import.meta.env.DEV) console.warn(`⚠️ Auto-verify PIX failed for order ${order.id}:`, error);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}
