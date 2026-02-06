import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  email: string;
  name?: string;
}

function generateWelcomeEmailHTML(name: string, siteUrl: string): string {
  const displayName = name || "Cliente";
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bem-vindo à Valnix</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);">
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold;">
                      Valnix
                    </h1>
                    <p style="margin: 10px 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">
                      Sua loja de confiança
                    </p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 24px;">
                      🎉 Bem-vindo à Valnix!
                    </h2>
                    <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                      Olá <strong>${displayName}</strong>,
                    </p>
                    <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                      Estamos muito felizes em ter você conosco! Sua conta foi criada com sucesso e você já pode aproveitar todos os nossos produtos e benefícios.
                    </p>
                    
                    <div style="background-color: #f9fafb; border-left: 4px solid #dc2626; padding: 20px; margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #1f2937; font-size: 18px;">
                        O que você pode fazer agora:
                      </h3>
                      <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 15px; line-height: 1.8;">
                        <li>Explorar nosso catálogo completo de produtos</li>
                        <li>Adicionar seus favoritos ao carrinho</li>
                        <li>Aproveitar ofertas exclusivas</li>
                        <li>Receber seus produtos digitalmente de forma instantânea</li>
                      </ul>
                    </div>
                    
                    <!-- Button -->
                    <table role="presentation" style="margin: 30px auto;">
                      <tr>
                        <td style="border-radius: 8px; background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);">
                          <a href="${siteUrl}" style="display: inline-block; padding: 16px 40px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 8px;">
                            Começar a Comprar
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="margin: 30px 0 0; color: #6b7280; font-size: 14px; line-height: 1.6; text-align: center;">
                      Precisa de ajuda? Entre em contato conosco pelo WhatsApp ou Discord.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                      © 2024 Valnix. Todos os direitos reservados.
                      <br><br>
                      <a href="${siteUrl}" target="_blank" style="color: #dc2626; text-decoration: underline;">Visitar Site</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestData: WelcomeEmailRequest = await req.json();

    console.log('Sending welcome email to:', requestData.email);

    // Get site URL
    const siteUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://valnix.lovable.app';

    // Generate email HTML
    const html = generateWelcomeEmailHTML(requestData.name || '', siteUrl);

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
      from: `Valnix <${SMTP_USER}>`,
      to: requestData.email,
      subject: "Bem-vindo à Valnix!",
      html: html.replace(/\s+/g, ' ').replace(/>\s+</g, '><'),
    });

    await client.close();
    console.log("Welcome email sent successfully");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-welcome-email function:", error);
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
