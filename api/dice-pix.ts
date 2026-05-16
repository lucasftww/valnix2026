import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage } from './_utils/helpers.js';
import { DICE_BASE_URL, diceCredsConfigured, diceFetch, pickField } from './_utils/dice.js';
import axios, { isAxiosError } from 'axios';

/**
 * Dice PIX gateway adapter. Mirrors the contract the front-end expected from
 * the legacy invictuspay-pix endpoint, so consumers only need to swap the
 * function name.
 *
 *   POST /api/dice-pix?action=create
 *     body: { amount(int cents), orderId, description, customer:{name,email,phone,taxId} }
 *     → { success, brCode, chargeId, expiresIn }
 *
 *   GET  /api/dice-pix?action=status&chargeId=<dice_transaction_id>&orderId=<our_order_id>
 *     → { success, status: 'PENDING'|'COMPLETED'|'FAILED'|'RETIDO' }
 *
 * orderId may be prefixed with "upsell-" — those don't have a row in `orders`.
 *
 * Env: DICE_CLIENT_ID, DICE_CLIENT_SECRET, DICE_BASE_URL (optional),
 *      DICE_WEBHOOK_URL (optional — sent as clientCallbackUrl per request).
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

/** Map gateway/network exceptions to user-friendly codes the front can branch on. */
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
  if (process.env.DICE_WEBHOOK_URL) return process.env.DICE_WEBHOOK_URL;
  // Fall back to the host that received this request — works in prod and previews.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = req.headers.host;
  if (!host) return undefined;
  return `${proto}://${host}/api/dice-webhook`;
}

async function createCharge(req: VercelRequest, res: VercelResponse) {
  if (!ensureCreds(res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const amountCents = Number(body.amount);
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const description = typeof body.description === 'string' ? body.description : `Pedido ${orderId.slice(0, 8)}`;
  const customer = (body.customer ?? {}) as Record<string, unknown>;

  if (!Number.isInteger(amountCents) || amountCents < 200 || amountCents > 100_000_00) {
    // Dice minimum is R$ 2,00 = 200 cents.
    return res.status(400).json({
      error: 'amount must be cents between 200 (R$ 2,00) and 10000000',
      code: 'amount_out_of_range',
    });
  }
  if (!orderId) return res.status(400).json({ error: 'orderId required', code: 'order_id_missing' });

  const isUpsell = orderId.startsWith('upsell-');
  if (!isUpsell) {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id,total_amount,payment_status')
      .eq('id', orderId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'Internal server error' });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') {
      return res.status(409).json({ error: 'Order already paid' });
    }
    const expectedCents = Math.round(Number(order.total_amount) * 100);
    if (Math.abs(expectedCents - amountCents) > 1) {
      return res.status(400).json({ error: 'amount mismatch with order total' });
    }
  }

  const amountBrl = Math.round(amountCents) / 100;

  try {
    const docDigits = typeof customer.taxId === 'string' ? customer.taxId.replace(/\D/g, '') : undefined;

    // V2 = dynamic checkout. Required by our flow because the storefront
    // generates the amount on demand instead of mapping to pre-built products.
    const payload = {
      product_name: description,
      amount: amountBrl,
      external_id: orderId,
      clientCallbackUrl: buildWebhookUrl(req),
      payer: {
        name: typeof customer.name === 'string' ? customer.name : 'Cliente',
        email: typeof customer.email === 'string' ? customer.email : undefined,
        document: docDigits || undefined,
      },
    };

    const data = await diceFetch(async (token) => {
      const r = await axios.post(`${DICE_BASE_URL}/api/v2/payments/deposit`, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
      });
      return r.data as Record<string, unknown>;
    });

    const txId =
      pickField<string>(data, ['transaction_id', 'id', 'transactionId']) || '';
    const brCode = pickField<string>(data, ['qr_code_text', 'qrCode', 'pix_code', 'brCode', 'copy_paste']);
    const expiresIn =
      pickField<number>(data, ['expires_in', 'expirationInSeconds', 'expiration_in_seconds', 'expiresIn']) ??
      3600;

    if (!txId || !brCode) {
      if (process.env.NODE_ENV !== 'production') console.error('[dice-pix] unexpected response:', data);
      return res.status(502).json({
        error: 'Gateway returned incomplete response',
        code: 'gateway_bad_response',
      });
    }

    if (!isUpsell) {
      const expiresAtIso = pickField<string>(data, ['expires_at', 'expiration_at', 'expiresAt']);
      await supabaseAdmin
        .from('orders')
        .update({
          flowpay_charge_id: txId,
          pix_code: brCode,
          pix_expires_at: expiresAtIso ?? new Date(Date.now() + expiresIn * 1000).toISOString(),
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
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : '';
  if (!chargeId) return res.status(400).json({ error: 'chargeId required' });

  try {
    const data = await diceFetch(async (token) => {
      const r = await axios.get(
        `${DICE_BASE_URL}/api/v1/transactions/getStatusTransac/${encodeURIComponent(chargeId)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
      );
      return r.data as Record<string, unknown>;
    });

    const rawStatus = String(pickField(data, ['status', 'transaction_status']) ?? 'PENDING').toUpperCase();
    // Normalize Dice's vocabulary into the small set the front-end already handles.
    const status =
      rawStatus === 'COMPLETED' || rawStatus === 'PAID' || rawStatus === 'APPROVED'
        ? 'COMPLETED'
        : rawStatus === 'FAILED' || rawStatus === 'CANCELLED' || rawStatus === 'EXPIRED'
          ? 'FAILED'
          : rawStatus === 'RETIDO'
            ? 'RETIDO'
            : 'PENDING';

    if (status === 'COMPLETED' && orderId && !orderId.startsWith('upsell-')) {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'paid',
          status: 'processing',
          paid_at: new Date().toISOString(),
        } as never)
        .eq('id', orderId)
        .eq('payment_status', 'pending');
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
