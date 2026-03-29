import { updateFirestoreDoc } from "../supabase/functions/_shared/firestore.ts";

const NEW_TOKEN = "EAAXCTJFcZAckBRHf1P0P3ZBbmfv98XX5OUOgAItrXOkwgquHxlvfGyh1paz1kIP0f9jHQJLDgGRGWL55rsJTigXjtLQYLH5z8XD8AglRWgZBPofDGytdrlYxLXXznt2TBZAFLYXpv2P6jslxHynXuytAyRx3Vqslt5ZAHZAaA6GLrCZAlHZBkZAC1cQ3zLUGyvwZDZD";

async function run() {
  console.log("🚀 Iniciando atualização do token da Meta...");
  
  try {
    const success = await updateFirestoreDoc("system_credentials", "META_ACCESS_TOKEN", {
      value: NEW_TOKEN,
      updated_at: new Date().toISOString()
    });

    if (success) {
      console.log("✅ Token da Meta atualizado com sucesso no Firestore!");
    } else {
      console.error("❌ Falha ao atualizar o token no Firestore.");
      Deno.exit(1);
    }
  } catch (err) {
    console.error("💥 Erro durante a atualização:", err);
    Deno.exit(1);
  }
}

run();
