import { useEffect, useRef } from 'react';
import { db } from '@/integrations/firebase/config';
import { doc, updateDoc, getDoc, collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import type { Order } from './useFirebaseOrders';

/**
 * Auto-verifies pending Card payments by checking FlowPay card status API.
 * Runs once when orders load, checking any card order with payment_status !== 'paid'
 * and a flowpay_charge_id present.
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
          const response = await invokeFunction('flowpay-card', {
            method: 'GET',
            queryParams: { action: 'status', id: order.flowpay_charge_id },
          });
          const data = await response.json();

          if (data.success && data.status === 'COMPLETED') {
            console.log(`✅ Auto-verified card payment for order ${order.id}`);
            await confirmCardPayment(order);
            onOrderUpdated?.();
          }
        } catch (error) {
          console.warn(`⚠️ Auto-verify card failed for order ${order.id}:`, error);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}

async function confirmCardPayment(order: Order) {
  const orderRef = doc(db, "orders", order.id);

  // Check if already paid (idempotency)
  const orderSnap = await getDoc(orderRef);
  if (orderSnap.exists() && orderSnap.data()?.payment_status === 'paid') return;

  // 1. Update order status
  await updateDoc(orderRef, {
    payment_status: 'paid',
    status: 'processing',
    updated_at: Timestamp.now(),
  });

  // 2. Process auto-delivery
  try {
    const itemsRef = collection(db, "order_items");
    const q = query(itemsRef, where('order_id', '==', order.id));
    const itemsSnapshot = await getDocs(q);

    let allDelivered = true;

    for (const itemDoc of itemsSnapshot.docs) {
      const itemData = itemDoc.data();
      if (itemData.delivery_code) continue;

      const productId = itemData.product_id;
      if (!productId) { allDelivered = false; continue; }

      const productRef = doc(db, "products", productId);
      const productSnap = await getDoc(productRef);
      if (!productSnap.exists()) { allDelivered = false; continue; }

      const productData = productSnap.data();
      const deliveryType = productData.delivery_type || 'manual';
      const qty = itemData.quantity || 1;

      if (deliveryType === 'auto_fake') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const codes: string[] = [];
        for (let i = 0; i < qty; i++) {
          let code = '';
          for (let j = 0; j < 16; j++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
            if ((j + 1) % 4 === 0 && j < 15) code += '-';
          }
          codes.push(code);
        }
        await updateDoc(doc(db, "order_items", itemDoc.id), { delivery_code: codes.join(',') });
      } else if (deliveryType === 'auto_real' && productData.auto_delivery_codes?.length > 0) {
        const needed = Math.min(qty, productData.auto_delivery_codes.length);
        const codes = productData.auto_delivery_codes.slice(0, needed);
        await updateDoc(doc(db, "order_items", itemDoc.id), { delivery_code: codes.join(',') });
        const remaining = productData.auto_delivery_codes.slice(needed);
        await updateDoc(productRef, { auto_delivery_codes: remaining });
      } else {
        allDelivered = false;
      }
    }

    if (allDelivered && itemsSnapshot.size > 0) {
      await updateDoc(orderRef, { status: 'completed', updated_at: Timestamp.now() });
    }
  } catch (error) {
    console.warn('⚠️ Card auto-delivery processing failed:', error);
  }
}
