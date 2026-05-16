import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, verifyAdminToken, errorMessage } from './_utils/helpers.js';

/**
 * Multi-purpose endpoint covering:
 *
 *   GET  /api/admin-post-payment           → list all post_payment_pages (public)
 *   POST /api/admin-post-payment           → tracking + addon CRUD (mixed auth)
 *        body.action:
 *          'track-view' | 'track-skip'      → public, inserts post_payment_events
 *          'addon-create'                   → public, inserts sale_addons row
 *          'addon-update'                   → public, updates pending sale_addons
 *          'page-upsert'                    → admin, upserts a post_payment_pages row
 *          'page-stats'                     → admin, returns addon stats
 *          'seed'                           → admin, inserts default 3 pages
 *   PUT  /api/admin-post-payment           → admin, updates a page (alias for page-upsert)
 */

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Public list — used by the storefront upsell pages.
      const { data, error } = await supabaseAdmin
        .from('post_payment_pages')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return res.status(200).json({ pages: data ?? [] });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body.action || '');

      // ─── Public actions ───────────────────────────────────────────
      if (action === 'track-view' || action === 'track-skip') {
        const { error } = await supabaseAdmin.from('post_payment_events').insert({
          order_id: body.order_id ? String(body.order_id) : null,
          addon_type: String(body.addon_type || ''),
          event_type: action === 'track-view' ? 'view' : 'skip',
          utm_source: body.utm_source ? String(body.utm_source) : null,
          utm_medium: body.utm_medium ? String(body.utm_medium) : null,
          utm_campaign: body.utm_campaign ? String(body.utm_campaign) : null,
        });
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true });
      }

      if (action === 'addon-create') {
        const { error } = await supabaseAdmin.from('sale_addons').insert({
          order_id: body.order_id ? String(body.order_id) : null,
          user_id: body.user_id ? String(body.user_id) : null,
          addon_type: String(body.addon_type || ''),
          status: String(body.status || 'pending'),
          amount: typeof body.amount === 'number' ? body.amount : null,
          customer_email: body.customer_email ? String(body.customer_email) : null,
          customer_name: body.customer_name ? String(body.customer_name) : null,
          utm_source: body.utm_source ? String(body.utm_source) : null,
          utm_medium: body.utm_medium ? String(body.utm_medium) : null,
          utm_campaign: body.utm_campaign ? String(body.utm_campaign) : null,
        });
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true });
      }

      if (action === 'addon-update') {
        const order_id = String(body.order_id || '');
        const addon_type = String(body.addon_type || '');
        const updates = (body.updates && typeof body.updates === 'object'
          ? (body.updates as Record<string, unknown>)
          : {}) as Record<string, unknown>;
        if (!order_id || !addon_type) return res.status(400).json({ error: 'order_id and addon_type required' });
        // Whitelist updatable fields (anyone with order_id can call this — keep tight).
        const safe: Record<string, unknown> = {};
        if (typeof updates.pix_code === 'string') safe.pix_code = updates.pix_code;
        if (typeof updates.flowpay_charge_id === 'string') safe.flowpay_charge_id = updates.flowpay_charge_id;
        const { error } = await supabaseAdmin
          .from('sale_addons')
          .update(safe as never)
          .eq('order_id', order_id)
          .eq('addon_type', addon_type)
          .eq('status', 'pending');
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true });
      }

      // ─── Admin-only actions ───────────────────────────────────────
      if (!requireAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      if (action === 'page-upsert') {
        const { action: _a, ...row } = body;
        const { data, error } = await supabaseAdmin
          .from('post_payment_pages')
          .upsert(row as never, { onConflict: 'addon_type' })
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
      const { data, error } = await supabaseAdmin
        .from('post_payment_pages')
        .upsert(body as never, { onConflict: 'addon_type' })
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
