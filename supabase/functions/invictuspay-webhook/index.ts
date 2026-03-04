import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';

// Proxy: forwards InvictusPay postbacks to invictuspay-pix?action=webhook
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: 'authorization, x-client-info, apikey, content-type' });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.text();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invictuspay-pix?action=webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('❌ Proxy error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
