import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Star, ChevronRight } from "lucide-react";
import { useCategoryProducts } from "@/hooks/firebase";
import { generateConsistentSalesAndReviews } from "@/hooks/firebase/useFirebaseProducts";
import { formatPrice, ROUTES } from "@/lib/constants";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface RelatedProductsProps {
  category: string;
  currentProductId: string;
}

const RelatedProducts = ({ category, currentProductId }: RelatedProductsProps) => {
  const { data: products = [] } = useCategoryProducts(category);

  const relatedProducts = useMemo(
    () => products.filter((p) => p.id !== currentProductId).slice(0, 12),
    [products, currentProductId]
  );

  if (relatedProducts.length === 0) return null;

  return (
    <section className="mt-8 lg:mt-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base md:text-lg font-bold flex items-center gap-2 text-foreground">
          <Star className="w-4 h-4 md:w-5 md:h-5 text-primary fill-primary" />
          Produtos Relacionados
        </h2>
        <Link
          to={`/${category}`}
          className="text-xs md:text-sm text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5 font-medium"
        >
          Ver todas
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Carousel */}
      <div className="relative group/carousel">
        <Carousel
          opts={{
            align: "start",
            loop: relatedProducts.length > 4,
            dragFree: true,
            containScroll: "trimSnaps",
          }}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-3">
            {relatedProducts.map((product) => {
              const stats = generateConsistentSalesAndReviews(product.id);
              const hasOldPrice =
                product.old_price && product.old_price > product.price;

              return (
                <CarouselItem
                  key={product.id}
                  className="pl-2 md:pl-3 basis-[42%] sm:basis-[32%] md:basis-1/4 lg:basis-1/5"
                >
                  <Link
                    to={ROUTES.PRODUCT(product.id)}
                    className="group block h-full"
                  >
                    <div className="rounded-lg overflow-hidden border border-border/20 hover:border-primary/40 transition-colors duration-200 bg-card h-full flex flex-col">
                      {/* Imagem */}
                      <div className="w-full aspect-[3/4] bg-muted/20 overflow-hidden">
                        <img
                          src={product.image_url || ""}
                          alt={product.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>

                      {/* Info */}
                      <div className="p-2.5 md:p-3 bg-background flex-1 flex flex-col gap-1">
                        <h3 className="text-xs md:text-sm font-semibold text-foreground line-clamp-2 leading-snug">
                          {product.name}
                        </h3>

                        <div className="flex items-center gap-1 mt-auto">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                          <span className="text-[10px] md:text-[11px] text-muted-foreground">
                            {stats.reviewCount.toLocaleString("pt-BR")}{" "}
                            avaliações
                          </span>
                        </div>

                        <div className="flex flex-col">
                          {hasOldPrice && (
                            <span className="text-[10px] md:text-[11px] text-muted-foreground line-through leading-none">
                              {formatPrice(product.old_price!)}
                            </span>
                          )}
                          <span className="text-sm md:text-base font-extrabold text-primary leading-tight">
                            {formatPrice(product.price)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </CarouselItem>
              );
            })}
          </CarouselContent>

          {relatedProducts.length > 4 && (
            <>
              {/* Desktop: setas dentro do carrossel, visíveis ao hover */}
              <CarouselPrevious className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 bg-background/90 hover:bg-background border border-border/50 text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200" />
              <CarouselNext className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 bg-background/90 hover:bg-background border border-border/50 text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200" />
            </>
          )}
        </Carousel>
      </div>
    </section>
  );
};

export default memo(RelatedProducts);
