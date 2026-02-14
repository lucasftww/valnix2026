import { useState, useEffect } from 'react';
import { db } from '@/integrations/firebase/config';
import { 
  collection, 
  doc, 
  addDoc, 
  getDocs, 
  getDoc,
  query, 
  where, 
  orderBy, 
  onSnapshot,
  updateDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

// Generate random delivery code in format XXXX-XXXX-XXXX-XXXX
export const generateFakeDeliveryCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
    if ((i + 1) % 4 === 0 && i < 15) {
      result += '-';
    }
  }
  return result;
};

// Interface for product delivery info
interface ProductDeliveryInfo {
  delivery_type?: string;
  auto_delivery_codes?: string[] | null;
}

export interface Order {
  id: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_amount: number;
  status: string;
  payment_status: string;
  payment_method: string | null;
  shipping_address: string | null;
  shipping_method: string | null;
  tracking_code: string | null;
  notes: string | null;
  flowpay_charge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_code: string | null;
}

export interface CreateOrderData {
  user_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  total_amount: number;
  notes?: string | null;
  status?: string;
  payment_status?: string;
  payment_method?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export interface CreateOrderItemData {
  order_id: string;
  product_id: string;
  product_name: string;
  product_image?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  // Optional: pass product delivery info for auto-delivery processing
  delivery_type?: string;
  auto_delivery_codes?: string[] | null;
}

// Hook para buscar pedidos do usuário
export function useUserOrders(userId: string | undefined) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    

    const ordersRef = collection(db, 'orders');
    // Query without orderBy to avoid index requirement, sort client-side
    const q = query(ordersRef, where('user_id', '==', userId));

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        
        const ordersData = snapshot.docs.map(doc => {
          const data = doc.data();
          // Handle Timestamp or string for created_at
          let createdAt: string;
          if (data.created_at?.toDate) {
            createdAt = data.created_at.toDate().toISOString();
          } else if (typeof data.created_at === 'string') {
            createdAt = data.created_at;
          } else {
            createdAt = new Date().toISOString();
          }
          
          let updatedAt: string;
          if (data.updated_at?.toDate) {
            updatedAt = data.updated_at.toDate().toISOString();
          } else if (typeof data.updated_at === 'string') {
            updatedAt = data.updated_at;
          } else {
            updatedAt = new Date().toISOString();
          }
          
          return {
            id: doc.id,
            ...data,
            created_at: createdAt,
            updated_at: updatedAt,
          } as Order;
        });
        
        // Sort by created_at descending (client-side)
        ordersData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        setOrders(ordersData);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching orders:', err);
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { orders, loading, error };
}

// Hook para buscar pedidos recentes (últimos 5)
export function useRecentOrders(userId: string | undefined) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const fetchRecentOrders = async () => {
      try {
        const ordersRef = collection(db, 'orders');
        const q = query(
          ordersRef,
          where('user_id', '==', userId),
          orderBy('created_at', 'desc')
        );
        
        const snapshot = await getDocs(q);
        const ordersData = snapshot.docs.slice(0, 5).map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            created_at: data.created_at?.toDate?.()?.toISOString() || new Date().toISOString(),
            updated_at: data.updated_at?.toDate?.()?.toISOString() || new Date().toISOString(),
          } as Order;
        });
        
        setOrders(ordersData);
      } catch (err) {
        console.error('Error fetching recent orders:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentOrders();
  }, [userId]);

  return { orders, loading };
}

// Hook para buscar itens de um pedido (realtime)
export function useOrderItems(orderId: string | undefined) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setItems([]);
      return;
    }

    setLoading(true);
    const itemsRef = collection(db, 'order_items');
    const q = query(itemsRef, where('order_id', '==', orderId));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const itemsData = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as OrderItem));
        setItems(itemsData);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching order items:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orderId]);

  return { items, loading };
}

// Função para criar um novo pedido
export async function createOrder(orderData: CreateOrderData): Promise<string> {
  const ordersRef = collection(db, 'orders');
  
  const docRef = await addDoc(ordersRef, {
    ...orderData,
    status: orderData.status || 'pending',
    payment_status: orderData.payment_status || 'pending',
    payment_method: orderData.payment_method || null,
    fbc: orderData.fbc || null,
    fbp: orderData.fbp || null,
    utm_source: orderData.utm_source || null,
    utm_medium: orderData.utm_medium || null,
    utm_campaign: orderData.utm_campaign || null,
    utm_content: orderData.utm_content || null,
    utm_term: orderData.utm_term || null,
    shipping_address: null,
    shipping_method: null,
    tracking_code: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  
  return docRef.id;
}

// Função para criar itens do pedido
// If processAutoDelivery is true, will generate codes for auto_fake products
export async function createOrderItems(items: CreateOrderItemData[], processAutoDelivery: boolean = false): Promise<void> {
  const itemsRef = collection(db, 'order_items');
  
  for (const item of items) {
    let deliveryCode: string | null = null;
    
    // Process auto-delivery if enabled and we have delivery info
    if (processAutoDelivery && item.delivery_type) {
      if (item.delivery_type === 'auto_fake') {
        // Generate fake codes for each quantity
        const codes: string[] = [];
        for (let i = 0; i < item.quantity; i++) {
          codes.push(generateFakeDeliveryCode());
        }
        deliveryCode = codes.join(',');
        console.log(`Auto-generated ${codes.length} fake code(s) for ${item.product_name}`);
      } else if (item.delivery_type === 'auto_real' && item.auto_delivery_codes && item.auto_delivery_codes.length > 0) {
        // Use pre-configured codes
        const neededCodes = Math.min(item.quantity, item.auto_delivery_codes.length);
        const codes = item.auto_delivery_codes.slice(0, neededCodes);
        deliveryCode = codes.join(',');
        console.log(`Assigned ${codes.length} real code(s) for ${item.product_name}`);
        
        // Remove used codes from the product to prevent double-consumption
        try {
          const remaining = item.auto_delivery_codes.slice(neededCodes);
          const productDocRef = doc(db, 'products', item.product_id);
          await updateDoc(productDocRef, { auto_delivery_codes: remaining });
          console.log(`✅ Removed ${neededCodes} used code(s) from product ${item.product_id}, ${remaining.length} remaining`);
        } catch (err) {
          console.warn(`⚠️ Failed to remove used codes from product ${item.product_id}:`, err);
        }
      }
    }
    
    await addDoc(itemsRef, {
      order_id: item.order_id,
      product_id: item.product_id,
      product_name: item.product_name,
      product_image: item.product_image || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      delivery_code: deliveryCode,
      created_at: serverTimestamp(),
    });
  }
}

// Função para atualizar status do pedido
export async function updateOrderStatus(
  orderId: string, 
  status: string, 
  paymentStatus?: string
): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  
  const updates: any = {
    status,
    updated_at: serverTimestamp(),
  };
  
  if (paymentStatus) {
    updates.payment_status = paymentStatus;
  }
  
  await updateDoc(orderRef, updates);
}

// Hook para buscar todos os pedidos (admin)
export function useAllOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, orderBy('created_at', 'desc'));

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const ordersData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            created_at: data.created_at?.toDate?.()?.toISOString() || new Date().toISOString(),
            updated_at: data.updated_at?.toDate?.()?.toISOString() || new Date().toISOString(),
          } as Order;
        });
        setOrders(ordersData);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching all orders:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { orders, loading };
}
