import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD");

// Firebase configuration
const FIREBASE_PROJECT_ID = "valnix-a2755";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface DeliveryEmailRequest {
  customerEmail: string;
  customerName: string;
  productName: string;
  deliveryCode: string;
  orderId: string;
  userId?: string; // Firebase UID of the admin making the request
}

// Simple function to verify Firebase user is admin via Firestore REST API
async function isFirebaseAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${userId}`;
    const response = await fetch(firestoreUrl);
    
    if (!response.ok) {
      console.log("User role not found for:", userId);
      return false;
    }
    
    const doc = await response.json();
    const role = doc?.fields?.role?.stringValue;
    console.log("User role for", userId, ":", role);
    return role === "admin";
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

// Verify order exists in Firestore
async function getFirestoreOrder(orderId: string): Promise<{ user_id: string; payment_status: string; customer_email: string } | null> {
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${orderId}`;
    const response = await fetch(firestoreUrl);
    
    if (!response.ok) {
      console.log("Order not found:", orderId);
      return null;
    }
    
    const doc = await response.json();
    return {
      user_id: doc?.fields?.user_id?.stringValue || "",
      payment_status: doc?.fields?.payment_status?.stringValue || "pending",
      customer_email: doc?.fields?.customer_email?.stringValue || "",
    };
  } catch (error) {
    console.error("Error fetching order:", error);
    return null;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { customerEmail, customerName, productName, deliveryCode, orderId, userId }: DeliveryEmailRequest = await req.json();

    // Validate required fields
    if (!orderId || !customerEmail || !deliveryCode || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields (orderId, customerEmail, deliveryCode, userId)" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Processing delivery code request for order:", orderId, "by user:", userId);

    // Verify the order exists in Firestore
    const order = await getFirestoreOrder(orderId);
    if (!order) {
      console.error("Order not found:", orderId);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if user is an admin via Firestore
    const isAdmin = await isFirebaseAdmin(userId);

    if (order.user_id !== userId && !isAdmin) {
      console.error("User does not own this order. User:", userId, "Order owner:", order.user_id);
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify order is paid
    if (order.payment_status !== "paid") {
      console.error("Order is not paid:", orderId, "Status:", order.payment_status);
      return new Response(
        JSON.stringify({ error: "Order not paid" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Sending delivery code email to:", customerEmail, "for order:", orderId);

    const codes = deliveryCode.split(',').map(c => c.trim()).filter(c => c);
    const codesHtml = codes.map((code, index) => `
      <div style="background: #f5f5f5; border: 2px solid #EE4444; border-radius: 8px; padding: 12px; margin: 8px 0; font-family: 'Courier New', monospace;">
        <strong style="color: #EE4444;">${index + 1}.</strong> <strong style="font-size: 16px; color: #000;">${code}</strong>
      </div>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #000000; color: #ffffff;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 40px;">
              <h1 style="color: #EE4444; font-size: 32px; margin: 0; font-weight: bold;">VALNIX</h1>
              <p style="color: #999; margin: 10px 0 0 0; font-size: 14px;">Sua loja de créditos digitais</p>
            </div>

            <div style="background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%); border: 2px solid #EE4444; border-radius: 16px; padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="font-size: 48px; margin-bottom: 10px;">🎮</div>
                <h2 style="color: #ffffff; margin: 0; font-size: 24px;">Seu Pedido Está Pronto!</h2>
                <p style="color: #999; margin: 10px 0 0 0; font-size: 14px;">Pedido #${orderId.slice(0, 8)}</p>
              </div>

              <div style="background: rgba(238, 68, 68, 0.1); border-radius: 12px; padding: 25px; margin: 25px 0;">
                <p style="color: #ffffff; margin: 0 0 5px 0; font-size: 14px; font-weight: bold;">Olá ${customerName}!</p>
                <p style="color: #cccccc; margin: 0; font-size: 14px; line-height: 1.6;">
                  Seu produto <strong style="color: #EE4444;">${productName}</strong> foi entregue com sucesso!
                </p>
              </div>

              <div style="margin: 30px 0;">
                <h3 style="color: #EE4444; font-size: 18px; margin: 0 0 15px 0; text-align: center; font-weight: bold;">
                  🎁 ${codes.length > 1 ? 'Seus Códigos' : 'Seu Código'}
                </h3>
                ${codesHtml}
              </div>

              <div style="background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px; margin-top: 25px;">
                <p style="color: #EE4444; margin: 0 0 10px 0; font-size: 14px; font-weight: bold;">📋 Instruções:</p>
                <ul style="color: #cccccc; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                  <li>Copie o${codes.length > 1 ? 's código(s)' : ' código'} acima</li>
                  <li>Use ${codes.length > 1 ? 'cada um' : 'o código'} conforme as instruções do jogo</li>
                  <li>Em caso de dúvidas, entre em contato conosco</li>
                </ul>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <a href="https://gg-replica-clone.lovable.app/my-orders" 
                   style="display: inline-block; background-color: #EE4444; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Ver Meu Pedido
                </a>
              </div>
            </div>

            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid #333;">
              <p style="color: #666; font-size: 12px; margin: 0 0 10px 0;">
                Você está recebendo este e-mail porque realizou uma compra na VALNIX
              </p>
              <p style="color: #666; font-size: 12px; margin: 0;">
                © 2025 VALNIX - Todos os direitos reservados
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

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
      from: `VALNIX <${SMTP_USER}>`,
      to: customerEmail,
      subject: `🎮 Seu Código de Entrega - Pedido #${orderId.slice(0, 8)}`,
      html: htmlContent,
    });

    await client.close();

    console.log("Delivery code email sent successfully to:", customerEmail, "by user:", userId);

    return new Response(
      JSON.stringify({ success: true, message: "Email enviado com sucesso" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending delivery code email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
