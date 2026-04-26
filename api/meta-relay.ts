import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase.js';
import { errorMessage, hashData, setCorsHeaders } from './_utils/helpers.js';
import axios, { isAxiosError } from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { event, userData, customData, event_id, url } = req.body;

    // Get credentials
    const credsDoc = await db.collection('system_credentials').doc('meta_capi').get();
    const creds = credsDoc.data() || {};

    // Novo Pixel/Token (Março 2026) - Hardcoded para segurança máxima
    const HARDCODED_PIXEL_ID = '843361478785940';
    const HARDCODED_TOKEN = 'EAAXCTJFcZAckBRNKsxI3MuVp51Mv3IQVcMC6nZCv3JvqjAxeVC1ZCmPfa4AfiJFaXSRlmIHrFalKLxo0symr2jjjC00fzogCx63GZBadtsLHtQk0JeDK7nqs1EjVPPggKjBi0QZAUXM2ZAPY0qxdtYB01G8XcVvZAQqh3PedZC0ZAgz88yYZC1wdt4hghS4RVUWgZDZD';

    // Prioridade: Firestore > Env > Hardcoded
    const accessToken = creds.token || process.env.META_ACCESS_TOKEN || HARDCODED_TOKEN;
    const pixelId = creds.pixel_id || process.env.META_PIXEL_ID || HARDCODED_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('❌ [MetaRelay] Missing credentials:', { hasToken: !!accessToken, hasPixel: !!pixelId });
      throw new Error('Meta CAPI credentials not found in Firestore or Process Env');
    }

    const metaPayload = {
      data: [{
        event_name: event,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: url,
        event_id: event_id,
        user_data: {
          em: hashData(userData?.email?.trim().toLowerCase()),
          ph: hashData(userData?.phone?.trim().replace(/\D/g, '')),
          client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          client_user_agent: req.headers['user-agent'],
          fbc: userData?.fbc,
          fbp: userData?.fbp
        },
        custom_data: customData
      }]
    };

    try {
      await axios.post(
        `https://graph.facebook.com/v17.0/${pixelId}/events`,
        metaPayload,
        { params: { access_token: accessToken } }
      );
      return res.status(200).json({ success: true, event_id });
    } catch (metaError: unknown) {
      const details = isAxiosError(metaError)
        ? metaError.response?.data ?? metaError.message
        : errorMessage(metaError);
      console.error('❌ [MetaRelay] Meta API Error:', details);
      return res.status(500).json({
        error: 'Meta API reported an error',
        details,
      });
    }
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error('❌ [MetaRelay] Unexpected error:', message);
    return res.status(500).json({ error: message });
  }
}
