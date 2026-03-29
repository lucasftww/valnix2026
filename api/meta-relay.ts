import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase';
import { hashData, setCorsHeaders } from './_utils/helpers';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { event, userData, customData, event_id, url } = req.body;

    // Get credentials
    const credsDoc = await db.collection('system_credentials').doc('meta_capi').get();
    const creds = credsDoc.data();

    const accessToken = creds?.token || process.env.META_ACCESS_TOKEN;
    const pixelId = creds?.pixel_id || process.env.META_PIXEL_ID;

    if (!accessToken || !pixelId) {
      throw new Error('Missing Meta credentials');
    }

    const metaPayload = {
      data: [{
        event_name: event,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: url,
        event_id: event_id,
        user_data: {
          em: hashData(userData?.email),
          ph: hashData(userData?.phone),
          client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          client_user_agent: req.headers['user-agent'],
          fbc: userData?.fbc,
          fbp: userData?.fbp
        },
        custom_data: customData
      }]
    };

    await axios.post(
      `https://graph.facebook.com/v17.0/${pixelId}/events`,
      metaPayload,
      { params: { access_token: accessToken } }
    );

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
