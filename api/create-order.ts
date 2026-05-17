import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import {
  setCorsHeaders,
  errorMessage,
  rateLimit,
  clientIp,
  isValidEmail,
  isValidDocument,
  isUuid as isUuidHelper,
} from './_utils/helpers.js';
import { randomBytes } from 'crypto';

/**
 * POST /api/create-order
 *
 * Public endpoint called from the checkout. Validates each line item against
 * the product catalog server-side — the client-supplied `unit_price` /
 * `total_price` / `total_amount` are recomputed from the DB. This is the
 * single most important fraud-prevention check in the whole stack: never
 * trust the client to tell you what something costs.
 *
 * Body:
 *   {
 *     order: { user_id, customer_name, customer_email, customer_phone,
 *              customer_document, payment_method, fbc, fbp,
 *              event_source_url, utm_*, notes? },
 *     items: [{ product_id, quantity, ... }]
 *   }
 *
 * Returns: { success, orderId, guestHash, total }
 */

interface IncomingItem {
  product_id?: unknown;
  quantity?: unknown;
}

function isUuid(v: unknown): v is string {
  return isUuidHelper(v);
}

function isString(v: unknown, maxLen = 255): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

/** Brazilian phone — accepts 10 or 11 digits after stripping non-digits. */
function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return digits.slice(0, 13);
}

