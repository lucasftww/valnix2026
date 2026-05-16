import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { errorMessage, setCorsHeaders } from './_utils/helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      event_name,
      user_id,
      page_url,
      device_type,
      browser,
      value,
      currency,
      order_id,
      content_name,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (!event_name || typeof event_name !== 'string') {
      return res.status(400).json({ error: 'event_name is required' });
    }

    const row = {
      event_name,
      user_id: typeof user_id === 'string' ? user_id : null,
      page_url: typeof page_url === 'string' ? page_url : null,
      device_type: typeof device_type === 'string' ? device_type : 'unknown',
      browser: typeof browser === 'string' ? browser : 'unknown',
      value: typeof value === 'number' ? value : null,
      currency: typeof currency === 'string' ? currency : null,
      order_id: typeof order_id === 'string' ? order_id : null,
      content_name: typeof content_name === 'string' ? content_name : null,
    };

    const { data, error } = await supabaseAdmin
      .from('store_metrics')
      .insert(row as never)
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    return res.status(200).json({ success: true, id: data?.id });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[Metrics] error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
