import { memo } from "react";
import { ProductCard } from "./ProductCard";
import { ProductSkeleton } from "./ProductSkeleton";
import { useFeaturedProducts } from "@/hooks/firebase";
import { Button } from "./ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "./ui/carousel";

const ProductGridComponent = () => {
  const { data: products = [], isLoading, error, refetch } = useFeaturedProducts();
  
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
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          Mais vendidos
        </h2>
        <p className="text-muted-foreground mt-1 text-xs md:text-sm">
          Os produtos mais populares da nossa loja
        </p>
      </div>
      
      <Carousel
        opts={{
          align: "start",
          loop: true,
          dragFree: true,
          duration: 18,
          skipSnaps: true,
          containScroll: "trimSnaps",
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2 md:-ml-4">
          {products.map((product, index) => (
            <CarouselItem 
              key={product.id} 
              className="pl-2 md:pl-4 basis-1/2 md:basis-1/3 lg:basis-1/4"
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
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious 
          className="left-0 md:left-2 h-10 w-10" 
          aria-label="Ver produto anterior" 
        />
        <CarouselNext 
          className="right-0 md:right-2 h-10 w-10" 
          aria-label="Ver próximo produto" 
        />
      </Carousel>
    </section>
  );
};

export const ProductGrid = memo(ProductGridComponent);
