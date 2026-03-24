import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface Order {
  id: string;
  payment_status: string;
  status: string;
  payment_method: string | null;
  flowpay_charge_id?: string | null;
}

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
  const inFlightRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orders.length) return;

    const pendingCardOrders = orders.filter(
      o => o.payment_status !== 'paid' &&
           o.status !== 'cancelled' &&
           o.payment_method === 'card' &&
           o.flowpay_charge_id &&
           !completedRef.current.has(o.id) &&
           !inFlightRef.current.has(o.id)
    );

    if (!pendingCardOrders.length) return;

    const verifyOrders = async () => {
      for (const order of pendingCardOrders) {
        inFlightRef.current.add(order.id);

        try {
          const { invokeFunction } = await import("@/lib/apiHelper");

          // Use upsell-status (no auth required) to check card payment status
          // Do NOT send x-admin-token here — a 401 from this endpoint would
          // trigger the global interceptor and log the admin out.
          const response = await invokeFunction('flowpay-card', {
            method: 'GET',
            queryParams: { action: 'upsell-status', id: order.flowpay_charge_id! },
          });
          const data = await response.json();

          if (data.success && data.status === 'COMPLETED') {
            completedRef.current.add(order.id);
            if (import.meta.env.DEV) console.log(`✅ Auto-verified card payment for order ${order.id}`);
            queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
            onOrderUpdated?.();
          } else {
            if (import.meta.env.DEV) console.log(`ℹ️ Card order ${order.id}: ${data.status || 'not confirmed yet'}`);
          }
        } catch (error) {
          if (import.meta.env.DEV) console.warn(`⚠️ Auto-verify card failed for order ${order.id}:`, error);
        } finally {
          inFlightRef.current.delete(order.id);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}
