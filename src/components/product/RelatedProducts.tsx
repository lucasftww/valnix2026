import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Star, ChevronRight } from "lucide-react";
import { useCategoryProducts } from "@/hooks/firebase/useFirebaseProducts";
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
    <section className="mt-10 lg:mt-14">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base md:text-lg font-bold tracking-tight text-foreground">
          Produtos Relacionados
        </h2>
        <Link
          to={`/${category}`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 font-medium"
        >
          Ver todos
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Carousel */}
      <div className="relative group/carousel">
        <Carousel
          opts={{
            align: "start",
            loop: relatedProducts.length > 4,
            dragFree: false,
            containScroll: "keepSnaps",
            duration: 14,
            skipSnaps: false,
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
                    <div className="rounded-xl overflow-hidden border border-border/10 bg-card h-full flex flex-col">
                      {/* Imagem */}
                      <div className="w-full aspect-[3/4] bg-muted/20 overflow-hidden">
                        <img
                          src={product.image_url || ""}
                          alt={product.name}
                          width={280}
                          height={374}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                          sizes="(max-width: 640px) 42vw, (max-width: 768px) 32vw, (max-width: 1024px) 25vw, 20vw"
                          className="w-full h-full object-cover"
                        />
                      </div>

                      {/* Info */}
                      <div className="p-2.5 md:p-3 flex-1 flex flex-col gap-1">
                        <h3 className="text-xs md:text-sm font-semibold text-foreground line-clamp-2 leading-snug">
                          {product.name}
                        </h3>

                        <div className="flex items-center gap-1 mt-auto">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
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
                          <span className="text-sm md:text-base font-extrabold tracking-tight leading-tight">
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
              <CarouselPrevious className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 bg-background/90 hover:bg-background border border-border/10 text-foreground" />
              <CarouselNext className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 bg-background/90 hover:bg-background border border-border/10 text-foreground" />
            </>
          )}
        </Carousel>
      </div>
    </section>
  );
};

export default memo(RelatedProducts);
