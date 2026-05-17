import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage, isUuid } from './_utils/helpers.js';
import { DICE_BASE_URL, diceCredsConfigured, diceFetch, pickField } from './_utils/dice.js';
import axios, { isAxiosError } from 'axios';

/**
 * Dice PIX gateway adapter.
 *
 *   POST /api/dice-pix?action=create
 *     body: { amount(int cents), orderId, description?, customer:{name,email,phone,taxId} }
 *     → { success, brCode, chargeId, expiresIn }
 *
 *   GET  /api/dice-pix?action=status&chargeId=<dice_transaction_id>
 *     → { success, status: 'PENDING'|'COMPLETED'|'FAILED'|'RETIDO' }
 *     NOTE: the client should NOT pass orderId. We resolve the order from
 *     `orders.flowpay_charge_id = chargeId` server-side to prevent cross-order
 *     spoofing (attacker reusing their own completed chargeId to flip someone
 *     else's pending order to paid).
 *
 * `orderId` for upsells is `upsell-<orderId>-<addonType>`. Upsell amounts are
 * validated against `post_payment_pages.price` (or `sale_addons.amount` if a
 * pre-created row exists) — the client cannot dictate the price.
 *
 * Env: DICE_CLIENT_ID, DICE_CLIENT_SECRET, DICE_BASE_URL (optional),
 *      DICE_WEBHOOK_URL (recommended in prod — hardcoded webhook target).
 */

function ensureCreds(res: VercelResponse): boolean {
  if (!diceCredsConfigured()) {
    res.status(503).json({
      error: 'Dice gateway not configured',
      code: 'gateway_unconfigured',
      detail: 'Set DICE_CLIENT_ID and DICE_CLIENT_SECRET in env vars.',
    });
    return false;
  }
  return true;
}

function classifyGatewayError(err: unknown): { code: string; userMessage: string } {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return { code: 'gateway_auth_failed', userMessage: 'Falha de autenticação no gateway de pagamento.' };
    }
    if (status === 429) {
      return { code: 'gateway_rate_limited', userMessage: 'Muitas tentativas. Aguarde alguns segundos e tente novamente.' };
    }
    if (status && status >= 500) {
      return { code: 'gateway_unavailable', userMessage: 'O gateway de pagamento está indisponível. Tente novamente em alguns segundos.' };
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return { code: 'gateway_timeout', userMessage: 'O gateway demorou para responder. Tente novamente.' };
    }
    return { code: 'gateway_bad_response', userMessage: 'Erro inesperado do gateway. Tente novamente.' };
  }
  return { code: 'gateway_error', userMessage: 'Erro ao se comunicar com o gateway. Tente novamente.' };
}

function buildWebhookUrl(req: VercelRequest): string | undefined {
  const explicit = process.env.DICE_WEBHOOK_URL;
  const secret = process.env.DICE_WEBHOOK_SECRET || '';
  // Append the shared secret as a query param so Dice's POSTs are accepted by
  // /api/dice-webhook. Without this, every webhook fails 401 (by design).
  const appendSecret = (url: string): string => {
    if (!secret) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}secret=${encodeURIComponent(secret)}`;
  };
  if (explicit) return appendSecret(explicit);
  // Fall back to the host that received this request — works in prod and previews.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = req.headers.host;
  if (!host) return undefined;
  return appendSecret(`${proto}://${host}/api/dice-webhook`);
}

/** Upsell external_id format: `upsell-<orderId>-<addonType>` */
function parseUpsell(id: string): { orderId: string; addonType: string } | null {
  const m = id.match(/^upsell-([0-9a-f-]{36})-([a-z_]+)$/);
  if (!m) return null;
  return { orderId: m[1], addonType: m[2] };
}

