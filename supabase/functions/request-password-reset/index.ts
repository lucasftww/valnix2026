import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ResetRequest {
  email: string;
  siteUrl?: string;
}

const generateToken = () => {
  return crypto.randomUUID() + "-" + Date.now().toString(36);
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, siteUrl }: ResetRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email é obrigatório" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Buscar usuário no auth usando admin API
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.error("Erro ao buscar usuários:", authError);
      // Retorna sucesso por segurança mesmo com erro
      return new Response(
        JSON.stringify({ success: true, message: "Se o email existir, você receberá instruções" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const user = authData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      console.log("Usuário não encontrado, mas retornando sucesso por segurança");
      // Retorna sucesso por segurança (previne enumeração de emails)
      return new Response(
        JSON.stringify({ success: true, message: "Se o email existir, você receberá instruções" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Usuário encontrado, gerando token de reset para:", email);

    // Gerar token único
    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token válido por 1 hora

    // Salvar token no banco
    const { error: insertError } = await supabase
      .from("password_reset_tokens")
      .insert({
        user_id: user.id,
        token,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Erro ao salvar token:", insertError);
      throw new Error("Erro ao processar solicitação");
    }

    // URL de reset
    const baseUrl = siteUrl || Deno.env.get("VITE_SUPABASE_URL") || "https://valnix.com";
    const resetUrl = `${baseUrl}/auth?mode=reset&token=${token}`;

    // Enviar email via SMTP Hostinger
    console.log("Enviando email de recuperação para:", email);
    
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
      to: email,
      subject: "Recuperação de Senha - Valnix",
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Recuperação de Senha</title></head><body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;"><table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;"><table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 4px 6px rgba(0,0,0,0.1);"><tr><td style="padding:40px 40px 20px;text-align:center;background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);"><h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:bold;">Valnix</h1></td></tr><tr><td style="padding:40px;"><h2 style="margin:0 0 20px;color:#1f2937;font-size:24px;">Recuperação de Senha</h2><p style="margin:0 0 20px;color:#4b5563;font-size:16px;line-height:1.6;">Você solicitou a recuperação de senha da sua conta Valnix.</p><p style="margin:0 0 30px;color:#4b5563;font-size:16px;line-height:1.6;">Clique no botão abaixo para criar uma nova senha:</p><table role="presentation" style="margin:0 auto;"><tr><td style="border-radius:8px;background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);"><a href="${resetUrl}" style="display:inline-block;padding:16px 40px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;border-radius:8px;">Redefinir Senha</a></td></tr></table><p style="margin:30px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">Este link expira em 1 hora. Se você não solicitou esta recuperação, ignore este email.</p></td></tr><tr><td style="padding:30px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;text-align:center;">© 2024 Valnix. Todos os direitos reservados.</p></td></tr></table></td></tr></table></body></html>`,
    });

    await client.close();
    console.log("✅ Email enviado com sucesso!");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Se o email existir, você receberá instruções para redefinir sua senha" 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Erro em request-password-reset:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao processar solicitação" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
