import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase';
import { errorMessage, hashData, setCorsHeaders } from './_utils/helpers';
import axios, { isAxiosError } from 'axios';

/** Accepts nested `{ event, userData, customData }` or flat payloads from `metaCapi` / admin (event_name, email, value, …). */
function normalizeRelayBody(raw: unknown): {
  event: string;
  event_id: string | undefined;
  url: string;
  userData: {
    email?: string;
    phone?: string;
    fbc?: string;
    fbp?: string;
  };
  customData: Record<string, unknown> | undefined;
} {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  if (typeof b.event === 'string' && b.userData && typeof b.userData === 'object' && !Array.isArray(b.userData)) {
    const ud = b.userData as Record<string, unknown>;
    return {
      event: b.event,
      event_id: typeof b.event_id === 'string' ? b.event_id : undefined,
      url:
        typeof b.url === 'string'
          ? b.url
          : typeof b.event_source_url === 'string'
            ? b.event_source_url
            : 'https://www.valnix.com.br/checkout',
      userData: {
        email: typeof ud.email === 'string' ? ud.email : undefined,
        phone: typeof ud.phone === 'string' ? ud.phone : undefined,
        fbc: typeof ud.fbc === 'string' ? ud.fbc : undefined,
        fbp: typeof ud.fbp === 'string' ? ud.fbp : undefined,
      },
      customData: b.customData && typeof b.customData === 'object' && !Array.isArray(b.customData)
        ? (b.customData as Record<string, unknown>)
        : undefined,
    };
  }

  const event =
    (typeof b.event === 'string' && b.event) ||
    (typeof b.event_name === 'string' && b.event_name) ||
    '';

  const event_id = typeof b.event_id === 'string' ? b.event_id : undefined;
  const url =
    (typeof b.event_source_url === 'string' && b.event_source_url) ||
    (typeof b.url === 'string' && b.url) ||
    'https://www.valnix.com.br/checkout';

  const userData = {
    email: typeof b.email === 'string' ? b.email : undefined,
    phone: typeof b.phone === 'string' ? b.phone : undefined,
    fbc: typeof b.fbc === 'string' ? b.fbc : undefined,
    fbp: typeof b.fbp === 'string' ? b.fbp : undefined,
  };

  const customKeys = [
    'value',
    'currency',
    'order_id',
    'content_ids',
    'contents',
    'content_name',
    'content_type',
    'num_items',
    'first_name',
    'last_name',
    'external_id',
    'test_event_code',
  ] as const;
  const customData: Record<string, unknown> = {};
  for (const k of customKeys) {
    if (b[k] !== undefined) customData[k] = b[k];
  }

  return {
    event,
    event_id,
    url,
    userData,
    customData: Object.keys(customData).length ? customData : undefined,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { event, userData, customData, event_id, url } = normalizeRelayBody(req.body);

    if (!event) {
      return res.status(400).json({ error: 'Missing event / event_name' });
    }

    // 1. Log event to Firestore (use event_id as doc ID for easy lookup/replay)
    const eventRef = db.collection('analytics_events').doc(event_id || `err_${Date.now()}`);
    await eventRef.set({
      event_name: event,
      event_id,
      url,
      user_data: userData,
      custom_data: customData,
      timestamp: new Date().toISOString(),
      source: 'server-relay-vercel',
      status: 'pending'
    });

    // 2. Relay to Meta CAPI
    // Get credentials from Firestore
    const credsDoc = await db.collection('system_credentials').doc('meta_capi').get();
    const creds = credsDoc.data() || {};

    // Novo Pixel/Token (Março 2026) - Hardcoded para segurança máxima
    const HARDCODED_PIXEL_ID = '843361478785940';
    const HARDCODED_TOKEN = 'EAAXCTJFcZAckBRNKsxI3MuVp51Mv3IQVcMC6nZCv3JvqjAxeVC1ZCmPfa4AfiJFaXSRlmIHrFalKLxo0symr2jjjC00fzogCx63GZBadtsLHtQk0JeDK7nqs1EjVPPggKjBi0QZAUXM2ZAPY0qxdtYB01G8XcVvZAQqh3PedZC0ZAgz88yYZC1wdt4hghS4RVUWgZDZD';

    // Prioridade: Firestore > Env > Hardcoded
    // Mas se o do Firestore for um ID antigo/inválido (opcional, aqui apenas garantimos o fallback)
    const accessToken = creds.token || process.env.META_ACCESS_TOKEN || HARDCODED_TOKEN;
    const pixelId = creds.pixel_id || process.env.META_PIXEL_ID || HARDCODED_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('❌ [CAPI] Missing credentials:', { hasToken: !!accessToken, hasPixel: !!pixelId });
      await eventRef.update({ 
        status: 'failed', 
        error: 'Missing credentials',
        updatedAt: new Date().toISOString()
      });
      return res.status(200).json({ 
        success: true, 
        event_id, 
        warning: 'CAPI relay skipped due to missing credentials' 
      });
    }

    // Build Meta Payload with Hashed PII
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
      const metaRes = await axios.post(
        `https://graph.facebook.com/v17.0/${pixelId}/events`,
        metaPayload,
        { params: { access_token: accessToken } }
      );
      
      await eventRef.update({ 
        status: 'relayed', 
        meta_response: metaRes.data,
        updatedAt: new Date().toISOString()
      });
      
      if (process.env.NODE_ENV === 'development') console.log(`✅ [CAPI] Event ${event} relayed to Meta`);
    } catch (metaError: unknown) {
      const errorMsg = isAxiosError(metaError)
        ? metaError.response?.data ?? metaError.message
        : errorMessage(metaError);
      console.error('❌ [CAPI] Meta API Error:', errorMsg);

      const statusCode = isAxiosError(metaError) ? metaError.response?.status ?? 500 : 500;
      await eventRef.update({
        status: 'failed',
        error: errorMsg,
        status_code: statusCode,
        updatedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({ success: true, event_id });
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error('❌ [Relay] Unexpected error:', message);
    return res.status(500).json({ error: message });
  }
}

