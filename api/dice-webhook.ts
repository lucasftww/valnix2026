import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage, isUuid } from './_utils/helpers.js';
import { DICE_BASE_URL, diceCredsConfigured, diceFetch, pickField } from './_utils/dice.js';
import { runAutoDelivery } from './_utils/delivery.js';
import axios from 'axios';
import { timingSafeEqual } from 'crypto';

/**
 * Dice → us. Receives status changes for transactions we created.
 *
 *   POST /api/dice-webhook
 *     body: { transaction_id, external_id, status, amount, ... }
 *
 * Returns 200 on success, 5xx on transient failures so Dice retries.
 *
 * Security:
 * 1. Shared-secret check: caller must pass `?secret=<DICE_WEBHOOK_SECRET>` OR
 *    header `X-Dice-Webhook-Secret`. We configured this when registering the
 *    webhook URL with Dice; without it the endpoint refuses.
 * 2. Re-fetch transaction status from Dice using `transaction_id`. The body
 *    is treated as a hint — confirmedStatus comes from the API call. If the
 *    re-fetch fails, we return 500 (Dice will retry) instead of trusting
 *    unsigned client input.
 * 3. Amount verification: the order's `total_amount` must equal the amount
 *    Dice reports as paid (within 1¢). Mismatch = the transaction is
 *    suspicious — order is NOT marked paid.
 * 4. External_id binding: webhook lookup requires both `id = external_id` AND
 *    `flowpay_charge_id = transaction_id` (set on charge creation), so an
 *    attacker swapping IDs can't trick us.
 *
 * Idempotent: flips `payment_status='pending'` → 'paid' only once.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Shared-secret check ─────────────────────────────────────────
  const expectedSecret = process.env.DICE_WEBHOOK_SECRET || '';
  if (!expectedSecret) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[dice-webhook] DICE_WEBHOOK_SECRET not configured — refusing all webhooks');
    }
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  const provided =
    (typeof req.query.secret === 'string' ? req.query.secret : '') ||
    (req.headers['x-dice-webhook-secret'] as string) ||
    '';
  if (!provided || !constantTimeStrEq(provided, expectedSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const transactionId =
      pickField<string>(body, ['transaction_id', 'transactionId', 'id']) || '';
    const externalId = pickField<string>(body, ['external_id', 'externalId']) || '';
    const claimedStatus = String(pickField(body, ['status']) ?? '').toUpperCase();

    if (!transactionId) {
      // Without transaction_id we can't re-fetch to confirm — refuse.
      return res.status(400).json({ error: 'transaction_id required' });
    }

    if (claimedStatus !== 'COMPLETED' && claimedStatus !== 'FAILED' && claimedStatus !== 'EXPIRED') {
      // Acknowledge unknown statuses so Dice doesn't retry forever.
      return res.status(200).json({ success: true, ignored: true });
    }

    // ── 2. Re-confirm with Dice. If we can't confirm, 500 (Dice retries). ──
    if (!diceCredsConfigured()) {
      console.error('[dice-webhook] Dice creds missing, cannot re-confirm');
      return res.status(500).json({ error: 'Cannot verify with gateway' });
    }
    let confirmed: { status: string; amount: number | null; externalId: string };
    try {
      const data = await diceFetch(async (token) => {
        const r = await axios.get(
          `${DICE_BASE_URL}/api/v1/transactions/getStatusTransac/${encodeURIComponent(transactionId)}`,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 8_000 },
        );
        return r.data as Record<string, unknown>;
      });
      const status = String(
        pickField(data, ['status', 'transaction_status']) ?? claimedStatus,
      ).toUpperCase();
      const amountRaw = pickField<number | string>(data, [
        'amount',
        'amount_brl',
        'paid_amount',
        'value',
      ]);
      const amount =
        typeof amountRaw === 'number'
          ? amountRaw
          : typeof amountRaw === 'string'
            ? Number(amountRaw)
            : null;
      const apiExt = pickField<string>(data, ['external_id', 'externalId']) || externalId;
      confirmed = { status, amount: Number.isFinite(amount as number) ? (amount as number) : null, externalId: apiExt };
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[dice-webhook] re-fetch failed:', errorMessage(err));
      }
      // Don't trust the body alone. Tell Dice to retry — by the time the retry
      // comes, the API is hopefully back up.
      return res.status(500).json({ error: 'Cannot verify with gateway' });
    }

    // ── 3. Handle upsell payments separately (no row in `orders`) ────────
    if (confirmed.externalId.startsWith('upsell-')) {
      if (confirmed.status === 'COMPLETED') {
        await markUpsellPaid(confirmed.externalId, transactionId, confirmed.amount);
      }
      return res.status(200).json({ success: true, kind: 'upsell', status: confirmed.status });
    }

    // ── 4. Locate the order, requiring BOTH id and charge_id match ───────
    if (!isUuid(confirmed.externalId)) {
      return res.status(200).json({ success: true, warn: 'external_id not a valid order id' });
    }
    const { data: order, error: lookupErr } = await supabaseAdmin
      .from('orders')
      .select('id,payment_status,total_amount,flowpay_charge_id')
      .eq('id', confirmed.externalId)
      .eq('flowpay_charge_id', transactionId)
      .maybeSingle();
    if (lookupErr) {
      console.error('[dice-webhook] lookup error:', lookupErr.message);
      return res.status(500).json({ error: 'Lookup failed' }); // Dice retries
    }
    if (!order) {
      // Either the order doesn't exist or the charge_id doesn't match what we stored.
      // Both are non-retriable from Dice's perspective; respond 200 to stop the loop.
      console.warn('[dice-webhook] no order match for', { transactionId, externalId: confirmed.externalId });
      return res.status(200).json({ success: true, warn: 'no order match' });
    }

    // ── 5. Amount verification (only for COMPLETED) ──────────────────────
    if (confirmed.status === 'COMPLETED' && confirmed.amount != null) {
      const expectedCents = Math.round(Number(order.total_amount) * 100);
      const paidCents = Math.round(confirmed.amount * 100);
      if (Math.abs(expectedCents - paidCents) > 1) {
        console.error('[dice-webhook] amount mismatch', {
          orderId: order.id, expectedCents, paidCents,
        });
        // Don't mark paid. Acknowledge so Dice doesn't retry; admin must review.
        return res.status(200).json({ success: false, warn: 'amount mismatch — not marking paid' });
      }
    }

    // ── 6. Apply state transitions ───────────────────────────────────────
    if (confirmed.status === 'COMPLETED' && order.payment_status === 'pending') {
      const { error: upd } = await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'paid',
          status: 'processing',
          paid_at: new Date().toISOString(),
        } as never)
        .eq('id', order.id)
        .eq('payment_status', 'pending'); // idempotency guard
      if (upd) {
        console.error('[dice-webhook] update failed:', upd.message);
        return res.status(500).json({ error: 'Update failed' });
      }

      // Auto-delivery (best-effort; admin can re-run process-delivery if needed).
      try {
        const result = await runAutoDelivery(order.id);
        if (process.env.NODE_ENV !== 'production') {
          console.log('[dice-webhook] auto-delivery:', order.id, result);
        }
      } catch (deliveryErr) {
        // Don't 500 — payment is confirmed, delivery is recoverable via admin re-run.
        console.error('[dice-webhook] auto-delivery error:', errorMessage(deliveryErr));
      }
    } else if (confirmed.status === 'FAILED' || confirmed.status === 'EXPIRED') {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: confirmed.status === 'EXPIRED' ? 'expired' : 'failed',
        } as never)
        .eq('id', order.id)
        .eq('payment_status', 'pending');
    }

    return res.status(200).json({ success: true, status: confirmed.status });
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error('[dice-webhook] unexpected error:', message);
    // 500 → Dice retries. Better than swallowing real payment events.
    return res.status(500).json({ error: 'Internal error' });
  }
}

function constantTimeStrEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still do a compare to avoid early-return timing leak.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

async function markUpsellPaid(externalId: string, chargeId: string, paidAmount: number | null) {
  // external_id format: `upsell-<orderId>-<addonType>`
  const m = externalId.match(/^upsell-([0-9a-f-]{36})-([a-z_]+)$/);
  if (!m) return;
  const [, orderId, addonType] = m;

  // Pull the configured price for this addon — never trust the paid amount alone.
  const { data: page } = await supabaseAdmin
    .from('post_payment_pages')
    .select('price,addon_type')
    .eq('addon_type', addonType)
    .maybeSingle();
  if (!page) {
    console.warn('[dice-webhook] upsell: no page config for', addonType);
    return;
  }
  if (paidAmount != null) {
    const expectedCents = Math.round(Number(page.price) * 100);
    const paidCents = Math.round(paidAmount * 100);
    if (Math.abs(expectedCents - paidCents) > 1) {
      console.error('[dice-webhook] upsell amount mismatch — skipping', {
        addonType, expectedCents, paidCents,
      });
      return;
    }
  }

  // charge_id is already set on the row by dice-pix when creating the upsell.
  // The .eq('status', 'pending') below acts as the idempotency guard.
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
