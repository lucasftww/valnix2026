import { useParams, Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { FloatingContactButtons } from "@/components/FloatingContactButtons";
import { ProductCard } from "@/components/ProductCard";
import { ProductSkeleton } from "@/components/ProductSkeleton";
import { CategorySidebar } from "@/components/CategorySidebar";
import { useProductsWithReviews, useCategoryBySlug } from "@/hooks/firebase";
import { Helmet } from "react-helmet-async";

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  image_url: string | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
  old_price: number | null;
  discount: number | null;
  image_url: string | null;
  category: string;
}

export default function Category() {
  // A rota está definida como "/:categorySlug" em src/App.tsx
  const { categorySlug } = useParams<{ categorySlug: string }>();

  const { data: category, isLoading: categoryLoading } = useCategoryBySlug(categorySlug);

  // Usar hook unificado com lógica de reviews
  const { data: products = [], isLoading: productsLoading } = useProductsWithReviews(categorySlug || '');

  if (categoryLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <Navigation />
        <main className="flex-1 container px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-64 mb-4" />
            <div className="h-4 bg-muted rounded w-96" />
          </div>
        </main>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <Navigation />
        <main className="flex-1 container px-4 py-8">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4">Categoria não encontrada</h1>
            <Link to="/" className="text-primary hover:underline">
              Voltar para a página inicial
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <link rel="canonical" href={`https://valnixbr.com/${category.slug}`} />
        <title>Comprar {category.name} Barato | Gift Card {category.name} | VALNIX</title>
        <meta name="description" content={`Compre ${category.name} com entrega automática e pagamento via PIX. Gift cards ${category.name} com os melhores preços do Brasil. Entrega instantânea e segura na VALNIX.`} />
        <meta name="keywords" content={`${category.name.toLowerCase()}, comprar ${category.name.toLowerCase()}, gift card ${category.name.toLowerCase()}, ${category.name.toLowerCase()} barato, ${category.name.toLowerCase()} pix`} />
      </Helmet>
      <Header />
      <Navigation />

      <main className="flex-1">
        <div className="container px-4 md:px-8 py-6">
          {/* Breadcrumb */}
          <nav className="flex mb-6 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-primary">Início</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">{category.name}</span>
          </nav>

          <div className="flex gap-8">
            {/* Sidebar */}
            <aside className="hidden lg:block w-64 flex-shrink-0">
              <CategorySidebar />
            </aside>

            {/* Main Content */}
            <div className="flex-1">
              {/* Título com estilo igual ao Valorant */}
              <h1 className="text-3xl font-bold text-foreground mb-6 border-b-4 border-primary inline-block pb-2">
                {category.name}
              </h1>

              {category.description && (
                <p className="text-muted-foreground mb-6">
                  {category.description}
                </p>
              )}

              {/* Products Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }} className="lg:!grid-cols-3 md:!gap-6 touch-manipulation">
                {productsLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <ProductSkeleton key={i} />
                  ))
                ) : products.length > 0 ? (
                  products.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      id={product.id}
                      image={product.image_url || ""}
                      gameIcon={category.icon_url || ""}
                      gameName={category.name}
                      title={product.name}
                      reviewCount={product.reviewCount || 0}
                      price={Number(product.price)}
                      originalPrice={product.old_price ? Number(product.old_price) : undefined}
                      discount={product.discount || undefined}
                      priority={index < 4}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-12 bg-muted/50 rounded-lg">
                    <p className="text-muted-foreground text-lg mb-4">
                      Nenhum produto encontrado nesta categoria
                    </p>
                    <Link to="/" className="text-primary hover:underline">
                      Explorar outras categorias
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
      <FloatingContactButtons />
    </div>
  );
}