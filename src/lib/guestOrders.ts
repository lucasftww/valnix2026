import { supabase } from "@/integrations/supabase/client";

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
 * Saves a guest order to Supabase with a unique hash for access.
 * Returns the hash for the /order/:hash URL.
 */
export async function saveGuestOrder(params: SaveGuestOrderParams): Promise<string> {
  const hash = generateHash();

  const { error } = await supabase.from("guest_orders").insert({
    hash,
    order_id: params.orderId,
    email: params.email.toLowerCase(),
    customer_name: params.customerName || null,
    customer_phone: params.customerPhone || null,
    guest_session_id: params.guestSessionId || null,
    order_data: {
      items: params.items,
      total_amount: params.totalAmount,
      payment_method: params.paymentMethod || "pix",
      created_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("Error saving guest order:", error);
    throw error;
  }

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
  // Get the existing guest order
  const { data: existingOrder } = await supabase
    .from("guest_orders")
    .select("id, order_data")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!existingOrder) return;

  const orderData = existingOrder.order_data as any;
  orderData.items = items;

  await supabase
    .from("guest_orders")
    .update({ order_data: orderData })
    .eq("id", existingOrder.id);
}
