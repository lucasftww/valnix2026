import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { setCorsHeaders, verifyAdminToken } from './_utils/helpers.js';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Replay touches Meta CAPI — admin only.
  const adminToken = req.headers['x-admin-token'];
  if (!verifyAdminToken(adminToken as string)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { eventIds } = (req.body ?? {}) as { eventIds?: unknown };
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ error: 'eventIds array required' });
    }

    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const stringIds = eventIds.filter((x): x is string => typeof x === 'string');

    const { data: rows, error } = await supabaseAdmin
      .from('analytics_events')
      .select('event_id,event_name,user_data,custom_data,url')
      .in('event_id', stringIds);
    if (error) throw new Error(error.message);

    const byId = new Map<string, (typeof rows)[number]>();
    for (const r of rows ?? []) if (r.event_id) byId.set(r.event_id, r);

    const results = await Promise.all(
      stringIds.map(async (id) => {
        const row = byId.get(id);
        if (!row) return { id, status: 'not_found' };
        try {
          await axios.post(`${baseUrl}/api/meta-relay`, {
            event: row.event_name,
            userData: row.user_data,
            customData: row.custom_data,
            event_id: row.event_id,
            url: row.url,
          });
          return { id, status: 'success' };
        } catch (err: unknown) {
          const ax = err as { message?: string; response?: { data?: unknown } };
          if (process.env.NODE_ENV !== 'production') {
            console.error(`[Replay] error for ${id}:`, ax.response?.data || ax.message);
          }
          return { id, status: 'error', message: ax.message, details: ax.response?.data };
        }
      }),
    );

    return res.status(200).json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
