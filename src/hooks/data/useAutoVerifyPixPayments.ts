import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface Order {
  id: string;
  payment_status: string;
  status: string;
  payment_method: string | null;
  flowpay_charge_id?: string | null;
  created_at?: string;
}

/**
 * Auto-verifies pending PIX orders in the admin Orders view as a UX accelerant
 * for the webhook (authoritative source of truth). Skips orders older than 30
 * minutes (PIX expired anyway) and only runs while the tab is foregrounded —
 * an admin leaving the tab open all day shouldn't burn Vercel invocations.
 */
const MAX_AGE_MS = 30 * 60 * 1000; // 30 min — PIX charges expire here

export function useAutoVerifyPixPayments(orders: Order[], onOrderUpdated?: () => void) {
  const inFlightRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  // Per-order last-check timestamp — debounces re-checks across renders.
  const lastCheckedRef = useRef<Map<string, number>>(new Map());
  const queryClient = useQueryClient();
  const onOrderUpdatedRef = useRef(onOrderUpdated);
  onOrderUpdatedRef.current = onOrderUpdated;

  useEffect(() => {
    if (!orders.length) return;
    // Don't poll while the tab is hidden — admin probably alt-tabbed away.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const now = Date.now();
    const pendingPixOrders = orders.filter((o) => {
      if (o.payment_status === "paid" || o.status === "cancelled") return false;
      if (!o.flowpay_charge_id) return false;
      if (completedRef.current.has(o.id) || inFlightRef.current.has(o.id)) return false;
      // Skip orders past PIX expiry — gateway will never confirm them now.
      if (o.created_at) {
        const ageMs = now - new Date(o.created_at).getTime();
        if (Number.isFinite(ageMs) && ageMs > MAX_AGE_MS) return false;
      }
      // 30s debounce per order — don't re-poll the same one on every render.
      const last = lastCheckedRef.current.get(o.id) ?? 0;
      if (now - last < 30_000) return false;
      return true;
    });

    if (!pendingPixOrders.length) return;

    const verifyOrders = async () => {
      for (const order of pendingPixOrders) {
        inFlightRef.current.add(order.id);
        lastCheckedRef.current.set(order.id, Date.now());

        try {
          const { invokeFunction } = await import("@/lib/apiHelper");
          const response = await invokeFunction("dice-pix", {
            method: "GET",
            queryParams: { action: "status", chargeId: order.flowpay_charge_id! },
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
                // No need to call process-delivery here — admin-data's
                // verify-payment now triggers it server-side via internal HMAC.
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
