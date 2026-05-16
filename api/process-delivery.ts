import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, verifyAdminToken, errorMessage } from './_utils/helpers.js';

/**
 * Auto-delivery: pop one code from products.auto_delivery_codes per matching
 * order_item with delivery_type='auto', set it on the line item.
 *
 * POST /api/process-delivery
 *   body: { orderId }
 *   → { success, delivered: number }
 *
 * Idempotent — already-delivered items are skipped.
 *
 * Auth: admin token required (the auto-verify hooks pass it after a payment
 * confirmation).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-admin-token'];
  if (!verifyAdminToken(typeof token === 'string' ? token : '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = (req.body ?? {}) as { orderId?: unknown };
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  try {
    // Confirm order is paid before delivering anything.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id,payment_status,status')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr) throw new Error(orderErr.message);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status !== 'paid') {
      return res.status(409).json({ error: 'Order is not paid yet' });
    }

    // Fetch undelivered auto-delivery line items.
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .select('id,product_id,quantity,delivery_code,delivery_type')
      .eq('order_id', orderId)
      .is('delivery_code', null);
    if (itemsErr) throw new Error(itemsErr.message);

    const autoItems = (items ?? []).filter((i) => i.delivery_type === 'auto' && i.product_id);
    if (autoItems.length === 0) {
      return res.status(200).json({ success: true, delivered: 0 });
    }

    let delivered = 0;
    for (const item of autoItems) {
      // Pop one code from the product's pool. Done in two steps because
      // Postgres doesn't expose a clean atomic "pop first array element"
      // without an SQL function — risk window is tiny and this endpoint is
      // admin-only / single-writer per order.
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('id,auto_delivery_codes')
        .eq('id', item.product_id!)
        .maybeSingle();
      const pool = (product?.auto_delivery_codes ?? []) as string[];
      if (pool.length === 0) continue;
      const code = pool[0];
      const remaining = pool.slice(1);

      const { error: updateProductErr } = await supabaseAdmin
        .from('products')
        .update({ auto_delivery_codes: remaining } as never)
        .eq('id', item.product_id!);
      if (updateProductErr) continue;

      const { error: updateItemErr } = await supabaseAdmin
        .from('order_items')
        .update({ delivery_code: code, delivered_at: new Date().toISOString() } as never)
        .eq('id', item.id)
        .is('delivery_code', null);
      if (!updateItemErr) delivered++;
    }

    // If everything was delivered (no manual items left), close the order.
    const { data: stillPending } = await supabaseAdmin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .is('delivery_code', null);
    if (!stillPending) {
      await supabaseAdmin
        .from('orders')
        .update({ status: 'completed' } as never)
        .eq('id', orderId)
        .eq('payment_status', 'paid');
    }

    return res.status(200).json({ success: true, delivered });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[process-delivery] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
