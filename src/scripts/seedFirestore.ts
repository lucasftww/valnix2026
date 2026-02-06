import { collection, doc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

// Categorias de exemplo
const categories = [
  {
    id: "valorant",
    name: "Valorant",
    slug: "valorant",
    description: "Pontos VP e skins para Valorant",
    icon_url: "https://cdn-icons-png.flaticon.com/512/6015/6015685.png",
    image_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400",
    display_order: 1,
    is_active: true,
    show_on_homepage: true,
    parent_id: null,
  },
  {
    id: "lol",
    name: "League of Legends",
    slug: "league-of-legends",
    description: "RP e skins para LoL",
    icon_url: "https://cdn-icons-png.flaticon.com/512/588/588267.png",
    image_url: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=400",
    display_order: 2,
    is_active: true,
    show_on_homepage: true,
    parent_id: null,
  },
  {
    id: "roblox",
    name: "Roblox",
    slug: "roblox",
    description: "Robux para Roblox",
    icon_url: "https://cdn-icons-png.flaticon.com/512/4138/4138027.png",
    image_url: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=400",
    display_order: 3,
    is_active: true,
    show_on_homepage: true,
    parent_id: null,
  },
];

// Produtos de exemplo (sem Free Fire)
const products = [
  // Valorant
  {
    id: "vp-1000",
    name: "1000 VP - Valorant Points",
    description: "1000 Valorant Points para comprar skins e battle pass",
    price: 29.90,
    old_price: 39.90,
    discount: 25,
    category: "valorant",
    image_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 100,
    sold: 1547,
    display_order: 1,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 5 minutos",
    instructions: "1. Faça login na sua conta Riot\n2. Resgate o código na loja",
    terms_conditions: "Válido apenas para contas BR",
  },
  {
    id: "vp-2500",
    name: "2500 VP - Valorant Points",
    description: "2500 Valorant Points - Melhor custo-benefício",
    price: 69.90,
    old_price: 89.90,
    discount: 22,
    category: "valorant",
    image_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 50,
    sold: 892,
    display_order: 2,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 5 minutos",
    instructions: "1. Faça login na sua conta Riot\n2. Resgate o código na loja",
    terms_conditions: "Válido apenas para contas BR",
  },
  {
    id: "vp-5000",
    name: "5000 VP - Valorant Points",
    description: "5000 Valorant Points - Pack Premium",
    price: 129.90,
    old_price: 169.90,
    discount: 24,
    category: "valorant",
    image_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400",
    icon_url: null,
    featured: false,
    is_active: true,
    is_featured_in_category: false,
    stock: 30,
    sold: 423,
    display_order: 3,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 5 minutos",
    instructions: "1. Faça login na sua conta Riot\n2. Resgate o código na loja",
    terms_conditions: "Válido apenas para contas BR",
  },
  // LoL
  {
    id: "rp-1380",
    name: "1380 RP - Riot Points",
    description: "1380 RP para League of Legends",
    price: 34.90,
    old_price: 44.90,
    discount: 22,
    category: "lol",
    image_url: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 80,
    sold: 2341,
    display_order: 1,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 5 minutos",
    instructions: "1. Acesse a loja do LoL\n2. Vá em 'Comprar RP'\n3. Selecione 'Código pré-pago'",
    terms_conditions: "Válido apenas para servidor BR",
  },
  {
    id: "rp-2800",
    name: "2800 RP - Riot Points",
    description: "2800 RP para League of Legends - Mais vendido!",
    price: 64.90,
    old_price: 79.90,
    discount: 19,
    category: "lol",
    image_url: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 60,
    sold: 1876,
    display_order: 2,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 5 minutos",
    instructions: "1. Acesse a loja do LoL\n2. Vá em 'Comprar RP'\n3. Selecione 'Código pré-pago'",
    terms_conditions: "Válido apenas para servidor BR",
  },
  // Roblox
  {
    id: "robux-800",
    name: "800 Robux",
    description: "800 Robux para Roblox",
    price: 39.90,
    old_price: 49.90,
    discount: 20,
    category: "roblox",
    image_url: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 100,
    sold: 3245,
    display_order: 1,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 10 minutos",
    instructions: "1. Acesse roblox.com/redeem\n2. Insira o código recebido",
    terms_conditions: "Conta Roblox obrigatória",
  },
  {
    id: "robux-2000",
    name: "2000 Robux",
    description: "2000 Robux para Roblox - Pack Família",
    price: 89.90,
    old_price: 119.90,
    discount: 25,
    category: "roblox",
    image_url: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=400",
    icon_url: null,
    featured: true,
    is_active: true,
    is_featured_in_category: true,
    stock: 50,
    sold: 1654,
    display_order: 2,
    delivery_type: "automatic",
    delivery_info: "Entrega automática em até 10 minutos",
    instructions: "1. Acesse roblox.com/redeem\n2. Insira o código recebido",
    terms_conditions: "Conta Roblox obrigatória",
  },
];

// Banners de exemplo
const banners = [
  {
    id: "banner-1",
    image_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=400&fit=crop",
    alt_text: "Promoção Valorant - Até 30% OFF",
    display_order: 1,
    is_active: true,
  },
  {
    id: "banner-2",
    image_url: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1200&h=400&fit=crop",
    alt_text: "League of Legends - RP com desconto",
    display_order: 2,
    is_active: true,
  },
  {
    id: "banner-3",
    image_url: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=1200&h=400&fit=crop",
    alt_text: "Roblox - Robux em promoção",
    display_order: 3,
    is_active: true,
  },
];

// Reviews de exemplo
const reviews = [
  {
    id: "review-1",
    product_id: "vp-1000",
    customer_name: "joao_gamer",
    rating: 5,
    comment: "entrega super rapida mano, menos de 2 min",
    display_order: 1,
    category: "valorant",
  },
  {
    id: "review-2",
    product_id: "vp-2500",
    customer_name: "mariazinha_ff",
    rating: 5,
    comment: "amei!! chegou na hora e funcionou certinho",
    display_order: 2,
    category: "valorant",
  },
  {
    id: "review-3",
    product_id: "rp-1380",
    customer_name: "pedro_lol",
    rating: 5,
    comment: "melhor loja de rp que ja comprei, recomendo demais",
    display_order: 3,
    category: "lol",
  },
  {
    id: "review-4",
    product_id: "robux-800",
    customer_name: "ana_roblox",
    rating: 5,
    comment: "mto bom, ja é a terceira vez q compro aqui",
    display_order: 4,
    category: "roblox",
  },
  {
    id: "review-5",
    product_id: "robux-2000",
    customer_name: "lucas_pro",
    rating: 5,
    comment: "confiavel demais, robux caiu na hora",
    display_order: 5,
    category: "roblox",
  },
];

// Passos de ativação
const activationSteps = [
  {
    id: "step-valorant-1",
    category: "valorant",
    step_number: 1,
    title: "Acesse sua conta Riot",
    description: "Faça login em playVALORANT.com com sua conta",
    display_order: 1,
    is_active: true,
  },
  {
    id: "step-valorant-2",
    category: "valorant",
    step_number: 2,
    title: "Vá até a loja",
    description: "No cliente do jogo, clique em 'Loja'",
    display_order: 2,
    is_active: true,
  },
  {
    id: "step-valorant-3",
    category: "valorant",
    step_number: 3,
    title: "Resgate o código",
    description: "Clique em 'Resgatar código' e insira o código recebido",
    display_order: 3,
    is_active: true,
  },
  {
    id: "step-lol-1",
    category: "lol",
    step_number: 1,
    title: "Abra o cliente LoL",
    description: "Inicie o League of Legends e faça login",
    display_order: 1,
    is_active: true,
  },
  {
    id: "step-lol-2",
    category: "lol",
    step_number: 2,
    title: "Acesse a loja",
    description: "Clique no ícone da loja no canto superior direito",
    display_order: 2,
    is_active: true,
  },
  {
    id: "step-lol-3",
    category: "lol",
    step_number: 3,
    title: "Comprar RP",
    description: "Clique em 'Comprar RP' > 'Código pré-pago' e insira seu código",
    display_order: 3,
    is_active: true,
  },
];

export async function seedFirestore() {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    console.log("🌱 Iniciando seed do Firestore...");

    // Seed categorias
    console.log("📁 Adicionando categorias...");
    for (const category of categories) {
      const ref = doc(db, "categories", category.id);
      batch.set(ref, { ...category, created_at: now, updated_at: now });
    }

    // Seed produtos
    console.log("📦 Adicionando produtos...");
    for (const product of products) {
      const ref = doc(db, "products", product.id);
      batch.set(ref, { ...product, created_at: now, updated_at: now });
    }

    // Seed banners
    console.log("🖼️ Adicionando banners...");
    for (const banner of banners) {
      const ref = doc(db, "site_banners", banner.id);
      batch.set(ref, { ...banner, created_at: now, updated_at: now });
    }

    // Seed reviews
    console.log("⭐ Adicionando reviews...");
    for (const review of reviews) {
      const ref = doc(db, "product_reviews", review.id);
      batch.set(ref, { ...review, created_at: now });
    }

    // Seed activation steps
    console.log("📋 Adicionando passos de ativação...");
    for (const step of activationSteps) {
      const ref = doc(db, "activation_steps", step.id);
      batch.set(ref, { ...step, created_at: now, updated_at: now });
    }

    // Commit batch
    console.log("💾 Commitando batch...");
    await batch.commit();
    console.log("✅ Seed concluído com sucesso!");

    return {
      categories: categories.length,
      products: products.length,
      banners: banners.length,
      reviews: reviews.length,
      activationSteps: activationSteps.length,
    };
  } catch (error: any) {
    console.error("❌ Erro no seed:", error);
    console.error("Código do erro:", error.code);
    console.error("Mensagem:", error.message);
    
    if (error.code === "permission-denied") {
      throw new Error("Permissão negada! Configure as regras do Firestore no console do Firebase para permitir escrita.");
    }
    
    throw new Error(`Erro ao popular Firestore: ${error.message}`);
  }
}
