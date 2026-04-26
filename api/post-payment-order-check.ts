import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCorsHeaders } from './_utils/helpers.js';
import { isValidPostPaymentOrderId } from './_utils/postPaymentOrderId.js';

/**
 * GET /api/post-payment-order-check?order_id=...
 * Validação server-side alinhada ao cliente (placeholders / lead-* / etc.).
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = typeof req.query.order_id === 'string' ? req.query.order_id : '';
  const valid = isValidPostPaymentOrderId(raw);
  return res.status(200).json({ valid, order_id: raw.trim() || null });
}
