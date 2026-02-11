import { memo, useRef, useState, useEffect } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { supabase } from "@/integrations/supabase/client";

interface Banner {
  id: string;
  image_url: string;
  alt_text: string;
  link_url: string | null;
  display_order: number;
}

const HeroBannerComponent = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imagesReady, setImagesReady] = useState(false);
  const autoplayPlugin = useRef(
    Autoplay({ delay: 3000, stopOnInteraction: false })
  );

  useEffect(() => {
    const fetchBanners = async () => {
      const { data, error } = await supabase
        .from("site_banners")
        .select("id, image_url, alt_text, link_url, display_order")
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (!error && data) {
        setBanners(data);
      }
      setIsLoading(false);
    };
    fetchBanners();
  }, []);

  useEffect(() => {
    if (banners.length === 0) {
      setImagesReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => setImagesReady(true);
    img.onerror = () => setImagesReady(true);
    img.src = banners[0].image_url;
    const timeout = setTimeout(() => setImagesReady(true), 500);
    return () => clearTimeout(timeout);
  }, [banners]);

  if (isLoading || banners.length === 0) {
    return null;
  }

  if (banners.length === 0) {
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
          {banners.map((banner, index) => (
            <CarouselItem key={banner.id} className="pl-0">
              <div className="relative w-full overflow-hidden md:rounded-2xl border-0 md:border-2 border-primary/50 shadow-none md:shadow-2xl bg-muted">
                {banner.link_url ? (
                  <a href={banner.link_url}>
                    <img
                      src={banner.image_url}
                      alt={banner.alt_text}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding="async"
                      width={1200}
                      height={400}
                      className="w-full h-auto object-cover aspect-[16/7] md:aspect-[21/6]"
                    />
                  </a>
                ) : (
                  <img
                    src={banner.image_url}
                    alt={banner.alt_text}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    width={1200}
                    height={400}
                    className="w-full h-auto object-cover aspect-[16/7] md:aspect-[21/6]"
                  />
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </section>
  );
};

export const HeroBanner = memo(HeroBannerComponent);
