import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
  const inFlightRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const onOrderUpdatedRef = useRef(onOrderUpdated);
  onOrderUpdatedRef.current = onOrderUpdated;

  useEffect(() => {
    if (!orders.length) return;

    const pendingPixOrders = orders.filter(
      o => o.payment_status !== 'paid' && 
           o.status !== 'cancelled' && 
           o.payment_method !== 'card' &&
           o.flowpay_charge_id &&
           !completedRef.current.has(o.id) &&
           !inFlightRef.current.has(o.id)
    );

    if (!pendingPixOrders.length) return;

    const verifyOrders = async () => {
      for (const order of pendingPixOrders) {
        inFlightRef.current.add(order.id);
        
        try {
          const { invokeFunction } = await import("@/lib/apiHelper");
          const response = await invokeFunction('invictuspay-pix', {
            method: 'GET',
            queryParams: { action: 'status', chargeId: order.flowpay_charge_id, orderId: order.id },
          });
          const data = await response.json();

          if (data.success && data.status === "COMPLETED") {
            try {
              const { requireAdminToken } = await import("@/lib/adminAuth");
              const token = requireAdminToken();
              if (token) {
                await invokeFunction("admin-data", {
                  method: "PUT",
                  queryParams: { resource: "verify-payment" },
                  headers: { "x-admin-token": token },
                  body: { id: order.id, payment_status: "paid", status: "processing" },
                });
                await invokeFunction("process-delivery", {
                  method: "POST",
                  body: { orderId: order.id },
                  headers: { "x-admin-token": token },
                }).catch(() => {});

                if (import.meta.env.DEV) console.log(`✅ Auto-verified PIX payment for order ${order.id}`);
                completedRef.current.add(order.id);
                queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
                onOrderUpdatedRef.current?.();
              }
            } catch (err) {
              if (import.meta.env.DEV) console.warn("⚠️ Failed to explicitly set order to paid", err);
            }
          }
        } catch (error) {
          if (import.meta.env.DEV) console.warn(`⚠️ Auto-verify PIX failed for order ${order.id}:`, error);
        } finally {
          inFlightRef.current.delete(order.id);
        }
      }
    };

    verifyOrders();
  }, [orders, queryClient]);
}
