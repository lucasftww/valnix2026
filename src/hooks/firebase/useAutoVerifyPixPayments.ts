import { useEffect, useRef } from 'react';
import { db, auth } from '@/integrations/firebase/config';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import type { Order } from './useFirebaseOrders';

/**
 * Auto-verifies pending PIX payments by checking FlowPay status API.
 * If payment is confirmed, marks order as paid and calls process-delivery server-side.
 * NO client-side delivery code consumption — single-writer pattern.
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
            console.log(`✅ Auto-verified PIX payment for order ${order.id}`);
            
            // Mark as paid (idempotent check)
            const orderRef = doc(db, "orders", order.id);
            const orderSnap = await getDoc(orderRef);
            if (orderSnap.exists() && orderSnap.data()?.payment_status !== 'paid') {
              await updateDoc(orderRef, {
                payment_status: 'paid',
                status: 'processing',
                updated_at: Timestamp.now(),
              });
            }

            // 🔒 Call server-side process-delivery (single-writer, atomic, idempotent)
            try {
              const currentUser = auth.currentUser;
              const idToken = currentUser ? await currentUser.getIdToken() : null;
              
              const deliveryRes = await invokeFunction('process-delivery', {
                method: 'POST',
                headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {},
                body: { orderId: order.id },
              });
              const deliveryResult = await deliveryRes.json();
              console.log(`📦 Admin auto-verify PIX delivery for ${order.id}:`, deliveryResult);
            } catch (deliveryErr) {
              console.warn(`⚠️ process-delivery failed for ${order.id}:`, deliveryErr);
            }

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
