import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  setCorsHeaders,
  verifyAdminToken,
  verifyInternalSignature,
  errorMessage,
  isUuid,
} from './_utils/helpers.js';
import { runAutoDelivery } from './_utils/delivery.js';

/**
 * Auto-delivery: pop one code from products.auto_delivery_codes per matching
 * order_item with delivery_type='auto', set it on the line item.
 *
 * POST /api/process-delivery
 *   body: { orderId }
 *   → { success, delivered: number, skipped: number, exhausted: string[] }
 *
 * Idempotent — already-delivered items are skipped. Concurrency-safe via the
 * `pop_delivery_code` Postgres function (FOR UPDATE row lock).
 *
 * Auth: admin token OR internal signature (set by webhook → so the webhook
 * doesn't need an admin token to trigger delivery on payment confirmation).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const internalSig = (req.headers['x-internal-signature'] as string) || '';
  const adminTok = (req.headers['x-admin-token'] as string) || '';

  const authorized =
    verifyAdminToken(adminTok) || verifyInternalSignature(internalSig, rawBody);
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body ?? {}) as { orderId?: unknown };
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!isUuid(orderId)) return res.status(400).json({ error: 'valid orderId required' });

  try {
    const result = await runAutoDelivery(orderId);
    return res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[process-delivery] error:', message);
    if (message === 'Order not found') return res.status(404).json({ error: 'Order not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
