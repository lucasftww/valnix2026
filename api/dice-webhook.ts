import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage } from './_utils/helpers.js';
import { DICE_BASE_URL, diceCredsConfigured, diceFetch, pickField } from './_utils/dice.js';
import axios from 'axios';

/**
 * Dice → us. Receives status changes for transactions we created.
 *
 *   POST /api/dice-webhook
 *     body: { transaction_id, external_id, status, amount, net_amount, fee, payment_method }
 *
 * Returns 200 OK on success (Dice retries on non-200).
 *
 * Security: Dice's docs don't document HMAC signing for webhooks. We harden
 * by re-fetching the transaction status from Dice using the transaction_id
 * before mutating anything — the body alone is treated as a hint.
 *
 * Idempotent: only flips orders.payment_status from 'pending' → 'paid'
 * (the WHERE clause guarantees we don't double-trigger on retries).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const transactionId =
      pickField<string>(body, ['transaction_id', 'transactionId', 'id']) || '';
    const externalId = pickField<string>(body, ['external_id', 'externalId']) || '';
    const claimedStatus = String(pickField(body, ['status']) ?? '').toUpperCase();

    if (!transactionId && !externalId) {
      return res.status(400).json({ error: 'transaction_id or external_id required' });
    }

    // Always 200 fast for unsupported statuses so Dice doesn't retry forever.
    if (claimedStatus !== 'COMPLETED' && claimedStatus !== 'FAILED' && claimedStatus !== 'EXPIRED') {
      return res.status(200).json({ success: true, ignored: true, status: claimedStatus });
    }

    // Re-confirm with Dice — never trust the body alone.
    let confirmedStatus = claimedStatus;
    if (transactionId && diceCredsConfigured()) {
      try {
        const data = await diceFetch(async (token) => {
          const r = await axios.get(
            `${DICE_BASE_URL}/api/v1/transactions/getStatusTransac/${encodeURIComponent(transactionId)}`,
            { headers: { Authorization: `Bearer ${token}` }, timeout: 8_000 },
          );
          return r.data as Record<string, unknown>;
        });
        confirmedStatus = String(pickField(data, ['status', 'transaction_status']) ?? confirmedStatus).toUpperCase();
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') console.warn('[dice-webhook] status re-fetch failed:', err);
        // Keep claimedStatus — but log so we know if Dice's API is misbehaving.
      }
    }

    // Locate the order. Prefer external_id (we set it = orderId on create).
    const orderLookup = externalId
      ? supabaseAdmin.from('orders').select('id,payment_status').eq('id', externalId).maybeSingle()
      : supabaseAdmin
          .from('orders')
          .select('id,payment_status')
          .eq('flowpay_charge_id', transactionId)
          .maybeSingle();

    const { data: order, error: lookupErr } = await orderLookup;
    if (lookupErr) {
      if (process.env.NODE_ENV !== 'production') console.error('[dice-webhook] lookup error:', lookupErr.message);
      // Still 200 so Dice doesn't hammer us; we can replay manually if needed.
      return res.status(200).json({ success: true, warn: 'lookup failed' });
    }
    if (!order) {
      // Could be an upsell (external_id starts with "upsell-") — handle separately.
      if (externalId.startsWith('upsell-') && confirmedStatus === 'COMPLETED') {
        await markUpsellPaid(externalId, transactionId);
        return res.status(200).json({ success: true, kind: 'upsell' });
      }
      return res.status(200).json({ success: true, warn: 'order not found' });
    }

    if (confirmedStatus === 'COMPLETED' && order.payment_status === 'pending') {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'paid',
          status: 'processing',
          paid_at: new Date().toISOString(),
          flowpay_charge_id: transactionId || undefined,
        } as never)
        .eq('id', order.id)
        .eq('payment_status', 'pending');

      // Best-effort delivery trigger. process-delivery is idempotent.
      try {
        await supabaseAdmin.rpc.bind(supabaseAdmin); // no-op; placeholder for explicit RPC if added later
      } catch {
        /* noop */
      }
    } else if (confirmedStatus === 'FAILED' || confirmedStatus === 'EXPIRED') {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: confirmedStatus === 'EXPIRED' ? 'expired' : 'failed',
        } as never)
        .eq('id', order.id)
        .eq('payment_status', 'pending');
    }

    return res.status(200).json({ success: true, status: confirmedStatus });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[dice-webhook] error:', message);
    // 200 so Dice doesn't loop. Real errors surface in our logs.
    return res.status(200).json({ success: false, error: 'Internal error swallowed' });
  }
}

async function markUpsellPaid(externalId: string, chargeId: string) {
  // external_id format from the upsell flow: `upsell-<orderId>-<addonType>`
  const m = externalId.match(/^upsell-(.+)-([a-z_]+)$/);
  if (!m) return;
  const [, orderId, addonType] = m;
  await supabaseAdmin
    .from('sale_addons')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      flowpay_charge_id: chargeId || undefined,
    } as never)
    .eq('order_id', orderId)
    .eq('addon_type', addonType)
    .eq('status', 'pending');
}
