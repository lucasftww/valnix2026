import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { getFirebaseAccessToken, FIRESTORE_BASE } from '../_shared/firebase.ts';

const META_API_VERSION = 'v22.0';

// ── Helpers ───────────────────────────────────────────────────

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getFirestoreDoc(collection: string, docId: string, token: string) {
  const url = `${FIRESTORE_BASE}/${collection}/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const fields = data.fields || {};
  const obj: Record<string, any> = { id: docId };
  for (const [k, v] of Object.entries(fields)) {
    const val = (v as any).stringValue || (v as any).integerValue || (v as any).doubleValue || (v as any).booleanValue;
    obj[k] = val;
  }
  return obj;
}

// ── Main Handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const adminToken = req.headers.get('x-admin-token');
    if (!adminToken || !(await verifyAdminToken(adminToken))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    
    // Check if it's a DIRECT RELAY request
    if (body.resource === 'relay') {
      const { 
        event_name, event_id, order_id, value, currency = 'BRL', content_name, content_ids, 
        email, phone, first_name, last_name, external_id, test_event_code, event_time 
      } = body;

      if (!event_name) return new Response(JSON.stringify({ error: 'event_name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Fetch Credentials
      const fbToken = await getFirebaseAccessToken();
      const [metaTokenDoc, metaPixelDoc] = await Promise.all([
        getFirestoreDoc('system_credentials', 'META_ACCESS_TOKEN', fbToken),
        getFirestoreDoc('system_credentials', 'META_PIXEL_ID', fbToken)
      ]);

      const activeToken = metaTokenDoc?.value || Deno.env.get('META_ACCESS_TOKEN');
      const activePixel = metaPixelDoc?.value || Deno.env.get('META_PIXEL_ID');

      if (!activeToken || !activePixel) {
        return new Response(JSON.stringify({ error: 'CAPI credentials missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Build User Data
      const userData: Record<string, any> = {
        client_ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '0.0.0.0',
        client_user_agent: req.headers.get('user-agent') || 'unknown',
        country: await sha256('br')
      };

      if (email) userData.em = await sha256(email);
      if (phone) {
        let ph = phone.replace(/\D/g, '');
        if (!ph.startsWith('55') && ph.length >= 10) ph = '55' + ph;
        userData.ph = await sha256(ph);
      }
      if (first_name) userData.fn = await sha256(first_name);
      if (last_name) userData.ln = await sha256(last_name);
      if (external_id) userData.external_id = await sha256(external_id);

      const eventPayload: Record<string, any> = {
        event_name,
        event_time: event_time ? Number(event_time) : Math.floor(Date.now() / 1000),
        event_id: event_id || `mig_${event_name}_${order_id || Date.now()}`,
        action_source: 'website',
        event_source_url: 'https://www.valnix.com.br',
        user_data: userData,
      };

      if (value !== undefined) {
        eventPayload.custom_data = {
          value: Number(value),
          currency,
          content_name,
          content_ids: Array.isArray(content_ids) ? content_ids : undefined,
        };
      }

      const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${activePixel}/events?access_token=${activeToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventPayload], test_event_code })
      });

      const metaData = await metaRes.json();
      return new Response(JSON.stringify({ success: metaRes.ok, data: metaData, version: 'v1.44-relay' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ORIGINAL RETRO-COMPATIBILITY LOGIC
    return new Response(JSON.stringify({ error: 'Invalid legacy resource' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
