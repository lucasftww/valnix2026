import { memo, useState, useEffect, lazy, Suspense } from "react";
import { ProductCard } from "./ProductCard";
import { ProductSkeleton } from "./ProductSkeleton";
import { useFeaturedProductsApi } from "@/hooks/useApiData";
import { Button } from "./ui/button";

// Lazy-load the entire Carousel so embla-carousel-react is NOT in the critical path
const LazyCarousel = lazy(() => import("./ProductCarouselWrapper"));

const ProductGridComponent = () => {
  const { data: products = [], isLoading, error, refetch } = useFeaturedProductsApi();

  if (isLoading) {
    return (
      <section className="container px-4 md:px-8 py-8 md:py-16">
        <div className="mb-6 md:mb-10">
          <div className="h-7 md:h-8 w-40 bg-muted/30 rounded" />
          <div className="h-4 w-64 bg-muted/20 rounded mt-2" />
        </div>
        <div className="flex gap-2 md:gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shrink-0 w-[45%] md:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]">
              <ProductSkeleton />
            </div>
          ))}
        </div>
      </section>
    );
  }
  
  if (error) {
    const msg = error.message || "";
    const isBlocked = msg.includes("network") || msg.includes("FIRESTORE_QUERY_TIMEOUT") || (error as any)?.code === "unavailable";
    return (
      <section className="container px-4 md:px-8 py-12">
        <div className="text-center py-12">
          <div className="text-5xl mb-4">{isBlocked ? "🛡️" : "⚠️"}</div>
          <h3 className="text-xl font-bold mb-2">
            {isBlocked ? "Conexão bloqueada" : "Erro ao carregar produtos"}
          </h3>
          <p className="text-muted-foreground mb-4 max-w-md mx-auto">
            {isBlocked 
              ? "Parece que um bloqueador de anúncios está impedindo o carregamento. Desative-o para este site ou adicione valnix.com.br à lista de permissões."
              : (error.message || "Tente recarregar a página")}
          </p>
          <Button onClick={() => refetch()} variant="outline">
            Tentar novamente
          </Button>
        </div>
      </section>
    );
  }
  
  if (products.length === 0) {
    return (
      <section className="container px-4 md:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Mais vendidos
          </h2>
        </div>
        <div className="text-center py-12">
          <div className="text-5xl mb-4">🎮</div>
          <h3 className="text-xl font-bold mb-2">Nenhum produto disponível</h3>
          <p className="text-muted-foreground">Novos produtos em breve!</p>
        </div>
      </section>
    );
  }

  // Static fallback: render first products as plain flex so LCP image paints instantly
  const staticFallback = (
    <div className="flex gap-2 md:gap-3 overflow-hidden">
      {products.slice(0, 4).map((product, index) => (
        <div
          key={product.id}
          className="shrink-0 w-[45%] sm:w-[35%] md:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)]"
        >
          <ProductCard 
            id={product.id}
            image={product.image_url || ""}
            title={product.name}
            reviewCount={product.reviewCount || 0}
            price={product.price}
            originalPrice={product.old_price || undefined}
            discount={product.discount || undefined}
            priority={index < 2}
          />
        </div>
      ))}
    </div>
  );

  return (
    <section className="container px-4 md:px-8 py-8 md:py-16">
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          Mais vendidos
        </h2>
        <p className="text-muted-foreground mt-1 text-xs md:text-sm">
          Os produtos mais populares da nossa loja
        </p>
      </div>
      
      <Suspense fallback={staticFallback}>
        <LazyCarousel products={products} />
      </Suspense>
    </section>
  );
};

export const ProductGrid = memo(ProductGridComponent);
