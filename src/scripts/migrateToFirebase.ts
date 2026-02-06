import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { supabase } from "@/integrations/supabase/client";

export interface MigrationResult {
  categories: number;
  products: number;
  banners: number;
  reviews: number;
  activationSteps: number;
}

export async function migrateSupabaseToFirebase(
  options: { clearExisting?: boolean } = {}
): Promise<MigrationResult> {
  try {
    console.log("🚀 Iniciando migração Supabase → Firebase...");

    const clearExisting = options.clearExisting ?? true;

    // 1. Buscar todos os dados do Supabase
    console.log("📥 Buscando dados do Supabase...");

    const [
      categoriesResult,
      productsResult,
      bannersResult,
      reviewsResult,
      stepsResult,
    ] = await Promise.all([
      supabase.from("categories").select("*").order("display_order"),
      supabase.from("products").select("*").order("display_order"),
      supabase.from("site_banners").select("*").order("display_order"),
      supabase.from("product_reviews").select("*").order("display_order"),
      supabase.from("activation_steps").select("*").order("display_order"),
    ]);

    if (categoriesResult.error) throw new Error(`Erro ao buscar categorias: ${categoriesResult.error.message}`);
    if (productsResult.error) throw new Error(`Erro ao buscar produtos: ${productsResult.error.message}`);
    if (bannersResult.error) throw new Error(`Erro ao buscar banners: ${bannersResult.error.message}`);
    if (reviewsResult.error) throw new Error(`Erro ao buscar reviews: ${reviewsResult.error.message}`);
    if (stepsResult.error) throw new Error(`Erro ao buscar passos de ativação: ${stepsResult.error.message}`);

    const categories = categoriesResult.data || [];
    const products = productsResult.data || [];
    const banners = bannersResult.data || [];
    const reviews = reviewsResult.data || [];
    const steps = stepsResult.data || [];

    console.log(`📊 Dados encontrados:`);
    console.log(`   - ${categories.length} categorias`);
    console.log(`   - ${products.length} produtos`);
    console.log(`   - ${banners.length} banners`);
    console.log(`   - ${reviews.length} reviews`);
    console.log(`   - ${steps.length} passos de ativação`);

    // 2. Inserir no Firebase em batches
    // Firebase tem limite de 500 operações por batch
    const BATCH_LIMIT = 450;

    const clearCollection = async (collectionName: string) => {
      const snapshot = await getDocs(collection(db, collectionName));
      if (snapshot.empty) return;

      let batch = writeBatch(db);
      let ops = 0;
      let deleted = 0;

      for (const docSnap of snapshot.docs) {
        batch.delete(docSnap.ref);
        ops++;
        deleted++;
        if (ops >= BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      }

      if (ops > 0) {
        await batch.commit();
      }

      console.log(`🧹 ${collectionName}: ${deleted} documentos removidos`);
    };

    // Helper para processar em batches
    const processBatch = async (
      items: any[],
      collectionName: string
    ): Promise<number> => {
      if (items.length === 0) return 0;

      let count = 0;
      let currentBatch = writeBatch(db);
      let operationsInBatch = 0;

      for (const item of items) {
        const ref = doc(db, collectionName, item.id);
        currentBatch.set(ref, item);
        operationsInBatch++;
        count++;

        if (operationsInBatch >= BATCH_LIMIT) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          operationsInBatch = 0;
        }
      }

      if (operationsInBatch > 0) {
        await currentBatch.commit();
      }

      return count;
    };

    console.log("💾 Inserindo dados no Firebase...");

    if (clearExisting) {
      // Evita duplicação (ex.: usuário rodou /seed-database antes)
      console.log("🧹 Limpando coleções de catálogo existentes no Firebase...");
      await clearCollection("categories");
      await clearCollection("products");
      await clearCollection("site_banners");
      await clearCollection("product_reviews");
      await clearCollection("activation_steps");
    }

    // Inserir categorias
    console.log("📁 Migrando categorias...");
    await processBatch(categories, "categories");

    // Inserir produtos
    console.log("📦 Migrando produtos...");
    await processBatch(products, "products");

    // Inserir banners
    console.log("🖼️ Migrando banners...");
    await processBatch(banners, "site_banners");

    // Inserir reviews
    console.log("⭐ Migrando reviews...");
    await processBatch(reviews, "product_reviews");

    // Inserir passos de ativação
    console.log("📋 Migrando passos de ativação...");
    await processBatch(steps, "activation_steps");

    console.log("✅ Migração concluída com sucesso!");

    return {
      categories: categories.length,
      products: products.length,
      banners: banners.length,
      reviews: reviews.length,
      activationSteps: steps.length,
    };
  } catch (error: any) {
    console.error("❌ Erro na migração:", error);

    if (error.code === "permission-denied") {
      throw new Error(
        "Permissão negada no Firebase! Configure as regras do Firestore para permitir escrita."
      );
    }

    throw error;
  }
}
