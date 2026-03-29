import { db } from './_utils/firebase';
import { hashData, setCorsHeaders } from './_utils/helpers';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { event, userData, customData, event_id, url } = req.body;

    // 1. Log event to Firestore
    const eventRef = db.collection('analytics_events').doc();
    await eventRef.set({
      event_name: event,
      event_id,
      url,
      user_data: userData,
      custom_data: customData,
      timestamp: new Date().toISOString(),
      source: 'server-relay-vercel'
    });

    // 2. Relay to Meta CAPI
    // Get credentials from Firestore
    const credsDoc = await db.collection('system_credentials').doc('meta_capi').get();
    const creds = credsDoc.data();

    const accessToken = creds?.token || process.env.META_ACCESS_TOKEN;
    const pixelId = creds?.pixel_id || process.env.META_PIXEL_ID;

    if (accessToken && pixelId) {
      // Build Meta Payload with Hashed PII
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
    }

    return res.status(200).json({ success: true, event_id });
  } catch (error: any) {
    console.error('Relay error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
