import { memo } from "react";
import { ProductSkeleton } from "./ProductSkeleton";
import { useFeaturedProductsApi } from "@/hooks/useApiData";
import { Button } from "./ui/button";
import ProductCarouselWrapper from "./ProductCarouselWrapper";

const ProductGridComponent = () => {
  const { data: products = [], isLoading, error, refetch } = useFeaturedProductsApi();

  if (isLoading) {
    return (
      <section className="container max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-16">
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
    const msg = (error.message || "").toLowerCase();
    const isNetworkBlocked = msg.includes("network") || msg.includes("failed to fetch") || msg.includes("timeout");
    return (
      <section className="container max-w-7xl px-4 md:px-8 py-12">
        <div className="text-center py-12">
          <div className="text-5xl mb-4">{isNetworkBlocked ? "🛡️" : "⚠️"}</div>
          <h3 className="text-xl font-bold mb-2">
            {isNetworkBlocked ? "Conexão indisponível" : "Erro ao carregar produtos"}
          </h3>
          <p className="text-muted-foreground mb-4 max-w-md mx-auto">
            {isNetworkBlocked
              ? "Verifique sua conexão ou se há algum bloqueador ativo. Adicione valnix.com.br à lista de permissões e tente novamente."
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
      <section className="container max-w-7xl mx-auto px-4 md:px-8 py-12">
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
    <section className="container max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-16">
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          Mais vendidos
        </h2>
        <p className="text-muted-foreground mt-1 text-xs md:text-sm">
          Os produtos mais populares da nossa loja
        </p>
      </div>

      <ProductCarouselWrapper products={products} />
    </section>
  );
};

export const ProductGrid = memo(ProductGridComponent);