async function createCharge(req: VercelRequest, res: VercelResponse) {
  if (!ensureCreds(res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const amountCents = Number(body.amount);
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const description =
    typeof body.description === 'string' && body.description.length <= 120
      ? body.description
      : `Pedido ${orderId.slice(0, 8)}`;

  if (!Number.isInteger(amountCents) || amountCents < 200 || amountCents > 10_000_00) {
    return res.status(400).json({
      error: 'amount must be cents between 200 (R$ 2,00) and 1000000',
      code: 'amount_out_of_range',
    });
  }
  if (!orderId) return res.status(400).json({ error: 'orderId required', code: 'order_id_missing' });

  const upsell = parseUpsell(orderId);
  const isUpsell = !!upsell;

  // ── Resolve canonical customer info & expected amount from the DB ──
  let customerName = 'Cliente';
  let customerEmail: string | undefined;
  let customerDoc: string | undefined;
  let expectedCents: number;

  if (isUpsell) {
    // Validate addon_type is known, fetch its configured price.
    const { data: page, error: pageErr } = await supabaseAdmin
      .from('post_payment_pages')
      .select('price,addon_type,is_active')
      .eq('addon_type', upsell.addonType)
      .maybeSingle();
    if (pageErr) return res.status(500).json({ error: 'Internal server error' });
    if (!page || !page.is_active) return res.status(404).json({ error: 'Upsell not available' });
    expectedCents = Math.round(Number(page.price) * 100);

    // Use the original order's customer info (security: prevents identity swap).
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('customer_name,customer_email,customer_document')
      .eq('id', upsell.orderId)
      .maybeSingle();
    if (order) {
      customerName = order.customer_name || customerName;
      customerEmail = order.customer_email || undefined;
      customerDoc = order.customer_document || undefined;
    }
  } else {
    if (!isUuid(orderId)) return res.status(400).json({ error: 'invalid orderId' });
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id,total_amount,payment_status,customer_name,customer_email,customer_document')
      .eq('id', orderId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'Internal server error' });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Order already paid' });
    }
    expectedCents = Math.round(Number(order.total_amount) * 100);
    customerName = order.customer_name || customerName;
    customerEmail = order.customer_email || undefined;
    customerDoc = order.customer_document || undefined;
  }

  if (Math.abs(expectedCents - amountCents) > 1) {
    return res
      .status(400)
      .json({ error: 'amount mismatch with server-side total', code: 'amount_mismatch' });
  }

  // Use the smaller of the two — defense in depth.
  const amountBrl = Number((Math.round(amountCents) / 100).toFixed(2));

  try {
    const payload = {
      product_name: description,
      amount: amountBrl,
      external_id: orderId,
      clientCallbackUrl: buildWebhookUrl(req),
      payer: {
        name: customerName,
        email: customerEmail,
        document: customerDoc,
      },
    };

    const data = await diceFetch(async (token) => {
      const r = await axios.post(`${DICE_BASE_URL}/api/v2/payments/deposit`, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
      });
      return r.data as Record<string, unknown>;
    });

    const txId = pickField<string>(data, ['transaction_id', 'id', 'transactionId']) || '';
    const brCode = pickField<string>(data, ['qr_code_text', 'qrCode', 'pix_code', 'brCode', 'copy_paste']);
    const expiresIn =
      pickField<number>(data, ['expires_in', 'expirationInSeconds', 'expiration_in_seconds', 'expiresIn']) ?? 3600;

    if (!txId || !brCode) {
      if (process.env.NODE_ENV !== 'production') console.error('[dice-pix] unexpected response:', data);
      return res.status(502).json({
        error: 'Gateway returned incomplete response',
        code: 'gateway_bad_response',
      });
    }

    const expiresAtIso =
      pickField<string>(data, ['expires_at', 'expiration_at', 'expiresAt']) ??
      new Date(Date.now() + expiresIn * 1000).toISOString();

    if (isUpsell) {
      // Upsert sale_addons row with the charge metadata. Server-controlled, never trusts client.
      await supabaseAdmin
        .from('sale_addons')
        .upsert(
          {
            order_id: upsell!.orderId,
            addon_type: upsell!.addonType,
            status: 'pending',
            amount: amountBrl,
            pix_code: brCode,
            flowpay_charge_id: txId,
          } as never,
          { onConflict: 'order_id,addon_type' },
        );
    } else {
      await supabaseAdmin
        .from('orders')
        .update({
          flowpay_charge_id: txId,
          pix_code: brCode,
          pix_expires_at: expiresAtIso,
        } as never)
        .eq('id', orderId);
    }

    return res.status(200).json({
      success: true,
      brCode,
      chargeId: txId,
      expiresIn,
    });
  } catch (err: unknown) {
    const detail = isAxiosError(err) ? (err.response?.data ?? err.message) : errorMessage(err);
    if (process.env.NODE_ENV !== 'production') console.error('[dice-pix] create error:', detail);
    const { code, userMessage } = classifyGatewayError(err);
    return res.status(502).json({ error: userMessage, code });
  }
}

