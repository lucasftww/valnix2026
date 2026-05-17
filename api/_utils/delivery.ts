import { supabaseAdmin } from './supabase.js';

/**
 * Auto-delivery shared logic. Imported by both `process-delivery.ts` (admin
 * endpoint) and `dice-webhook.ts` (triggered on confirmed payment).
 *
 * Atomicity: `popDeliveryCode` calls a Postgres function (`pop_delivery_code`)
 * that uses `FOR UPDATE` to serialize concurrent pops on the same product,
 * preventing the same code from being handed out twice.
 *
 * Idempotent: `runAutoDelivery` only writes to items where `delivery_code IS NULL`.
 */

export interface DeliveryResult {
  delivered: number;
  skipped: number;
  exhausted: string[]; // product ids whose pool ran out
}

/** Atomic pop of the first code from `products.auto_delivery_codes`. */
export async function popDeliveryCode(productId: string): Promise<string | null> {
  // The supabase-js types don't know about our custom RPCs — cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)('pop_delivery_code', {
    p_product_id: productId,
  });
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[delivery] pop_delivery_code rpc error:', error.message);
    }
    return null;
  }
  // RPC returns text; supabase-js may wrap it. Normalize.
  if (typeof data === 'string') return data || null;
  if (data && typeof (data as { pop_delivery_code?: unknown }).pop_delivery_code === 'string') {
    return ((data as { pop_delivery_code: string }).pop_delivery_code) || null;
  }
  return null;
}

/** Push a code back to the front of the pool (for rollback if item-update fails). */
async function pushBackCode(productId: string, code: string): Promise<void> {
  // Best-effort. If this fails, we log and accept the lost code — better than
  // double-delivering. The RPC `push_back_delivery_code` is in the same migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabaseAdmin.rpc as any)('push_back_delivery_code', {
    p_product_id: productId,
    p_code: code,
  });
  if (error && process.env.NODE_ENV !== 'production') {
    console.error('[delivery] push_back rpc error (code may be lost):', error.message, code);
  }
}

/**
 * Process auto-delivery for a paid order. Returns a summary.
 *
 * - Validates payment_status='paid' (caller should usually do this too, but we
 *   double-check to make this safe to call from anywhere).
 * - For each undelivered auto-type item, pops a code and assigns it.
 * - If no manual items remain, marks the order completed.
 * - Idempotent: re-running on an already-delivered order is a no-op.
 */
export async function runAutoDelivery(orderId: string): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, skipped: 0, exhausted: [] };

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id,payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) throw new Error(orderErr.message);
  if (!order) throw new Error('Order not found');
  if (order.payment_status !== 'paid') {
    // Don't deliver before payment. Quietly return.
    return result;
  }

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('order_items')
    .select('id,product_id,delivery_code,delivery_type')
    .eq('order_id', orderId)
    .is('delivery_code', null);
  if (itemsErr) throw new Error(itemsErr.message);

  const autoItems = (items ?? []).filter((i) => i.delivery_type === 'auto' && i.product_id);

  for (const item of autoItems) {
    const code = await popDeliveryCode(item.product_id!);
    if (!code) {
      result.exhausted.push(item.product_id!);
      result.skipped++;
      continue;
    }
    const { error: updateErr, count } = await supabaseAdmin
      .from('order_items')
      .update(
        { delivery_code: code, delivered_at: new Date().toISOString() } as never,
        { count: 'exact' },
      )
      .eq('id', item.id)
      .is('delivery_code', null);
    if (updateErr || (count ?? 0) === 0) {
      // Item was already delivered by a concurrent run OR update failed —
      // push the code back so we don't lose it.
      await pushBackCode(item.product_id!, code);
      result.skipped++;
      continue;
    }
    result.delivered++;
  }

  // Close the order if there are no items left awaiting any delivery (auto or manual).
  const { count: stillPendingCount, error: pendErr } = await supabaseAdmin
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .is('delivery_code', null);
  if (!pendErr && (stillPendingCount ?? 0) === 0) {
    await supabaseAdmin
      .from('orders')
      .update({ status: 'completed' } as never)
      .eq('id', orderId)
      .eq('payment_status', 'paid');
  }

  return result;
}
