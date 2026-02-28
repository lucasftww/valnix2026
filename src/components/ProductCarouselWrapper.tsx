import { memo, useState, useEffect } from "react";
import { ProductCard } from "./ProductCard";
import type { EmblaPluginType } from "embla-carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import type { ProductCardData } from "@/types";

interface Props {
  products: ProductCardData[];
}

const ProductCarouselWrapperComponent = ({ products }: Props) => {
  // Lazy-load autoplay plugin
  const [plugins, setPlugins] = useState<EmblaPluginType[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      import("embla-carousel-autoplay").then((mod) => {
        setPlugins([mod.default({ delay: 2800, stopOnInteraction: true, stopOnMouseEnter: true })]);
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const carouselOpts = {
    align: "start" as const,
    loop: products.length > 1,
    dragFree: true,
    containScroll: "trimSnaps" as const,
    duration: 12,
    skipSnaps: true,
    dragThreshold: 3,
    inViewThreshold: 0,
  };

  return (
    <div className="relative group/carousel">
      <Carousel opts={carouselOpts} plugins={plugins} className="w-full">
        <CarouselContent className="-ml-2 md:-ml-3">
          {products.map((product, index) => (
            <CarouselItem
              key={product.id}
              className="pl-2 md:pl-3 basis-[45%] sm:basis-[35%] md:basis-1/3 lg:basis-1/4"
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

        {products.length > 4 && (
          <>
            <CarouselPrevious className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 bg-background/90 hover:bg-background border border-border/10 text-foreground" />
            <CarouselNext className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 bg-background/90 hover:bg-background border border-border/10 text-foreground" />
          </>
        )}
      </Carousel>
    </div>
  );
};

export default memo(ProductCarouselWrapperComponent);
