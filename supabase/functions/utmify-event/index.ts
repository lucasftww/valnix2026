import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// UTMify Event Edge Function
// Sends sale events to UTMify API for attribution tracking

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UTMIFY_API_URL = 'https://api.utmify.com.br/api-credentials/orders';

interface UtmifyOrderPayload {
  orderId: string;
  platform: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
  approvedDate?: string;
  refundedAt?: string;
  customer: {
    name?: string;
    email?: string;
    phone: string | null;
    document: string | null;
  };
  product: {
    id?: string;
    name?: string;
    planId: string;
    planName: string;
    quantity: number;
    price: number;
    priceInCents: number;
  };
  trackingParameters: {
    src?: string;
    sck?: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
  };
  commission: {
    amount?: number;
    currency?: string;
    totalPriceInCents: number;
    gatewayFeeInCents: number;
    userCommissionInCents: number;
  };
}

async function sendToUtmify(payload: UtmifyOrderPayload): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const apiToken = Deno.env.get('UTMIFY_API_TOKEN');
  if (!apiToken) {
    console.error('❌ UTMIFY_API_TOKEN not configured');
    return { success: false, error: 'UTMIFY_API_TOKEN not configured' };
  }

  try {
    const response = await fetch(UTMIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': apiToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.text();

    if (!response.ok) {
      console.error(`❌ UTMify API error (${response.status}):`, data);
      return { success: false, error: data, statusCode: response.status };
    }

    console.log('✅ UTMify event sent:', data);
    return { success: true, statusCode: response.status };
  } catch (error) {
    console.error('❌ UTMify fetch error:', error);
    return { success: false, error: String(error) };
  }
}

async function logEvent(
  eventId: string,
  eventType: string,
  orderId: string | null,
  result: { success: boolean; error?: string; statusCode?: number }
) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Use acquire_utmify_lock to prevent duplicates
    const { data: lockData } = await supabase.rpc('acquire_utmify_lock', {
      p_event_id: eventId,
      p_event_type: eventType,
      p_order_id: orderId,
    });

    if (lockData?.[0] && !lockData[0].out_lock_acquired) {
      console.log(`ℹ️ UTMify event ${eventId} already processed (status: ${lockData[0].out_status})`);
      return false; // Already processed
    }

    // Update status based on result
    if (result.success) {
      await supabase
        .from('utmify_event_log')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('event_id', eventId);
    } else {
      await supabase
        .from('utmify_event_log')
        .update({ status: 'failed', last_error: result.error || null, updated_at: new Date().toISOString() })
        .eq('event_id', eventId);
    }

    return true; // Proceed with sending
  } catch (e) {
    console.warn('⚠️ UTMify log failed:', e);
    return true; // Still try to send
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      order_id,
      event_type = 'Purchase',
      value,
      customer_name,
      customer_email,
      customer_phone,
      customer_document,
      product_name,
      product_id,
      payment_method = 'pix',
      // UTM parameters
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      src,
      sck,
    } = body;

    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const eventId = `${event_type}_${order_id}`;

    // Check lock / dedup
    const shouldProceed = await logEvent(eventId, event_type, order_id, { success: false });
    if (!shouldProceed) {
      return new Response(JSON.stringify({ success: true, message: 'Already processed', event_id: eventId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map status based on event type
    const statusMap: Record<string, string> = {
      'Purchase': 'paid',
      'Refund': 'refunded',
      'Chargeback': 'charged_back',
    };

    const now = new Date().toISOString();

    const priceInCents = Math.round((Number(value) || 0) * 100);

    const payload: UtmifyOrderPayload = {
      orderId: order_id,
      platform: 'valnix',
      paymentMethod: payment_method,
      status: statusMap[event_type] || 'paid',
      createdAt: now,
      approvedDate: event_type === 'Purchase' ? now : undefined,
      refundedAt: event_type === 'Refund' ? now : undefined,
      customer: {
        name: customer_name || undefined,
        email: customer_email || undefined,
        phone: customer_phone || null,
        document: customer_document || null,
      },
      product: {
        id: product_id || order_id,
        name: product_name || 'Pedido VALNIX',
        planId: product_id || order_id,
        planName: product_name || 'Pedido VALNIX',
        quantity: 1,
        price: Number(value) || 0,
        priceInCents,
      },
      trackingParameters: {
        src: src || undefined,
        sck: sck || undefined,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        utm_term: utm_term || null,
      },
      commission: {
        amount: Number(value) || 0,
        currency: 'BRL',
        totalPriceInCents: priceInCents,
        gatewayFeeInCents: 0,
        userCommissionInCents: priceInCents,
      },
    };

    console.log(`📡 Sending ${event_type} to UTMify (order: ${order_id})`);

    const result = await sendToUtmify(payload);

    // Update log with result
    await logEvent(eventId, event_type, order_id, result);

    return new Response(JSON.stringify({
      success: result.success,
      event_id: eventId,
      ...(result.error ? { error: result.error } : {}),
    }), {
      status: result.success ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ UTMify event error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
