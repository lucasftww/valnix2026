import { useEffect, useRef } from 'react';
import { db } from '@/integrations/firebase/config';
import { doc, updateDoc, getDoc, collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { trackPurchase } from '@/lib/utmify';
import { supabase } from '@/lib/supabaseHelper';
import type { Order } from './useFirebaseOrders';

/**
 * Auto-verifies pending PIX payments by checking FlowPay status API.
 * Runs once when orders load, checking any order with payment_status !== 'paid'
 * and a flowpay_charge_id present.
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
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${order.flowpay_charge_id}`,
            {
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
            }
          );
          const data = await response.json();

          if (data.success && data.status === 'COMPLETED') {
            console.log(`✅ Auto-verified payment for order ${order.id}`);
            await confirmPayment(order);
            onOrderUpdated?.();
          }
        } catch (error) {
          console.warn(`⚠️ Auto-verify failed for order ${order.id}:`, error);
        }
      }
    };

    verifyOrders();
  }, [orders]);
}

async function confirmPayment(order: Order) {
  // 1. Update order status
  const orderRef = doc(db, "orders", order.id);
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
    console.warn('⚠️ Auto-delivery processing failed:', error);
  }

  // 3. Track Purchase
  try {
    await trackPurchase(order.id, order.total_amount, order.customer_email);
  } catch (error) {
    console.warn('⚠️ UTMify tracking failed:', error);
  }

  // 4. Analytics
  try {
    await supabase.from('analytics_events').insert({
      event_name: 'Purchase',
      event_time: new Date().toISOString(),
      user_id: order.user_id || null,
      value: order.total_amount,
      currency: 'BRL',
      order_id: order.id,
      page_url: window.location.href,
      content_name: `Pedido #${order.id.substring(0, 8)}`,
    });
  } catch (error) {
    console.warn('⚠️ Analytics event failed:', error);
  }
}
