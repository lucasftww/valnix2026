import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage } from './_utils/helpers.js';

/**
 * Public order lookup by guest_hash (used by /order/:hash on the storefront).
 *
 * GET /api/guest-order?hash=<guest_hash>
 *   → { order: { id, status, payment_status, total_amount, ... }, items: [...] }
 *
 * Only returns paid orders. We don't expose pending orders to anyone with the
 * hash because the URL might be shared; pending state is inferred client-side
 * from the absence of "paid" rather than echoed back.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const hash = typeof req.query.hash === 'string' ? req.query.hash.trim() : '';
  if (!hash || hash.length < 8 || hash.length > 128) {
    return res.status(400).json({ error: 'Invalid hash' });
  }

  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(
        'id,customer_name,customer_email,total_amount,status,payment_status,payment_method,paid_at,created_at',
      )
      .eq('guest_hash', hash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Don't leak unpaid order info to public. Tell the client to retry/wait.
    if (order.payment_status !== 'paid') {
      return res.status(200).json({ order: { id: order.id, payment_status: order.payment_status } });
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .select('id,product_name,product_image,quantity,unit_price,total_price,delivery_code,delivered_at')
      .eq('order_id', order.id);
    if (itemsErr) throw new Error(itemsErr.message);

    // Mask the email — the hash can leak via browser history/shared URLs; we
    // confirm the customer's name and last 4 letters of the local part is
    // enough for the order page UI without exposing the full address.
    const maskedEmail = maskEmail(order.customer_email);

    return res.status(200).json({
      order: { ...order, customer_email: maskedEmail },
      items: items ?? [],
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[guest-order] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  const masked = head + '***';
  // Domain: keep TLD + first letter (e.g. "g***.com")
  const dot = domain.lastIndexOf('.');
  const domName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${masked}@${domName[0] ?? ''}***${tld}`;
}
