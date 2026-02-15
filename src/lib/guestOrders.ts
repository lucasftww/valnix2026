import { db } from "@/integrations/firebase/config";
import { collection, addDoc, getDocs, updateDoc, query, where, serverTimestamp, Timestamp } from "firebase/firestore";

/**
 * Generates a short unique hash for guest order access links.
 */
function generateHash(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export interface SaveGuestOrderParams {
  orderId: string;
  email: string;
  customerName?: string;
  customerPhone?: string;
  guestSessionId?: string | null;
  items: Array<{
    product_name: string;
    product_image: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
    delivery_code: string | null;
  }>;
  totalAmount: number;
  paymentMethod?: string;
}

/**
 * Saves a guest order to Firestore with a unique hash for access.
 * Returns the hash for the /order/:hash URL.
 */
export async function saveGuestOrder(params: SaveGuestOrderParams): Promise<string> {
  const guestOrdersRef = collection(db, "guest_orders");

  // Check if a guest order already exists for this order_id
  const existingQuery = query(guestOrdersRef, where("order_id", "==", params.orderId));
  const existingSnapshot = await getDocs(existingQuery);

  if (!existingSnapshot.empty) {
    const existingDoc = existingSnapshot.docs[0];
    console.log(`ℹ️ Guest order already exists for ${params.orderId}, returning existing hash`);
    // Update the order_data with latest info
    await updateDoc(existingDoc.ref, {
      order_data: {
        items: params.items,
        total_amount: params.totalAmount,
        payment_method: params.paymentMethod || "pix",
        created_at: new Date().toISOString(),
      },
    });
    return existingDoc.data().hash;
  }

  const hash = generateHash();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await addDoc(guestOrdersRef, {
    hash,
    order_id: params.orderId,
    email: params.email.toLowerCase(),
    customer_name: params.customerName || null,
    customer_phone: params.customerPhone || null,
    guest_session_id: params.guestSessionId || null,
    user_id: null,
    linked: false,
    order_data: {
      items: params.items,
      total_amount: params.totalAmount,
      payment_method: params.paymentMethod || "pix",
      created_at: new Date().toISOString(),
    },
    created_at: serverTimestamp(),
    expires_at: Timestamp.fromDate(expiresAt),
  });

  console.log(`✅ Guest order saved with hash: ${hash}`);
  return hash;
}

/**
 * Updates the delivery codes in an existing guest order.
 */
export async function updateGuestOrderDelivery(
  orderId: string,
  items: Array<{
    product_name: string;
    product_image: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
    delivery_code: string | null;
  }>
): Promise<void> {
  const guestOrdersRef = collection(db, "guest_orders");
  const q = query(guestOrdersRef, where("order_id", "==", orderId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  const existingDoc = snapshot.docs[0];
  const orderData = existingDoc.data().order_data as any;
  orderData.items = items;

  await updateDoc(existingDoc.ref, { order_data: orderData });
}
