import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, errorMessage } from './_utils/helpers.js';

/**
 * Public read-only catalog endpoint. Used as a hydration source for SSR-ish
 * homepage paint and as a fallback when the front can't reach Supabase
 * directly (rare, since RLS already exposes is_active rows to anon).
 *
 * GET /api/site-data?type=featured
 * GET /api/site-data?type=categories
 * GET /api/site-data?type=category&slug=valorant
 * GET /api/site-data?type=product&id=<uuid>
 */
/**
 * Replace raw `auto_delivery_codes` array with the integer `effective_stock`
 * (size of the code pool for auto-delivery products, falling back to the
 * `stock` column for manual). Never expose the raw codes to public — they're
 * what we deliver to paying customers.
 */
function stripCodes<T extends Record<string, unknown>>(row: T): Omit<T, 'auto_delivery_codes'> & { effective_stock: number | null } {
  const codes = row.auto_delivery_codes;
  const deliveryType = row.delivery_type;
  const stock = row.stock;
  const effective_stock =
    deliveryType === 'auto'
      ? (Array.isArray(codes) ? codes.length : 0)
      : (typeof stock === 'number' ? stock : null);
  const { auto_delivery_codes: _omit, ...safe } = row;
  return { ...safe, effective_stock } as Omit<T, 'auto_delivery_codes'> & { effective_stock: number | null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const type = String(req.query.type || '');

  // Cache headers — public, edge-cacheable for short bursts.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');

  try {
    if (type === 'featured') {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('id,name,price,old_price,discount,image_url,icon_url,category,display_order,is_active,featured,delivery_type,stock,auto_delivery_codes')
        .eq('is_active', true)
        .eq('featured', true)
        .order('display_order', { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      return res.status(200).json({ products: (data ?? []).map(stripCodes) });
    }

    if (type === 'categories') {
      const { data, error } = await supabaseAdmin
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return res.status(200).json({ categories: data ?? [] });
    }

    if (type === 'category') {
      const slug = String(req.query.slug || '');
      if (!slug) return res.status(400).json({ error: 'slug required' });
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('category', slug)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return res.status(200).json({ products: (data ?? []).map(stripCodes) });
    }

    if (type === 'product') {
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ error: 'id required' });
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return res.status(200).json({ product: data ? stripCodes(data) : null });
    }

    // Coupon preview — public, used by the cart sidebar to show "5% OFF" hint
    // before checkout. Final validation is server-side in /api/create-order.
    if (type === 'coupon') {
      const code = String(req.query.code || '').trim().toUpperCase();
      if (!code || code.length > 40) return res.status(400).json({ error: 'code required' });
      const { data, error } = await supabaseAdmin
        .from('coupons')
        .select('code,description,type,value,min_order,max_discount,first_purchase_only,expires_at,applies_to_category')
        .eq('code', code)
        .eq('is_active', true)
        .maybeSingle();
      if (error) {
        console.error('[site-data] coupon lookup error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!data) {
        return res.status(404).json({ error: 'Cupom inválido ou expirado', code: 'coupon_not_found' });
      }
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        return res.status(404).json({ error: 'Cupom expirado', code: 'coupon_expired' });
      }
      return res.status(200).json({ coupon: data });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[site-data] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
