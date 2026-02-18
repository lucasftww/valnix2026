import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { getFirestoreDoc, createFirestoreDoc } from '../_shared/firestore.ts';
import { checkRateLimitFirestore, logRateLimitBlock } from '../_shared/rate-limit.ts';
import { parsePublicIp, sha256Short } from '../_shared/utils.ts';

const UTMIFY_API_URL = 'https://api.utmify.com.br/api-credentials/orders';

// ── Firestore set doc (PATCH = upsert) ──
async function setFirestoreDoc(col: string, docId: string, data: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) fields[k] = { nullValue: null };
    else if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields }) });
  return res.ok;
}

interface UtmifyOrderPayload {
  orderId: string; platform: string; paymentMethod: string; status: string;
  createdAt: string; approvedDate?: string; refundedAt?: string;
  customer: { name?: string; email?: string; phone: string | null; document: string | null };
  product: { id?: string; name?: string; planId: string; planName: string; quantity: number; price: number; priceInCents: number };
  trackingParameters: { src?: string; sck?: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null };
  commission: { amount?: number; currency?: string; totalPriceInCents: number; gatewayFeeInCents: number; userCommissionInCents: number };
}

async function sendToUtmify(payload: UtmifyOrderPayload): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const apiToken = Deno.env.get('UTMIFY_API_TOKEN');
  if (!apiToken) return { success: false, error: 'UTMIFY_API_TOKEN not configured' };
  try {
    const response = await fetch(UTMIFY_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-token': apiToken }, body: JSON.stringify(payload) });
    const data = await response.text();
    if (!response.ok) { console.error(`❌ UTMify API error (${response.status}):`, data); return { success: false, error: data, statusCode: response.status }; }
    console.log('✅ UTMify event sent:', data);
    return { success: true, statusCode: response.status };
  } catch (error) { console.error('❌ UTMify fetch error:', error); return { success: false, error: String(error) }; }
}

async function acquireLock(eventId: string, eventType: string, orderId: string | null): Promise<boolean> {
  try {
    const existing = await getFirestoreDoc('utmify_event_log', eventId);
    if (existing) {
      const status = existing.fields?.status?.stringValue;
      if (status === 'sent') { console.log(`ℹ️ UTMify event ${eventId} already sent, skipping`); return false; }
      const attemptCount = existing.fields?.attempt_count?.doubleValue || existing.fields?.attempt_count?.integerValue || 0;
      await setFirestoreDoc('utmify_event_log', eventId, { event_id: eventId, event_type: eventType, order_id: orderId, status: 'pending', attempt_count: Number(attemptCount) + 1, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return true;
    }
    await setFirestoreDoc('utmify_event_log', eventId, { event_id: eventId, event_type: eventType, order_id: orderId, status: 'pending', attempt_count: 1, locked_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return true;
  } catch (e) { console.warn('⚠️ UTMify lock error:', e); return true; }
}

async function updateLockStatus(eventId: string, result: { success: boolean; error?: string }) {
  try { await setFirestoreDoc('utmify_event_log', eventId, { status: result.success ? 'sent' : 'failed', last_error: result.error || null, updated_at: new Date().toISOString() }); } catch (e) { console.warn('⚠️ UTMify lock update failed:', e); }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const clientIp = parsePublicIp(req.headers.get('x-forwarded-for') || undefined);
  const ipRl = await checkRateLimitFirestore(`utmify_ip_${clientIp}`, 60, 60_000, 300_000);
  if (!ipRl.allowed) {
    await logRateLimitBlock('utmify-event-ip', clientIp, ipRl.attempts);
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const { order_id, event_type = 'Purchase', value, customer_name, customer_email, customer_phone, customer_document, product_name, product_id, payment_method = 'pix', utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, sck } = body;
    if (!order_id) return new Response(JSON.stringify({ error: 'order_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const fingerprintParts = [utm_source || '', utm_campaign || '', customer_email || '', order_id || ''].join('|');
    if (fingerprintParts.length > 1) {
      const fpHash = await sha256Short(fingerprintParts);
      const fpKey = `utmify_fp_${fpHash}`;
      const fpRl = await checkRateLimitFirestore(fpKey, 10, 60_000, 300_000);
      if (!fpRl.allowed) {
        await logRateLimitBlock('utmify-event-fingerprint', `${clientIp}|fp:${fpKey}`, fpRl.attempts);
        return new Response(JSON.stringify({ error: 'Too many requests (fingerprint)' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const eventId = `${event_type}_${order_id}`;
    const shouldProceed = await acquireLock(eventId, event_type, order_id);
    if (!shouldProceed) return new Response(JSON.stringify({ success: true, message: 'Already processed', event_id: eventId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const statusMap: Record<string, string> = { 'Purchase': 'paid', 'Refund': 'refunded', 'Chargeback': 'charged_back' };
    const now = new Date().toISOString();
    const priceInCents = Math.round((Number(value) || 0) * 100);

    const payload: UtmifyOrderPayload = {
      orderId: order_id, platform: 'valnix', paymentMethod: payment_method,
      status: statusMap[event_type] || 'paid', createdAt: now,
      approvedDate: event_type === 'Purchase' ? now : undefined, refundedAt: event_type === 'Refund' ? now : undefined,
      customer: { name: customer_name || undefined, email: customer_email || undefined, phone: customer_phone || null, document: customer_document || null },
      product: { id: product_id || order_id, name: product_name || 'Pedido VALNIX', planId: product_id || order_id, planName: product_name || 'Pedido VALNIX', quantity: 1, price: Number(value) || 0, priceInCents },
      trackingParameters: { src: src || undefined, sck: sck || undefined, utm_source: utm_source || null, utm_medium: utm_medium || null, utm_campaign: utm_campaign || null, utm_content: utm_content || null, utm_term: utm_term || null },
      commission: { amount: Number(value) || 0, currency: 'BRL', totalPriceInCents: priceInCents, gatewayFeeInCents: 0, userCommissionInCents: priceInCents },
    };

    console.log(`📡 Sending ${event_type} to UTMify (order: ${order_id})`);
    const result = await sendToUtmify(payload);
    await updateLockStatus(eventId, result);

    return new Response(JSON.stringify({ success: result.success, event_id: eventId, ...(result.error ? { error: result.error } : {}) }), {
      status: result.success ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ UTMify error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