function generateGuestHash(): string {
  return randomBytes(24).toString('base64url');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate-limit: 10 order creations / minute per IP. Stops botnet-style spam.
  const ip = clientIp(req);
  if (!rateLimit(`create-order:${ip}`, 10, 60_000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns segundos.' });
  }

  try {
    const body = (req.body ?? {}) as { order?: unknown; items?: unknown };
    const orderInput = (body.order ?? {}) as Record<string, unknown>;
    const itemsInput = Array.isArray(body.items) ? (body.items as IncomingItem[]) : [];

    if (!isString(orderInput.customer_name, 200)) {
      return res.status(400).json({ error: 'customer_name required' });
    }

    // Validate email/phone/CPF (CPF is only required for PIX KYC — soft for now).
    const customerEmail =
      typeof orderInput.customer_email === 'string' ? orderInput.customer_email.trim() : '';
    if (customerEmail && !isValidEmail(customerEmail)) {
      return res.status(400).json({ error: 'invalid customer_email' });
    }
    const phoneDigits = normalizePhone(orderInput.customer_phone);
    if (orderInput.customer_phone && !phoneDigits) {
      return res.status(400).json({ error: 'invalid customer_phone' });
    }
    const docDigits =
      typeof orderInput.customer_document === 'string'
        ? orderInput.customer_document.replace(/\D/g, '')
        : '';
    if (docDigits && !isValidDocument(docDigits)) {
      return res.status(400).json({ error: 'customer_document must be 11 (CPF) or 14 (CNPJ) digits' });
    }

    if (itemsInput.length === 0 || itemsInput.length > 50) {
      return res.status(400).json({ error: 'items must contain between 1 and 50 entries' });
    }

    // ─── Aggregate quantities by product_id ──────────────────────────────
    const wanted = new Map<string, number>();
    for (const raw of itemsInput) {
      if (!isUuid(raw.product_id)) {
        return res.status(400).json({ error: 'each item.product_id must be a UUID' });
      }
      const qty = Number(raw.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        return res.status(400).json({ error: 'each item.quantity must be 1..999' });
      }
      wanted.set(raw.product_id, (wanted.get(raw.product_id) ?? 0) + qty);
    }

    // ─── Fetch authoritative product data ────────────────────────────────
    const productIds = [...wanted.keys()];
    const { data: products, error: productsErr } = await supabaseAdmin
      .from('products')
      .select('id,name,price,image_url,is_active,delivery_type,stock,auto_delivery_codes')
      .in('id', productIds);
    if (productsErr) throw new Error(productsErr.message);

    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    let serverTotal = 0;
    const dbItems: Array<{
      order_id?: string;
      product_id: string;
      product_name: string;
      product_image: string | null;
      quantity: number;
      unit_price: number;
      total_price: number;
      delivery_type: string;
    }> = [];

    for (const [productId, qty] of wanted) {
      const p = byId.get(productId);
      if (!p) return res.status(400).json({ error: `Product not found: ${productId}` });
      if (!p.is_active) return res.status(400).json({ error: `Product unavailable: ${p.name}` });
      // Stock check: for delivery_type='auto', the *real* stock is the code pool
      // size (an admin who hasn't seeded codes effectively has 0 in stock even
      // if products.stock column is null). For manual products, use the column.
      const effectiveStock =
        p.delivery_type === 'auto'
          ? (Array.isArray(p.auto_delivery_codes) ? p.auto_delivery_codes.length : 0)
          : (p.stock ?? null);
      if (effectiveStock != null && effectiveStock < qty) {
        return res.status(409).json({
          error: `Estoque insuficiente para "${p.name}" (disponível: ${effectiveStock}, pedido: ${qty})`,
          code: 'insufficient_stock',
          product_id: p.id,
          available: effectiveStock,
        });
      }
      const unitPrice = Number(p.price);
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      serverTotal = Math.round((serverTotal + lineTotal) * 100) / 100;
      dbItems.push({
        product_id: p.id,
        product_name: p.name,
        product_image: p.image_url,
        quantity: qty,
        unit_price: unitPrice,
        total_price: lineTotal,
        delivery_type: p.delivery_type || 'manual',
      });
    }

    // Dice's PIX gateway rejects amounts below R$ 2,00 — keep the order
    // floor in sync so the user never reaches checkout with a doomed total.
    if (serverTotal < 2) {
      return res.status(400).json({ error: 'Pedido abaixo do valor mínimo (R$ 2,00).' });
    }

    // ─── Build order row (ignore client-supplied total_amount AND payment_method) ──
    const guestHash = generateGuestHash();
    // user_id: accept guest_ prefix or UUID; reject anything else to keep the column clean.
    const userIdRaw = typeof orderInput.user_id === 'string' ? orderInput.user_id : '';
    const userId =
      isUuid(userIdRaw) || /^guest_[a-z0-9]{6,40}$/i.test(userIdRaw) ? userIdRaw.slice(0, 60) : null;

    const orderRow = {
      user_id: userId,
      guest_hash: guestHash,
      customer_name: String(orderInput.customer_name).slice(0, 200),
      customer_email: customerEmail || null,
      customer_phone: phoneDigits,
      customer_document: docDigits || null,
      total_amount: serverTotal,
      // Hardcoded — card flow was removed during the Dice migration. Stops a
      // confused/malicious client from inserting "free" or other junk values.
      payment_method: 'pix',
      notes: typeof orderInput.notes === 'string' ? orderInput.notes.slice(0, 2000) : null,
      fbc: typeof orderInput.fbc === 'string' ? orderInput.fbc.slice(0, 200) : null,
      fbp: typeof orderInput.fbp === 'string' ? orderInput.fbp.slice(0, 200) : null,
      event_source_url:
        typeof orderInput.event_source_url === 'string' ? orderInput.event_source_url.slice(0, 500) : null,
      utm_source: typeof orderInput.utm_source === 'string' ? orderInput.utm_source.slice(0, 200) : null,
      utm_medium: typeof orderInput.utm_medium === 'string' ? orderInput.utm_medium.slice(0, 200) : null,
      utm_campaign: typeof orderInput.utm_campaign === 'string' ? orderInput.utm_campaign.slice(0, 200) : null,
      utm_content: typeof orderInput.utm_content === 'string' ? orderInput.utm_content.slice(0, 200) : null,
      utm_term: typeof orderInput.utm_term === 'string' ? orderInput.utm_term.slice(0, 200) : null,
    };

    const { data: created, error: orderErr } = await supabaseAdmin
      .from('orders')
      .insert(orderRow as never)
      .select('id')
      .single();
    if (orderErr) throw new Error(orderErr.message);
    if (!created?.id) throw new Error('Failed to create order');

    const orderId = created.id;
    const itemsRows = dbItems.map((it) => ({ ...it, order_id: orderId }));
    const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(itemsRows as never);
    if (itemsErr) {
      // Roll back the order so we don't leave an empty pending row.
      await supabaseAdmin.from('orders').delete().eq('id', orderId);
      throw new Error(itemsErr.message);
    }

    return res.status(200).json({
      success: true,
      orderId,
      guestHash,
      total: serverTotal,
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[create-order] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
