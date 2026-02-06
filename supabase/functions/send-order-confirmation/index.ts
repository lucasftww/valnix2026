import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  delivery_code: string | null;
}

interface EmailRequest {
  customer_name: string;
  customer_email: string;
  order_id: string;
  items: OrderItem[];
  total_amount: number;
}

function generateEmailHTML(data: EmailRequest, siteUrl: string): string {
  const itemsHTML = data.items.map(item => {
    const codes = item.delivery_code ? item.delivery_code.split(',') : [];
    const codesHTML = codes.length > 0 ? `
      <div style="margin-top: 12px; padding: 12px; background-color: #f0fdf4; border-radius: 6px; border: 1px solid #86efac;">
        <p style="color: #15803d; font-size: 13px; font-weight: 600; margin: 0 0 6px 0;">🎫 Código(s) de Entrega:</p>
        <code style="display: block; padding: 12px; background-color: #ffffff; border-radius: 4px; border: 1px solid #d1d5db; color: #1f2937; font-size: 14px; font-family: monospace; white-space: pre-wrap; word-break: break-all;">${codes.join('\n')}</code>
      </div>
    ` : '';

    return `
      <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
        <p style="color: #111; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;"><strong>${item.product_name}</strong></p>
        <p style="color: #666; font-size: 14px; margin: 4px 0;">Quantidade: ${item.quantity}x | Valor unitário: R$ ${item.unit_price.toFixed(2)}</p>
        ${codesHTML}
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif;">
        <div style="background-color: #ffffff; margin: 0 auto; padding: 20px 0 48px; margin-bottom: 64px; max-width: 600px;">
          
          <h1 style="color: #333; font-size: 28px; font-weight: bold; margin: 40px 0 20px; padding: 0 40px; line-height: 1.4;">✅ Pagamento Confirmado!</h1>
          
          <p style="color: #333; font-size: 16px; line-height: 26px; margin: 16px 0; padding: 0 40px;">
            Olá <strong>${data.customer_name}</strong>,
          </p>
          
          <p style="color: #333; font-size: 16px; line-height: 26px; margin: 16px 0; padding: 0 40px;">
            Seu pedido <strong>#${data.order_id.slice(0, 8).toUpperCase()}</strong> foi confirmado e já está sendo processado!
          </p>

          <div style="padding: 24px 40px; background-color: #f9fafb; margin: 20px 0;">
            <h2 style="color: #333; font-size: 20px; font-weight: bold; margin: 20px 0 15px;">📦 Detalhes do Pedido</h2>
            
            ${itemsHTML}

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            
            <p style="font-size: 18px; color: #111; margin: 16px 0 0 0; text-align: right;">
              <strong>Total:</strong> R$ ${data.total_amount.toFixed(2)}
            </p>
          </div>

          <p style="color: #333; font-size: 16px; line-height: 26px; margin: 16px 0; padding: 0 40px;">
            Você pode acompanhar seu pedido a qualquer momento:
          </p>

          <a href="${siteUrl}/my-orders" target="_blank" style="background-color: #dc2626; border-radius: 8px; color: #fff; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; display: block; padding: 14px 20px; margin: 24px 40px;">
            Ver Meus Pedidos
          </a>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 40px;">

          <p style="color: #666; font-size: 14px; line-height: 24px; margin: 24px 0; padding: 0 40px; text-align: center;">
            Dúvidas? Entre em contato conosco pelo WhatsApp.
            <br><br>
            <a href="${siteUrl}" target="_blank" style="color: #dc2626; text-decoration: underline;">Valnix Store</a>
          </p>

        </div>
      </body>
    </html>
  `;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error("Missing or invalid Authorization header");
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Validate JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error("JWT validation failed:", claimsError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;
    console.log("Authenticated user:", userId);

    const requestData: EmailRequest = await req.json();

    // Use service role to verify order ownership
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('user_id, payment_status')
      .eq('id', requestData.order_id)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the authenticated user owns the order
    if (order.user_id !== userId) {
      console.error("Access denied: user does not own order");
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify payment is confirmed
    if (order.payment_status !== 'paid') {
      console.error("Order payment not confirmed");
      return new Response(
        JSON.stringify({ error: 'Payment not confirmed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Sending order confirmation email to:', requestData.customer_email);

    // Get site URL from environment
    const siteUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://valnix.lovable.app';

    // Generate email HTML
    const html = generateEmailHTML(requestData, siteUrl);

    // Send email using SMTP
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST!,
        port: SMTP_PORT,
        tls: true,
        auth: {
          username: SMTP_USER!,
          password: SMTP_PASSWORD!,
        },
      },
    });

    await client.send({
      from: `Valnix Store <${SMTP_USER}>`,
      to: requestData.customer_email,
      subject: `Pedido Confirmado - #${requestData.order_id.slice(0, 8).toUpperCase()}`,
      html: html.replace(/\s+/g, ' ').replace(/>\s+</g, '><'),
    });

    await client.close();
    console.log("Email sent successfully");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-order-confirmation function:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);