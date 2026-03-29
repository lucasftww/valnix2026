import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { updateFirestoreDoc } from "../_shared/firestore.ts";

const NEW_TOKEN = "EAAXCTJFcZAckBRHf1P0P3ZBbmfv98XX5OUOgAItrXOkwgquHxlvfGyh1paz1kIP0f9jHQJLDgGRGWL55rsJTigXjtLQYLH5z8XD8AglRWgZBPofDGytdrlYxLXXznt2TBZAFLYXpv2P6jslxHynXuytAyRx3Vqslt5ZAHZAaA6GLrCZAlHZBkZAC1cQ3zLUGyvwZDZD";

Deno.serve(async (req) => {
  console.log("🚀 Running temporary token update...");
  
  try {
    const success = await updateFirestoreDoc("system_credentials", "META_ACCESS_TOKEN", {
      value: NEW_TOKEN,
      updated_at: new Date().toISOString()
    });

    if (success) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Token da Meta atualizado com sucesso no Firestore!" 
      }), { headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "Falha ao atualizar o token no Firestore. Verifique os logs." 
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  } catch (err) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: String(err) 
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
