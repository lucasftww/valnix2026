import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// UTMify Retry Cron – retries failed Purchase events (max 5 attempts)
// Called by pg_cron every 5 minutes

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UTMIFY_EVENTS_URL = 'https://tracking.utmify.com.br/tracking/v1/events';
const UTMIFY_PIXEL_ID = '6983b13f961e629ed63fae7a';
const FIREBASE_PROJECT_ID = 'valnix';

/** SHA-256 hash helper */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Firebase Service Account Auth (same as flowpay-pix) ──
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken;

  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!saKeyRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');

  const saKey = JSON.parse(saKeyRaw);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saKey.client_email, sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pemBody = saKey.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`Firebase auth failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  return cachedAccessToken!;
}

async function getFirestoreDoc(collection: string, docId: string) {
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const data = await response.json();
  return data.fields || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceRoleKey);

    // Fetch failed events with expired locks and attempt_count < 5
    const { data: failedEvents, error } = await supa
      .from('utmify_event_log')
      .select('*')
      .in('status', ['failed', 'pending'])
      .lt('attempt_count', 5)
      .or('locked_at.is.null,locked_at.lt.' + new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.error('❌ Failed to fetch retry candidates:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!failedEvents || failedEvents.length === 0) {
      console.log('✅ No events to retry');
      return new Response(JSON.stringify({ success: true, retried: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🔄 Found ${failedEvents.length} events to retry`);
    let retriedCount = 0;

    for (const event of failedEvents) {
      try {
        // Acquire atomic lock
        const { data: lockResult } = await supa.rpc('acquire_utmify_lock', {
          p_event_id: event.event_id,
          p_event_type: event.event_type,
          p_order_id: event.order_id,
          p_lock_ttl_seconds: 60,
        });

        const row = Array.isArray(lockResult) ? lockResult[0] : lockResult;
        if (!row?.lock_acquired || row.status === 'sent') {
          console.log(`⏭️ Skip ${event.event_id}: lock=${row?.lock_acquired}, status=${row?.status}`);
          continue;
        }

        // Extract orderId from event_id (format: Purchase_<orderId>)
        const orderId = event.event_id.replace('Purchase_', '');
        const isUpsell = orderId.startsWith('upsell-');

        // Rebuild payload from Firestore order data
        let value = 0;
        let clientIp: string | null = null;
        let clientUa: string | null = null;
        let email: string | null = null;
        let phone: string | null = null;
        let userId: string | null = null;
        let utmParams = '';

        if (!isUpsell) {
          const orderFields = await getFirestoreDoc('orders', orderId);
          if (!orderFields) {
            console.warn(`⚠️ Order ${orderId} not found in Firestore, marking as failed`);
            await supa.from('utmify_event_log').update({ 
              status: 'failed', locked_at: null, last_error: 'Order not found in Firestore',
              updated_at: new Date().toISOString(),
            }).eq('event_id', event.event_id);
            continue;
          }
          value = orderFields.total_amount?.doubleValue || orderFields.total_amount?.integerValue || 0;
          clientIp = orderFields.client_ip?.stringValue || null;
          clientUa = orderFields.client_ua?.stringValue || null;
          email = orderFields.customer_email?.stringValue || null;
          phone = orderFields.customer_phone?.stringValue || null;
          userId = orderFields.user_id?.stringValue || null;
          utmParams = orderFields.utm_parameters?.stringValue || '';
        } else {
          // Upsell: fetch from sale_addons
          const { data: addon } = await supa
            .from('sale_addons')
            .select('*')
            .eq('order_id', orderId.replace(/^upsell-/, '').replace(/-[^-]+$/, ''))
            .maybeSingle();
          if (addon) {
            value = Number(addon.amount);
            email = addon.customer_email;
            userId = addon.user_id;
          }
        }

        if (value <= 0) {
          console.warn(`⚠️ Zero value for ${event.event_id}, skipping`);
          await supa.from('utmify_event_log').update({ 
            locked_at: null, last_error: 'Zero value',
            updated_at: new Date().toISOString(),
          }).eq('event_id', event.event_id);
          continue;
        }

        // Build PII hashes
        const leadPii: Record<string, string> = {};
        if (email) leadPii.em = await sha256(email);
        if (phone) leadPii.ph = await sha256(phone.replace(/\D/g, ''));
        if (userId) leadPii.external_id = await sha256(userId);

        const payload = {
          type: 'Purchase',
          eventId: event.event_id,
          lead: {
            pixelId: UTMIFY_PIXEL_ID,
            userAgent: clientUa || 'server-retry',
            ip: clientIp || null,
            parameters: utmParams,
            icTextMatch: null, icCSSMatch: '.utmify-checkout', icURLMatch: null,
            leadTextMatch: null, addToCartTextMatch: null,
            ...leadPii,
          },
          event: {
            sourceUrl: 'https://valnix2026.lovable.app/checkout',
            pageTitle: 'Checkout - Valnix',
            value: Number(value),
            currency: 'BRL',
            orderId,
          },
          tikTokPageInfo: null,
        };

        console.log(`📊 Retry UTMify | ${event.event_id} | attempt=${row.attempt_count} | value=${value}`);

        const response = await fetch(UTMIFY_EVENTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const responseText = await response.text();

        if (response.ok) {
          await supa.from('utmify_event_log').update({ 
            status: 'sent', locked_at: null,
            updated_at: new Date().toISOString(),
          }).eq('event_id', event.event_id);
          console.log(`✅ Retry SUCCESS for ${event.event_id}`);
          retriedCount++;
        } else {
          const errorMsg = `HTTP ${response.status}: ${responseText.slice(0, 200)}`;
          await supa.from('utmify_event_log').update({ 
            locked_at: null, last_error: errorMsg,
            status: 'failed',
            updated_at: new Date().toISOString(),
          }).eq('event_id', event.event_id);
          console.warn(`❌ Retry FAILED for ${event.event_id}: ${errorMsg}`);
        }
      } catch (eventError) {
        console.error(`❌ Retry error for ${event.event_id}:`, eventError);
        await supa.from('utmify_event_log').update({ 
          locked_at: null, last_error: String(eventError),
          updated_at: new Date().toISOString(),
        }).eq('event_id', event.event_id);
      }
    }

    console.log(`🏁 Retry complete: ${retriedCount}/${failedEvents.length} succeeded`);
    return new Response(JSON.stringify({ success: true, retried: retriedCount, total: failedEvents.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ UTMify retry function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
