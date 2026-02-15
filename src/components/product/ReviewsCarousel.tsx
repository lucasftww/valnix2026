import { memo, useRef } from "react";
import { Star } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";

interface Review {
  id: string;
  customer_name: string;
  rating: number;
  comment: string;
}

interface ReviewsCarouselProps {
  reviews: Review[];
}

const ReviewsCarousel = ({ reviews }: ReviewsCarouselProps) => {
  const autoplayRef = useRef(Autoplay({ delay: 4000, stopOnInteraction: true, stopOnMouseEnter: true }));

  if (reviews.length === 0) return null;

  return (
    <div className="mt-8 max-w-7xl mx-auto px-2 md:px-8">
      <div className="relative rounded-2xl bg-gradient-to-br from-card to-card/80 border border-border/50 px-4 md:px-10 py-4 md:py-6 shadow-lg">
        <h2 className="text-base md:text-xl font-bold text-foreground mb-3">Avaliações dos clientes</h2>
        <Carousel
          opts={{
            align: "start",
            loop: true,
            skipSnaps: false,
            duration: 20,
          }}
          plugins={[autoplayRef.current]}
          className="w-full"
        >
          <CarouselContent className="-ml-2">
            {reviews.map((review) => (
              <CarouselItem key={review.id} className="pl-2 basis-full md:basis-1/2 lg:basis-1/3">
                <div className="rounded-lg bg-muted/40 border border-border/30 px-3 py-2.5 md:px-4 md:py-3 h-full flex flex-col gap-1.5 hover:bg-muted/60 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(star => (
                        <Star 
                          key={star} 
                          className={`w-3 h-3 ${
                            star <= review.rating 
                              ? 'fill-yellow-500 text-yellow-500' 
                              : 'text-muted-foreground/30'
                          }`} 
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-primary font-medium">✓ Verificada</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed italic line-clamp-2">
                    "{review.comment}"
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary uppercase shrink-0">
                      {review.customer_name.charAt(0)}
                    </div>
                    <span className="font-semibold text-xs text-foreground truncate">{review.customer_name}</span>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <div className="flex justify-center gap-4 mt-3 md:hidden">
            <CarouselPrevious 
              className="static translate-y-0 h-6 w-6 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
              aria-label="Ver avaliação anterior" 
            />
            <CarouselNext 
              className="static translate-y-0 h-6 w-6 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
              aria-label="Ver próxima avaliação" 
            />
          </div>
          <CarouselPrevious 
            className="hidden md:flex -left-7 h-7 w-7 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
            aria-label="Ver avaliação anterior" 
          />
          <CarouselNext 
            className="hidden md:flex -right-7 h-7 w-7 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
            aria-label="Ver próxima avaliação" 
          />
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