async function getStatus(req: VercelRequest, res: VercelResponse) {
  if (!ensureCreds(res)) return;

  const chargeId = typeof req.query.chargeId === 'string' ? req.query.chargeId : '';
  if (!chargeId || chargeId.length < 6 || chargeId.length > 256) {
    return res.status(400).json({ error: 'chargeId required' });
  }

  try {
    const data = await diceFetch(async (token) => {
      const r = await axios.get(
        `${DICE_BASE_URL}/api/v1/transactions/getStatusTransac/${encodeURIComponent(chargeId)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
      );
      return r.data as Record<string, unknown>;
    });

    const rawStatus = String(pickField(data, ['status', 'transaction_status']) ?? 'PENDING').toUpperCase();
    const status =
      rawStatus === 'COMPLETED' || rawStatus === 'PAID' || rawStatus === 'APPROVED'
        ? 'COMPLETED'
        : rawStatus === 'FAILED' || rawStatus === 'CANCELLED' || rawStatus === 'EXPIRED'
          ? 'FAILED'
          : rawStatus === 'RETIDO'
            ? 'RETIDO'
            : 'PENDING';

    // ── Status mirror (best-effort, idempotent) ─────────────────────────
    // We DO NOT take orderId from the client. The order is looked up by the
    // charge_id stored when this charge was created — this prevents an attacker
    // from passing their own completed chargeId together with someone else's
    // orderId to flip a stranger's order paid.
    //
    // Authoritative source remains the webhook (which also verifies amount).
    // This polling path is a UX accelerant only.
    if (status === 'COMPLETED') {
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id,total_amount,payment_status')
        .eq('flowpay_charge_id', chargeId)
        .maybeSingle();

      if (order && order.payment_status === 'pending') {
        // Best-effort amount check too — same as webhook.
        const amountRaw = pickField<number | string>(data, ['amount', 'amount_brl', 'paid_amount', 'value']);
        const paidBrl =
          typeof amountRaw === 'number'
            ? amountRaw
            : typeof amountRaw === 'string'
              ? Number(amountRaw)
              : Number(order.total_amount);
        const expectedCents = Math.round(Number(order.total_amount) * 100);
        const paidCents = Math.round(paidBrl * 100);
        if (Math.abs(expectedCents - paidCents) <= 1) {
          await supabaseAdmin
            .from('orders')
            .update({
              payment_status: 'paid',
              status: 'processing',
              paid_at: new Date().toISOString(),
            } as never)
            .eq('id', order.id)
            .eq('payment_status', 'pending');
          // Delivery is triggered by the webhook. The polling path is just a
          // UX hint so the UI doesn't have to wait for the webhook callback.
        }
      }
    }

    return res.status(200).json({ success: true, status });
  } catch (err: unknown) {
    const detail = isAxiosError(err) ? (err.response?.data ?? err.message) : errorMessage(err);
    if (process.env.NODE_ENV !== 'production') console.error('[dice-pix] status error:', detail);
    const { code, userMessage } = classifyGatewayError(err);
    return res.status(502).json({ error: userMessage, code });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query.action || '');
  if (req.method === 'POST' && action === 'create') return createCharge(req, res);
  if (req.method === 'GET' && action === 'status') return getStatus(req, res);
  return res.status(400).json({ error: 'Unknown action' });
}
