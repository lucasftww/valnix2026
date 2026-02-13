import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FLOWPAY_CARD_URL = 'https://flowpayments.net/api/card';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const apiKey = Deno.env.get('FLOWPAY_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FlowPay API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CREATE card charge
    if (action === 'create' && req.method === 'POST') {
      const body = await req.json();
      const { amount, orderId, description, customer } = body;

      if (!amount || amount < 100) {
        return new Response(
          JSON.stringify({ success: false, error: 'Valor mínimo é R$ 1,00 (100 centavos)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const flowpayResponse = await fetch(`${FLOWPAY_CARD_URL}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          value: amount,
          description: description || `Pedido ${orderId?.substring(0, 8) || 'VALNIX'}`,
          customer: customer ? {
            name: customer.name || undefined,
            email: customer.email || undefined,
            phone: customer.phone || undefined,
            taxId: customer.taxId || undefined,
          } : undefined,
        }),
      });

      const flowpayData = await flowpayResponse.json();

      if (!flowpayResponse.ok || !flowpayData.success) {
        console.error('FlowPay card create error:', flowpayData);
        return new Response(
          JSON.stringify({ success: false, error: flowpayData.error || 'Erro ao criar cobrança de cartão' }),
          { status: flowpayResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          paymentId: flowpayData.payment.id,
          paymentUrl: flowpayData.payment.paymentUrl,
          status: flowpayData.payment.status,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CHECK STATUS
    if (action === 'status' && req.method === 'GET') {
      const paymentId = url.searchParams.get('id');
      if (!paymentId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Payment ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const statusResponse = await fetch(`${FLOWPAY_CARD_URL}/status?id=${paymentId}`, {
        headers: { 'x-api-key': apiKey },
      });

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        return new Response(
          JSON.stringify({ success: false, error: statusData.error || 'Erro ao consultar status' }),
          { status: statusResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: statusData.payment?.status,
          paidAt: statusData.payment?.paidAt || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action. Use ?action=create or ?action=status&id=...' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('FlowPay card error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
