import { memo, useRef, useState, useEffect } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { invokeFunction } from "@/lib/apiHelper";

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
      try {
        const res = await invokeFunction('site-banners', { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          setBanners(data.banners || []);
        }
      } catch (err) {
        console.error("Error fetching banners:", err);
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
              <div className="relative w-full overflow-hidden md:rounded-2xl border-0 md:border border-border/10 shadow-none md:shadow-2xl md:shadow-black/20 bg-muted">
                {banner.link_url ? (
                  <a href={banner.link_url}>
                    <img
                      src={banner.image_url}
                      alt={banner.alt_text}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding={index === 0 ? "sync" : "async"}
                      fetchPriority={index === 0 ? "high" : "auto"}
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
                    decoding={index === 0 ? "sync" : "async"}
                    fetchPriority={index === 0 ? "high" : "auto"}
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
