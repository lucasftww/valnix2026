import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import {
  setCorsHeaders,
  verifyAdminToken,
  errorMessage,
  rateLimit,
  clientIp,
  isUuid,
} from './_utils/helpers.js';

/**
 * Multi-purpose endpoint covering:
 *
 *   GET  /api/admin-post-payment           → list active post_payment_pages (public)
 *   POST /api/admin-post-payment           → tracking + admin CRUD
 *        body.action:
 *          'track-view' | 'track-skip'      → public (rate-limited, validated)
 *          'page-upsert' | 'page-stats' | 'seed' → admin
 *   PUT  /api/admin-post-payment           → admin, alias for page-upsert
 *
 * `addon-create` and `addon-update` were removed: they were publicly writable
 * and trivially abused (spoof pix_code, inflate revenue). The pending
 * sale_addons row is now created server-side by `dice-pix?action=create` when
 * the upsell PIX is generated, with all fields under server control.
 */

const KNOWN_ADDON_TYPES = new Set(['premium_benefits', 'delivery_priority', 'data_swap_warranty']);

const DEFAULT_PAGES = [
  {
    addon_type: 'premium_benefits',
    title: 'Benefícios Premium',
    subtitle: 'Aproveite agora — última oportunidade',
    badge_text: 'OFERTA EXCLUSIVA',
    badge_color: 'yellow',
    benefits: ['Acesso prioritário', 'Suporte VIP', 'Brindes exclusivos'],
    price: 9.9,
    original_price: 29.9,
    button_accept_text: 'SIM! EU QUERO!',
    button_skip_text: 'Não, obrigado',
    next_route: '/entrega-prioritaria',
    is_active: true,
    display_order: 1,
  },
  {
    addon_type: 'delivery_priority',
    title: 'Entrega Prioritária',
    subtitle: 'Receba seu código instantaneamente',
    badge_text: 'RÁPIDO',
    badge_color: 'orange',
    benefits: ['Entrega em 1 minuto', 'Notificação por SMS', 'Reposição garantida'],
    price: 4.9,
    original_price: 19.9,
    button_accept_text: 'ATIVAR ENTREGA EXPRESS',
    button_skip_text: 'Continuar sem',
    next_route: '/protecao-total',
    is_active: true,
    display_order: 2,
  },
  {
    addon_type: 'data_swap_warranty',
    title: 'Proteção Total',
    subtitle: 'Troque ou recupere seu pedido a qualquer momento',
    badge_text: 'GARANTIA',
    badge_color: 'green',
    benefits: ['Troca em até 7 dias', 'Reposição em caso de erro', 'Atendimento humano'],
    price: 7.9,
    original_price: 24.9,
    button_accept_text: 'PROTEGER MEU PEDIDO',
    button_skip_text: 'Continuar sem proteção',
    next_route: '/order',
    is_active: true,
    display_order: 3,
  },
] as const;

function parseBody(req: VercelRequest): Record<string, unknown> {
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  if (typeof b === 'string') {
    try {
      const p = JSON.parse(b);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function requireAdmin(req: VercelRequest): boolean {
  const token = req.headers['x-admin-token'];
  return verifyAdminToken(typeof token === 'string' ? token : '');
}

const PAGE_FIELDS = [
  'id', 'addon_type', 'title', 'subtitle', 'badge_text', 'badge_color',
  'benefits', 'price', 'original_price', 'button_accept_text', 'button_skip_text',
  'next_route', 'is_active', 'display_order',
] as const;

function sanitizePageRow(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const f of PAGE_FIELDS) {
    if (row[f] !== undefined) clean[f] = row[f];
  }
  return clean;
}

function trimStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Public list — used by the storefront upsell pages. Only active pages.
      const { data, error } = await supabaseAdmin
        .from('post_payment_pages')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return res.status(200).json({ pages: data ?? [] });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body.action || '');

      // ─── Public actions (rate-limited) ───────────────────────────
      if (action === 'track-view' || action === 'track-skip') {
        const ip = clientIp(req);
        if (!rateLimit(`pp-track:${ip}`, 60, 60_000)) {
          return res.status(429).json({ error: 'Too many requests' });
        }
        const addonType = typeof body.addon_type === 'string' ? body.addon_type : '';
        if (!KNOWN_ADDON_TYPES.has(addonType)) {
          return res.status(400).json({ error: 'unknown addon_type' });
        }
        const orderIdStr = typeof body.order_id === 'string' ? body.order_id : null;
        // Allow null OR uuid (no free-form strings).
        if (orderIdStr !== null && !isUuid(orderIdStr)) {
          return res.status(400).json({ error: 'invalid order_id' });
        }
        const { error } = await supabaseAdmin.from('post_payment_events').insert({
          order_id: orderIdStr,
          addon_type: addonType,
          event_type: action === 'track-view' ? 'view' : 'skip',
          utm_source: trimStr(body.utm_source, 200),
          utm_medium: trimStr(body.utm_medium, 200),
          utm_campaign: trimStr(body.utm_campaign, 200),
        });
        if (error) {
          console.error('[admin-post-payment] track insert error:', error.message);
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(200).json({ success: true });
      }

      // `addon-create` and `addon-update` are intentionally removed (see file header).
      if (action === 'addon-create' || action === 'addon-update') {
        return res.status(410).json({
          error: 'This action was removed. The upsell row is created server-side by /api/dice-pix?action=create.',
        });
      }

      // ─── Admin-only actions ───────────────────────────────────────
      if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      if (action === 'page-upsert') {
        const { action: _a, ...row } = body;
        const clean = sanitizePageRow(row);
        if (typeof clean.addon_type !== 'string' || !clean.addon_type) {
          return res.status(400).json({ error: 'addon_type required' });
        }
        const { data, error } = await supabaseAdmin
          .from('post_payment_pages')
          .upsert(clean as never, { onConflict: 'addon_type' })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true, id: data?.id });
      }

      if (action === 'page-stats') {
        const { data, error } = await supabaseAdmin
          .from('sale_addons')
          .select('addon_type,status,amount');
        if (error) throw new Error(error.message);
        const stats: Record<string, { total: number; paid: number; skipped: number; revenue: number }> = {};
        for (const row of data ?? []) {
          const key = (row as { addon_type: string }).addon_type;
          if (!stats[key]) stats[key] = { total: 0, paid: 0, skipped: 0, revenue: 0 };
          stats[key].total++;
          const status = (row as { status: string }).status;
          if (status === 'paid') {
            stats[key].paid++;
            stats[key].revenue += Number((row as { amount: number | null }).amount || 0);
          } else if (status === 'skipped') {
            stats[key].skipped++;
          }
        }
        return res.status(200).json({ stats });
      }

      if (action === 'seed') {
        const { error } = await supabaseAdmin
          .from('post_payment_pages')
          .upsert(DEFAULT_PAGES as never, { onConflict: 'addon_type' });
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true, seeded: DEFAULT_PAGES.length });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      const body = parseBody(req);
      const clean = sanitizePageRow(body);
      if (typeof clean.addon_type !== 'string' || !clean.addon_type) {
        return res.status(400).json({ error: 'addon_type required' });
      }
      const { data, error } = await supabaseAdmin
        .from('post_payment_pages')
        .upsert(clean as never, { onConflict: 'addon_type' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true, id: data?.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[admin-post-payment] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
