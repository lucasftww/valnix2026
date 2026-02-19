import { useParams, Link } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
const Footer = lazy(() => import("@/components/Footer").then(m => ({ default: m.Footer })));
const FloatingContactButtons = lazy(() => import("@/components/FloatingContactButtons").then(m => ({ default: m.FloatingContactButtons })));
import { ProductCard } from "@/components/ProductCard";
import { ProductSkeleton } from "@/components/ProductSkeleton";
import { CategorySidebar } from "@/components/CategorySidebar";
import { useProductsWithReviews, useCategoryBySlug } from "@/hooks/firebase/useFirebaseProductsWithReviews";
import { Helmet } from "react-helmet-async";


export default function Category() {
  const { categorySlug } = useParams<{ categorySlug: string }>();

  const { data: category, isLoading: categoryLoading } = useCategoryBySlug(categorySlug);
  const { data: products = [], isLoading: productsLoading } = useProductsWithReviews(categorySlug || '');

  // Show skeleton layout instead of spinner for faster perceived loading
  if (categoryLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <Navigation />
        <main className="flex-1">
          <div className="container px-4 md:px-8 py-6">
            <div className="h-4 w-32 bg-muted rounded animate-pulse mb-6" />
            <div className="flex gap-8">
              <aside className="hidden lg:block w-64 flex-shrink-0">
                <div className="bg-secondary/50 rounded-2xl p-5 space-y-3">
                  <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-9 bg-muted rounded-xl animate-pulse" />
                  ))}
                </div>
              </aside>
              <div className="flex-1">
                <div className="h-8 w-48 bg-muted rounded animate-pulse mb-6" />
                <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <ProductSkeleton key={i} />
                  ))}
                </div>
              </div>
            </div>
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
        <link rel="canonical" href={`https://www.valnix.com.br/${category.slug}`} />
        <title>Comprar {category.name} Barato | Gift Card {category.name} | VALNIX</title>
        <meta name="description" content={`Compre ${category.name} com entrega automática e pagamento via PIX. Gift cards ${category.name} com os melhores preços do Brasil. Entrega instantânea e segura na VALNIX.`} />
        <meta name="keywords" content={`${category.name.toLowerCase()}, comprar ${category.name.toLowerCase()}, gift card ${category.name.toLowerCase()}, ${category.name.toLowerCase()} barato, ${category.name.toLowerCase()} pix`} />
        <meta property="og:title" content={`Comprar ${category.name} Barato | VALNIX`} />
        <meta property="og:description" content={`Compre ${category.name} com entrega automática e pagamento via PIX. Melhores preços do Brasil.`} />
        <meta property="og:url" content={`https://www.valnix.com.br/${category.slug}`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="VALNIX" />
        {category.image_url && <meta property="og:image" content={category.image_url} />}
        {category.image_url && <meta property="og:image:width" content="1200" />}
        {category.image_url && <meta property="og:image:height" content="630" />}
        {!category.image_url && <meta property="og:image" content="https://www.valnix.com.br/images/og-home.jpg" />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`Comprar ${category.name} Barato | VALNIX`} />
        <meta name="twitter:description" content={`Compre ${category.name} com entrega automática e pagamento via PIX. Melhores preços do Brasil.`} />
        {category.image_url ? <meta name="twitter:image" content={category.image_url} /> : <meta name="twitter:image" content="https://www.valnix.com.br/images/og-home.jpg" />}
      </Helmet>
      <Header />
      <Navigation />

      <main className="flex-1">
        <div className="container px-4 md:px-8 py-6">
          {/* Breadcrumb */}
          <nav className="flex mb-6 text-xs text-muted-foreground tracking-wide uppercase">
            <Link to="/" className="hover:text-foreground transition-colors">Início</Link>
            <span className="mx-2 opacity-40">/</span>
            <span className="text-foreground font-medium">{category.name}</span>
          </nav>

          <div className="flex gap-8">
            {/* Sidebar */}
            <aside className="hidden lg:block w-64 flex-shrink-0">
              <CategorySidebar />
            </aside>

            {/* Main Content */}
            <div className="flex-1 animate-fade-in" key={categorySlug}>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2 tracking-tight">
                {category.name}
              </h1>

              {category.description && (
                <p className="text-muted-foreground text-sm mb-6 max-w-xl">
                  {category.description}
                </p>
              )}

              {!category.description && <div className="mb-6" />}

              {/* Products Grid */}
              <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-3 touch-manipulation">
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
                      title={product.name}
                      reviewCount={product.reviewCount || 0}
                      price={Number(product.price)}
                      originalPrice={product.old_price ? Number(product.old_price) : undefined}
                      discount={product.discount || undefined}
                      priority={index < 2}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-16 rounded-2xl bg-secondary/50 backdrop-blur-xl">
                    <p className="text-muted-foreground mb-4">
                      Nenhum produto encontrado nesta categoria
                    </p>
                    <Link to="/" className="text-sm font-medium text-foreground hover:opacity-70 transition-opacity">
                      ← Explorar outras categorias
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Suspense fallback={null}>
        <Footer />
      </Suspense>
      <Suspense fallback={null}>
        <FloatingContactButtons />
      </Suspense>
    </div>
  );
}