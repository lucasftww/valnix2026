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
import { Badge } from "@/components/ui/badge";

interface RelatedProductsProps {
  category: string;
  currentProductId: string;
}

const RelatedProducts = ({ category, currentProductId }: RelatedProductsProps) => {
  const { data: products = [] } = useCategoryProducts(category);

  const relatedProducts = useMemo(() => 
    products
      .filter(p => p.id !== currentProductId)
      .slice(0, 12),
    [products, currentProductId]
  );

  if (relatedProducts.length === 0) return null;

  return (
    <section className="mt-8 lg:mt-12">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg md:text-xl font-bold flex items-center gap-2">
          <span className="text-primary">⭐</span>
          Produtos Relacionados
        </h2>
        <Link 
          to={`/${category}`} 
          className="text-sm text-primary hover:text-primary/80 transition-colors flex items-center gap-1 font-medium"
        >
          Ver todos
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <Carousel
        opts={{
          align: "start",
          loop: relatedProducts.length > 4,
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-3">
          {relatedProducts.map((product) => {
            const stats = generateConsistentSalesAndReviews(product.id);
            const hasDiscount = product.discount && product.discount > 0;
            const hasOldPrice = product.old_price && product.old_price > product.price;
            const savings = hasOldPrice ? product.old_price! - product.price : 0;

            return (
              <CarouselItem key={product.id} className="pl-3 basis-[45%] sm:basis-[35%] md:basis-[28%] lg:basis-[22%]">
                <Link
                  to={ROUTES.PRODUCT(product.id)}
                  className="group block"
                >
                  <div className="relative rounded-xl overflow-hidden border border-border/30 hover:border-primary/50 transition-all duration-200 bg-card h-full">
                    {/* Badge economia */}
                    {hasOldPrice && savings > 0 && (
                      <Badge className="absolute top-2 right-2 z-10 bg-green-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-md shadow-lg">
                        Economize {formatPrice(savings)}
                      </Badge>
                    )}

                    {/* Imagem */}
                    <div className="relative w-full aspect-square bg-muted/30 overflow-hidden p-3">
                      <img
                        src={product.image_url || ""}
                        alt={product.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>

                    {/* Info */}
                    <div className="p-3 bg-black/60 space-y-1.5">
                      <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight min-h-[2.5rem]">
                        {product.name}
                      </h3>

                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                        <span className="text-[10px] text-muted-foreground">
                          {stats.reviewCount.toLocaleString("pt-BR")} avaliações
                        </span>
                      </div>

                      <div className="flex items-baseline gap-2">
                        {hasOldPrice && (
                          <span className="text-[11px] text-muted-foreground line-through">
                            {formatPrice(product.old_price!)}
                          </span>
                        )}
                        <span className="text-base font-extrabold text-primary">
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
        {relatedProducts.length > 3 && (
          <div className="hidden md:block">
            <CarouselPrevious className="bg-primary/10 hover:bg-primary/20 border-primary/30 text-foreground -left-4" />
            <CarouselNext className="bg-primary/10 hover:bg-primary/20 border-primary/30 text-foreground -right-4" />
          </div>
        )}
      </Carousel>
    </section>
  );
};

export default memo(RelatedProducts);
