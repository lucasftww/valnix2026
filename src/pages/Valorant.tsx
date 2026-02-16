import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { FloatingContactButtons } from "@/components/FloatingContactButtons";
import { Link } from "react-router-dom";
import { CategorySidebar } from "@/components/CategorySidebar";
import { ProductCard } from "@/components/ProductCard";
import { ProductSkeleton } from "@/components/ProductSkeleton";

import { useProductsWithReviews } from "@/hooks/firebase";
export default function Valorant() {
  const { data: valorantProducts = [], isLoading } = useProductsWithReviews('valorant');

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <link rel="canonical" href="https://www.valnix.com.br/valorant" />
        <title>Comprar Valorant Points VP Barato | Gift Card Valorant | VALNIX</title>
        <meta name="description" content="Compre Valorant Points (VP) com entrega automática e pagamento via PIX. Gift cards Valorant com os melhores preços do Brasil. Entrega instantânea e segura." />
        <meta name="keywords" content="valorant points, comprar vp, valorant points barato, gift card valorant, comprar valorant points pix, vp valorant" />
        <meta property="og:title" content="Comprar Valorant Points VP Barato | VALNIX" />
        <meta property="og:description" content="Compre Valorant Points (VP) com entrega automática e pagamento via PIX. Melhores preços do Brasil." />
        <meta property="og:url" content="https://www.valnix.com.br/valorant" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Comprar Valorant Points VP Barato | VALNIX" />
        <meta name="twitter:description" content="Compre Valorant Points (VP) com entrega automática e pagamento via PIX. Melhores preços do Brasil." />
      </Helmet>
      <Header />
      <Navigation />
      <main className="flex-1">
        <div className="container px-4 md:px-8 py-6">
          <nav className="flex mb-6 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-primary">Início</Link>
            <span className="mx-2">/</span>
            <span className="text-foreground">Valorant</span>
          </nav>

          <div className="flex gap-8">
            <aside className="hidden lg:block w-64 flex-shrink-0">
              <CategorySidebar />
            </aside>

            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground mb-2 border-b-4 border-primary inline-block pb-2">
                Comprar Valorant Points (VP)
              </h1>
              <p className="text-muted-foreground mb-6 text-sm">
                Gift cards Valorant Points com entrega automática via PIX. Melhores preços do Brasil.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }} className="lg:!grid-cols-3 md:!gap-6 touch-manipulation">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <ProductSkeleton key={i} />
                  ))
                ) : (
                  valorantProducts.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      id={product.id}
                      image={product.image_url || ""}
                      title={product.name}
                      reviewCount={product.reviewCount || 0}
                      price={product.price}
                      originalPrice={product.old_price || undefined}
                      discount={product.discount || undefined}
                      priority={index < 4}
                    />
                  ))
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