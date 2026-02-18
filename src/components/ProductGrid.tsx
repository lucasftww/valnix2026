import { memo, useRef, useCallback } from "react";
import { ProductCard } from "./ProductCard";
import { ProductSkeleton } from "./ProductSkeleton";
import { useFeaturedProductsApi } from "@/hooks/useApiData";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ProductGridComponent = () => {
  const { data: products = [], isLoading, error, refetch } = useFeaturedProductsApi();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const scroll = useCallback((direction: 'left' | 'right') => {
    const container = scrollRef.current;
    if (!container) return;
    const scrollAmount = container.clientWidth * 0.75;
    container.scrollBy({ 
      left: direction === 'left' ? -scrollAmount : scrollAmount, 
      behavior: 'smooth' 
    });
  }, []);
  
  if (isLoading) {
    return (
      <section className="container px-4 md:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Mais vendidos
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }
  
  if (error) {
    const isBlocked = error.message?.toLowerCase().includes("network") || 
                      error.message?.includes("FIRESTORE_QUERY_TIMEOUT") ||
                      (error as any)?.code === "unavailable";
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
  
  return (
    <section className="container px-4 md:px-8 py-8 md:py-16">
      <div className="mb-6 md:mb-10 flex items-end justify-between">
        <div>
          <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            Mais vendidos
          </h2>
          <p className="text-muted-foreground mt-1 text-xs md:text-sm">
            Os produtos mais populares da nossa loja
          </p>
        </div>
        {/* Desktop-only nav arrows */}
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={() => scroll('left')}
            className="h-10 w-10 rounded-full border border-border/20 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/40 transition-colors"
            aria-label="Ver produto anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="h-10 w-10 rounded-full border border-border/20 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/40 transition-colors"
            aria-label="Ver próximo produto"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      
      {/* CSS scroll-snap carousel — zero JS library needed */}
      <div 
        ref={scrollRef}
        className="flex gap-2 md:gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {products.map((product, index) => (
          <div 
            key={product.id} 
            className="snap-start shrink-0 w-[45%] md:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]"
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
    </section>
  );
};

export const ProductGrid = memo(ProductGridComponent);
