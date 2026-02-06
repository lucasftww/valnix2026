import { memo, useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { optimizeSupabaseImage, imagePresets } from "@/lib/imageOptimization";
import { useBanners } from "@/hooks/firebase";

const HeroBannerComponent = () => {
  const [imagesReady, setImagesReady] = useState(false);
  const autoplayPlugin = useRef(
    Autoplay({ delay: 3000, stopOnInteraction: false })
  );

  const { data: activeBanners = [], isLoading } = useBanners();

  // Timeout de segurança para não bloquear o autoplay
  useEffect(() => {
    if (activeBanners.length === 0) {
      setImagesReady(true);
      return;
    }

    // Preload apenas a primeira imagem
    const img = new Image();
    img.onload = () => setImagesReady(true);
    img.onerror = () => setImagesReady(true);
    img.src = activeBanners[0].image_url;

    // Timeout de segurança
    const timeout = setTimeout(() => setImagesReady(true), 500);
    return () => clearTimeout(timeout);
  }, [activeBanners]);

  if (isLoading) {
    return (
      <section className="container px-0 md:px-8 py-0 md:py-8">
        <div className="relative w-full aspect-[16/7] md:aspect-[21/6] flex items-center justify-center md:rounded-2xl border-0 md:border-2 border-primary/50 bg-gradient-to-r from-secondary/30 to-secondary/60 animate-pulse">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Carregando ofertas...</p>
          </div>
        </div>
      </section>
    );
  }

  if (activeBanners.length === 0) {
    return null;
  }

  return (
    <section className="container px-0 md:px-8 py-0 md:py-8">
      <Carousel
        opts={{
          loop: true,
          align: "start",
          duration: 25,
        }}
        plugins={imagesReady ? [autoplayPlugin.current] : []}
        className="w-full"
      >
        <CarouselContent className="ml-0">
          {activeBanners.map((banner, index) => {
            const optimizedUrl = optimizeSupabaseImage(banner.image_url, imagePresets.banner);
            return (
              <CarouselItem key={banner.id} className="pl-0">
                <div className="relative w-full overflow-hidden md:rounded-2xl border-0 md:border-2 border-primary/50 shadow-none md:shadow-2xl bg-muted">
                  <img
                    src={optimizedUrl}
                    alt={banner.alt_text}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    width={1200}
                    height={400}
                    className="w-full h-auto object-cover aspect-[16/7] md:aspect-[21/6]"
                  />
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
    </section>
  );
};

export const HeroBanner = memo(HeroBannerComponent);
