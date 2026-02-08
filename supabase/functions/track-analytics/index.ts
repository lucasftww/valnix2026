import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const VALID_EVENTS = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase', 'Lead'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { event_name, user_id, page_url, device_type, browser, value, currency, order_id, content_name, content_category } = body;

    // Validate event name
    if (!event_name || !VALID_EVENTS.includes(event_name)) {
      return new Response(JSON.stringify({ error: 'Invalid event_name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate inputs
    if (value !== undefined && value !== null && (typeof value !== 'number' || value < 0 || value > 1000000)) {
      return new Response(JSON.stringify({ error: 'Invalid value' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order_id && (typeof order_id !== 'string' || order_id.length > 100)) {
      return new Response(JSON.stringify({ error: 'Invalid order_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase.from('analytics_events').insert({
      event_name,
      event_time: new Date().toISOString(),
      user_id: typeof user_id === 'string' ? user_id.slice(0, 100) : null,
      page_url: typeof page_url === 'string' ? page_url.slice(0, 500) : null,
      device_type: typeof device_type === 'string' ? device_type.slice(0, 20) : null,
      browser: typeof browser === 'string' ? browser.slice(0, 30) : null,
      value: value || null,
      currency: value ? (currency || 'BRL') : null,
      order_id: order_id || null,
      content_name: typeof content_name === 'string' ? content_name.slice(0, 200) : null,
      content_category: typeof content_category === 'string' ? content_category.slice(0, 100) : null,
    });

    if (error) {
      console.error('❌ Analytics insert failed:', error);
      return new Response(JSON.stringify({ error: 'Failed to track event' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Track analytics error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
