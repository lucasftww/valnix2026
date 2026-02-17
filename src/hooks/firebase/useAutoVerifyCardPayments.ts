import { useEffect, useRef } from 'react';
import type { Order } from './useFirebaseOrders';

/**
 * Auto-verifies pending Card payments by calling the server-side confirm endpoint.
 * The confirm endpoint handles everything:
 * - Payment verification with FlowPay API
 * - Marking order as paid
 * - Calling process-delivery (single-writer, atomic)
 * - Incrementing coupon usage (idempotent)
 * - Firing analytics events
 * NO client-side Firestore writes needed.
 */
export function useAutoVerifyCardPayments(orders: Order[], onOrderUpdated?: () => void) {
  const verifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!orders.length) return;

    const pendingCardOrders = orders.filter(
      o => o.payment_status !== 'paid' &&
           o.status !== 'cancelled' &&
           o.payment_method === 'card' &&
           o.flowpay_charge_id &&
           !verifiedRef.current.has(o.id)
    );

    if (!pendingCardOrders.length) return;

    const verifyOrders = async () => {
      for (const order of pendingCardOrders) {
        verifiedRef.current.add(order.id);

        try {
          const { invokeFunction } = await import("@/lib/apiHelper");
          const { requireAdminToken } = await import("@/lib/adminAuth");
          let token: string;
          try { token = requireAdminToken(); } catch { 
            console.warn(`⚠️ No admin token for card verify ${order.id}`);
            continue;
          }

          const response = await invokeFunction('flowpay-card', {
            method: 'POST',
            queryParams: { action: 'confirm' },
            headers: { 'x-admin-token': token },
            body: { orderId: order.id, paymentId: order.flowpay_charge_id },
          });
          const data = await response.json();

          if (data.success) {
            if (import.meta.env.DEV) console.log(`✅ Auto-verified card payment for order ${order.id}`);
            onOrderUpdated?.();
          } else {
            if (import.meta.env.DEV) console.log(`ℹ️ Card order ${order.id}: ${data.error || data.status || 'not confirmed yet'}`);
          }
        } catch (error) {
          console.warn(`⚠️ Auto-verify card failed for order ${order.id}:`, error);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}
