import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VerifyRequest {
  token: string;
  newPassword: string;
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5; // Max 5 attempts per 15 minutes

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Rate limiting check
    const clientIp = req.headers.get('cf-connecting-ip') || 
                     req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip') ||
                     'unknown';

    console.log("Rate limit check for IP:", clientIp);

    if (clientIp && clientIp !== 'unknown') {
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
      
      // Check current rate limit
      const { data: rateLimitData, error: rateLimitError } = await supabase
        .from('api_rate_limit')
        .select('id, request_count, window_start')
        .eq('endpoint', 'verify-reset-token')
        .eq('ip_address', clientIp)
        .gte('window_start', windowStart)
        .order('window_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (rateLimitError) {
        console.error("Rate limit check error:", rateLimitError);
        // Continue but log the error
      }

      if (rateLimitData && rateLimitData.request_count >= MAX_ATTEMPTS) {
        console.log("Rate limit exceeded for IP:", clientIp);
        return new Response(
          JSON.stringify({ error: 'Muitas tentativas. Por favor, tente novamente em 15 minutos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update or insert rate limit counter
      if (rateLimitData) {
        await supabase
          .from('api_rate_limit')
          .update({ request_count: rateLimitData.request_count + 1 })
          .eq('id', rateLimitData.id);
      } else {
        await supabase
          .from('api_rate_limit')
          .insert({
            endpoint: 'verify-reset-token',
            ip_address: clientIp,
            request_count: 1,
            window_start: new Date().toISOString()
          });
      }
    }

    const { token, newPassword }: VerifyRequest = await req.json();

    if (!token || !newPassword) {
      return new Response(
        JSON.stringify({ error: "Token e nova senha são obrigatórios" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    
    if (newPassword.length < 8 || !hasLetter || !hasNumber) {
      return new Response(
        JSON.stringify({ error: "A senha deve ter no mínimo 8 caracteres com letras e números" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Buscar token no banco
    const { data: tokenData, error: tokenError } = await supabase
      .from("password_reset_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .single();

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({ error: "Token inválido ou expirado" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Verificar se token expirou
    const expiresAt = new Date(tokenData.expires_at);
    if (expiresAt < new Date()) {
      return new Response(
        JSON.stringify({ error: "Token expirado" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Atualizar senha do usuário usando admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      tokenData.user_id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Erro ao atualizar senha:", updateError);
      throw new Error("Erro ao atualizar senha");
    }

    // Marcar token como usado
    await supabase
      .from("password_reset_tokens")
      .update({ used: true })
      .eq("id", tokenData.id);

    console.log("Password reset successful for user:", tokenData.user_id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Senha atualizada com sucesso" 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Erro em verify-reset-token:", error);
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