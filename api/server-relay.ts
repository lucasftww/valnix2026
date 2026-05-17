import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_utils/supabase.js';
import {
  errorMessage,
  hashData,
  setCorsHeaders,
  verifyAdminToken,
  verifyInternalSignature,
  rateLimit,
  clientIp,
} from './_utils/helpers.js';
import axios, { isAxiosError } from 'axios';

function firstXff(req: VercelRequest): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).split(',')[0].trim();
  return undefined;
}

/** Accepts nested `{ event, userData, customData }` or flat payloads. */
function normalizeRelayBody(raw: unknown): {
  event: string;
  event_id: string | undefined;
  url: string;
  userData: { email?: string; phone?: string; fbc?: string; fbp?: string };
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
      customData:
        b.customData && typeof b.customData === 'object' && !Array.isArray(b.customData)
          ? (b.customData as Record<string, unknown>)
          : undefined,
    };
  }

  const event = (typeof b.event === 'string' && b.event) || (typeof b.event_name === 'string' && b.event_name) || '';
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
    'value', 'currency', 'order_id', 'content_ids', 'contents', 'content_name',
    'content_type', 'num_items', 'first_name', 'last_name', 'external_id', 'test_event_code',
  ] as const;
  const customData: Record<string, unknown> = {};
  for (const k of customKeys) if (b[k] !== undefined) customData[k] = b[k];

  return {
    event,
    event_id,
    url,
    userData,
    customData: Object.keys(customData).length ? customData : undefined,
  };
}

async function getMetaCredentials(): Promise<{ accessToken: string; pixelId: string } | null> {
  // Priority: Supabase system_credentials → env vars
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Public path rate-limit (the storefront fires high-volume tracking) ──
  const ip = clientIp(req);
  if (!rateLimit(`relay:${ip}`, 120, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // ── Lite relay (no DB log) — internal only ───────────────────────────
  // Used by admin-data?resource=capi-replay. Requires either an admin token
  // (replay UI) or an internal signature (server-to-server). Without this
  // gate, anyone could pump our Meta pixel with fake events.
  const action = typeof req.query.action === 'string' ? req.query.action : '';
  if (action === 'lite') {
    const adminTok = (req.headers['x-admin-token'] as string) || '';
    const internalSig = (req.headers['x-internal-signature'] as string) || '';
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (!verifyAdminToken(adminTok) && !verifyInternalSignature(internalSig, rawBody)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { event, userData, customData, event_id, url } = normalizeRelayBody(req.body);
      const creds = await getMetaCredentials();
      if (!creds) return res.status(500).json({ error: 'Meta CAPI credentials not configured' });
      const metaPayload = {
        data: [{
          event_name: event,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: url,
          event_id,
          user_data: {
            em: hashData(userData?.email?.trim().toLowerCase()),
            ph: hashData(userData?.phone?.trim().replace(/\D/g, '')),
            client_ip_address: firstXff(req) || req.socket.remoteAddress,
            client_user_agent: req.headers['user-agent'],
            fbc: userData?.fbc,
            fbp: userData?.fbp,
          },
          custom_data: customData,
        }],
      };
      try {
        await axios.post(
          `https://graph.facebook.com/v17.0/${creds.pixelId}/events`,
          metaPayload,
          { params: { access_token: creds.accessToken } },
        );
        return res.status(200).json({ success: true, event_id });
      } catch (metaError: unknown) {
        const details = isAxiosError(metaError) ? metaError.response?.data ?? metaError.message : errorMessage(metaError);
        if (process.env.NODE_ENV !== 'production') console.error('[server-relay] lite meta error:', details);
        return res.status(502).json({ error: 'Meta API reported an error' });
      }
    } catch (error: unknown) {
      console.error('[server-relay] lite error:', errorMessage(error));
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  try {
    const { event, userData, customData, event_id, url } = normalizeRelayBody(req.body);
    if (!event) return res.status(400).json({ error: 'Missing event / event_name' });

    // 1. Log event in analytics_events (upsert by event_id for replay)
    const eventIdSafe = event_id || `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseRow = {
      event_id: eventIdSafe,
      event_name: event,
      url,
      user_data: userData as never,
      custom_data: (customData ?? null) as never,
      source: 'server-relay-vercel',
      status: 'pending' as const,
      timestamp: new Date().toISOString(),
    };
    const { error: insertErr } = await supabaseAdmin
      .from('analytics_events')
      .upsert(baseRow as never, { onConflict: 'event_id' });
    if (insertErr && process.env.NODE_ENV !== 'production') {
      console.error('analytics_events upsert error:', insertErr.message);
    }

    // 2. Resolve Meta credentials
    const creds = await getMetaCredentials();
    if (!creds) {
      await supabaseAdmin
        .from('analytics_events')
        .update({ status: 'failed', error: 'Missing credentials', updated_at: new Date().toISOString() } as never)
        .eq('event_id', eventIdSafe);
      return res.status(200).json({
        success: true,
        event_id: eventIdSafe,
        warning: 'CAPI relay skipped due to missing credentials',
      });
    }

    // 3. Send to Meta
    const metaPayload = {
      data: [
        {
          event_name: event,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: url,
          event_id: eventIdSafe,
          user_data: {
            em: hashData(userData?.email?.trim().toLowerCase()),
            ph: hashData(userData?.phone?.trim().replace(/\D/g, '')),
            client_ip_address: firstXff(req) || req.socket.remoteAddress,
            client_user_agent: req.headers['user-agent'],
            fbc: userData?.fbc,
            fbp: userData?.fbp,
          },
          custom_data: customData,
        },
      ],
    };

    try {
      const metaRes = await axios.post(
        `https://graph.facebook.com/v17.0/${creds.pixelId}/events`,
        metaPayload,
        { params: { access_token: creds.accessToken } },
      );
      await supabaseAdmin
        .from('analytics_events')
        .update({
          status: 'relayed',
          meta_response: metaRes.data as never,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('event_id', eventIdSafe);
    } catch (metaError: unknown) {
      const errorMsg = isAxiosError(metaError)
        ? (metaError.response?.data ?? metaError.message)
        : errorMessage(metaError);
      const statusCode = isAxiosError(metaError) ? metaError.response?.status ?? 500 : 500;
      await supabaseAdmin
        .from('analytics_events')
        .update({
          status: 'failed',
          error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg),
          status_code: statusCode,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('event_id', eventIdSafe);
      if (process.env.NODE_ENV !== 'production') console.error('[CAPI] Meta API error:', errorMsg);
    }

    return res.status(200).json({ success: true, event_id: eventIdSafe });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (process.env.NODE_ENV !== 'production') console.error('[Relay] Unexpected error:', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
