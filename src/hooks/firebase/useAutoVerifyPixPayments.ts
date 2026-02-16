import { useEffect, useRef } from 'react';
import type { Order } from './useFirebaseOrders';

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
            queryParams: { action: 'status', chargeId: order.flowpay_charge_id },
          });
          const data = await response.json();

          if (data.success && data.status === 'COMPLETED') {
            console.log(`✅ Auto-verified PIX payment for order ${order.id} (server-side)`);
            onOrderUpdated?.();
          }
        } catch (error) {
          console.warn(`⚠️ Auto-verify PIX failed for order ${order.id}:`, error);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}
