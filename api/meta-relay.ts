import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import { errorMessage, hashData, setCorsHeaders } from './_utils/helpers.js';
import axios, { isAxiosError } from 'axios';

/**
 * Lightweight Meta CAPI relay (no analytics_events log).
 * Use server-relay.ts when you also want a persisted event row.
 */
async function getMetaCredentials(): Promise<{ accessToken: string; pixelId: string } | null> {
  try {
    const { data } = await supabaseAdmin
      .from('system_credentials')
      .select('data')
      .eq('key', 'meta_capi')
      .maybeSingle();
    const d = (data?.data as { token?: string; pixel_id?: string } | undefined) ?? {};
    const accessToken = d.token || process.env.META_ACCESS_TOKEN || '';
    const pixelId = d.pixel_id || process.env.META_PIXEL_ID || '';
    if (!accessToken || !pixelId) return null;
    return { accessToken, pixelId };
  } catch {
    const accessToken = process.env.META_ACCESS_TOKEN || '';
    const pixelId = process.env.META_PIXEL_ID || '';
    if (!accessToken || !pixelId) return null;
    return { accessToken, pixelId };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { event, userData, customData, event_id, url } = req.body ?? {};

    const creds = await getMetaCredentials();
    if (!creds) {
      return res.status(500).json({ error: 'Meta CAPI credentials not configured' });
    }

    const metaPayload = {
      data: [
        {
          event_name: event,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: url,
          event_id,
          user_data: {
            em: hashData(userData?.email?.trim().toLowerCase()),
            ph: hashData(userData?.phone?.trim().replace(/\D/g, '')),
            client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            client_user_agent: req.headers['user-agent'],
            fbc: userData?.fbc,
            fbp: userData?.fbp,
          },
          custom_data: customData,
        },
      ],
    };

    try {
      await axios.post(
        `https://graph.facebook.com/v17.0/${creds.pixelId}/events`,
        metaPayload,
        { params: { access_token: creds.accessToken } },
      );
      return res.status(200).json({ success: true, event_id });
    } catch (metaError: unknown) {
      const details = isAxiosError(metaError)
        ? metaError.response?.data ?? metaError.message
        : errorMessage(metaError);
      if (process.env.NODE_ENV !== 'production') console.error('[MetaRelay] Meta API error:', details);
      return res.status(500).json({ error: 'Meta API reported an error', details });
    }
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[MetaRelay] Unexpected error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
