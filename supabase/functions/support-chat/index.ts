import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-visitor-id",
};

const SYSTEM_PROMPT = `Você é a Ana, atendente de suporte da Valnix Store, uma loja de gift cards e créditos para jogos (Valorant VP, League of Legends RP, Roblox Robux).

PERSONALIDADE:
- Simpática, prestativa e objetiva
- Usa linguagem informal mas profissional
- Responde de forma natural, como uma pessoa real digitando
- Usa emojis com moderação (1-2 por mensagem no máximo)
- NUNCA revela que é uma IA

CONHECIMENTO DA LOJA:
- Vendemos VP (Valorant Points), RP (Riot Points/LoL), Robux
- Pagamento via PIX com entrega instantânea
- Horário de suporte: 10h às 23h
- Discord: discord.gg/ZYdz9xYdq5
- WhatsApp: (13) 98205-7182

COMO RESPONDER:
- Respostas curtas e diretas (máximo 2-3 frases)
- Se não souber algo, diga que vai verificar com a equipe
- Para problemas complexos, peça para aguardar um atendente humano
- Sempre tente resolver antes de escalar

EXEMPLOS DE RESPOSTAS:
- "Oi! Tudo bem? Em que posso te ajudar? 😊"
- "Entendi! Deixa eu verificar isso pra você..."
- "Pronto! O código será enviado automaticamente após o pagamento pelo PIX"
- "Hmm, esse caso é um pouco diferente. Vou chamar um atendente pra te ajudar melhor, ok?"`;

// Input validation constants
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES_ARRAY = 20;
const VISITOR_ID_MIN_LENGTH = 10;
const VISITOR_ID_MAX_LENGTH = 64;
const VISITOR_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Validate and sanitize visitor ID
const validateVisitorId = (visitorId: unknown): string | null => {
  if (typeof visitorId !== "string") return null;
  if (visitorId.length < VISITOR_ID_MIN_LENGTH || visitorId.length > VISITOR_ID_MAX_LENGTH) return null;
  if (!VISITOR_ID_PATTERN.test(visitorId)) return null;
  return visitorId;
};

// Validate and sanitize message content
const sanitizeMessage = (content: unknown): string | null => {
  if (typeof content !== "string") return null;
  // Remove potentially harmful characters but keep basic punctuation
  const sanitized = content
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[<>]/g, "") // Remove HTML brackets
    .trim();
  return sanitized || null;
};

// Validate messages array
const validateMessages = (messages: unknown): { role: string; content: string }[] | null => {
  if (!Array.isArray(messages)) return null;
  if (messages.length === 0 || messages.length > MAX_MESSAGES_ARRAY) return null;
  
  const validated: { role: string; content: string }[] = [];
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) return null;
    const { role, content } = msg as { role?: unknown; content?: unknown };
    
    if (typeof role !== "string" || !["user", "assistant", "system"].includes(role)) return null;
    const sanitizedContent = sanitizeMessage(content);
    if (!sanitizedContent) return null;
    
    validated.push({ role, content: sanitizedContent });
  }
  return validated;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof body !== "object" || body === null) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages, conversationId, visitorId } = body as {
      messages?: unknown;
      conversationId?: unknown;
      visitorId?: unknown;
    };

    // Validate visitor ID (also check header)
    const headerVisitorId = req.headers.get("x-visitor-id");
    const validVisitorId = validateVisitorId(visitorId) || validateVisitorId(headerVisitorId);
    
    if (!validVisitorId) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing visitor ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate messages
    const validatedMessages = validateMessages(messages);
    if (!validatedMessages) {
      return new Response(
        JSON.stringify({ error: "Invalid messages format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate conversation ID if provided
    let validConversationId: string | null = null;
    if (conversationId !== undefined && conversationId !== null) {
      if (typeof conversationId !== "string" || conversationId.length > 100) {
        return new Response(
          JSON.stringify({ error: "Invalid conversation ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      validConversationId = conversationId;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create or get conversation
    let convId = validConversationId;
    if (!convId) {
      const { data: newConv, error: convError } = await supabase
        .from("support_conversations")
        .insert({ visitor_id: validVisitorId })
        .select()
        .single();
      
      if (convError) {
        console.error("Error creating conversation:", convError);
        throw convError;
      }
      convId = newConv.id;
    } else {
      // Verify the conversation belongs to this visitor
      const { data: existingConv, error: fetchError } = await supabase
        .from("support_conversations")
        .select("visitor_id")
        .eq("id", convId)
        .single();
      
      if (fetchError || !existingConv) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (existingConv.visitor_id !== validVisitorId) {
        return new Response(
          JSON.stringify({ error: "Access denied to this conversation" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Save user message
    const lastUserMessage = validatedMessages[validatedMessages.length - 1];
    if (lastUserMessage?.role === "user") {
      await supabase.from("support_messages").insert({
        conversation_id: convId,
        role: "user",
        content: lastUserMessage.content,
      });

      // Update conversation timestamp
      await supabase
        .from("support_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", convId);
    }

    // Fetch conversation history for context
    const { data: history } = await supabase
      .from("support_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(20);

    const contextMessages = history?.map((m) => ({
      role: m.role === "admin" ? "assistant" : m.role,
      content: m.content,
    })) || validatedMessages;

    // Call AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...contextMessages,
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Muitas mensagens. Aguarde um momento.", conversationId: convId }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Sistema temporariamente indisponível.", conversationId: convId }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const aiData = await response.json();
    const aiMessage = aiData.choices?.[0]?.message?.content || "Desculpe, não entendi. Pode repetir?";

    // Save AI response
    await supabase.from("support_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: aiMessage,
      is_from_human: false,
    });

    return new Response(
      JSON.stringify({ 
        message: aiMessage, 
        conversationId: convId 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Support chat error:", error);
    return new Response(
      JSON.stringify({ error: "Ops, algo deu errado. Tente novamente!" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
