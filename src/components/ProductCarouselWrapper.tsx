import { memo, useState, useEffect, useLayoutEffect } from "react";
import { ProductCard } from "./ProductCard";
import type { EmblaPluginType } from "embla-carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import type { ProductCardData } from "@/types";

/** First row on mobile/desktop — eager images avoid grey placeholder flash. */
const ABOVE_THE_FOLD_COUNT = 4;

interface Props {
  products: ProductCardData[];
}

const ProductCarouselWrapperComponent = ({ products }: Props) => {
  const [emblaApi, setEmblaApi] = useState<CarouselApi | null>(null);

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

  // Embla measures slides before images decode — reInit fixes empty / clipped slides on first paint.
  useLayoutEffect(() => {
    if (!emblaApi) return;
    emblaApi.reInit();
    const t = window.setTimeout(() => emblaApi.reInit(), 50);
    const onResize = () => emblaApi.reInit();
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [emblaApi, products]);

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
    // `carousel-wrapper` / `carousel-track` classnames are hooked by the
    // critical CSS in index.html — they force flex-basis on slides BEFORE
    // Tailwind hydrates the responsive `basis-[45%]` utilities, preventing
    // the "produto gigante" FOUC where each slide briefly took 100% width.
    <div className="relative group/carousel carousel-wrapper">
      <Carousel opts={carouselOpts} plugins={plugins} className="w-full carousel-viewport" setApi={setEmblaApi}>
        <CarouselContent className="-ml-2 md:-ml-3 carousel-track">
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
                priority={index < ABOVE_THE_FOLD_COUNT}
                stock={(product as { stock?: number | null }).stock ?? null}
                bestSeller={index < 3}
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
