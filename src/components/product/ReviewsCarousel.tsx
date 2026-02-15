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
  const autoplayRef = useRef(Autoplay({ delay: 4000 }));

  if (reviews.length === 0) return null;

  return (
    <div className="mt-8 max-w-7xl mx-auto px-4 md:px-0">
      <div className="relative rounded-2xl bg-gradient-to-br from-card to-card/80 border border-border/50 p-5 md:p-8 shadow-lg">
        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-5">Avaliações dos clientes</h2>
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
          <CarouselContent className="-ml-3 md:-ml-4">
            {reviews.map((review) => (
              <CarouselItem key={review.id} className="pl-3 md:pl-4 basis-[85%] md:basis-1/2 lg:basis-1/3">
                <div className="relative rounded-xl bg-muted/40 border border-border/30 p-4 md:p-5 h-full flex flex-col gap-3 hover:bg-muted/60 transition-colors">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star 
                        key={star} 
                        className={`w-4 h-4 ${
                          star <= review.rating 
                            ? 'fill-yellow-500 text-yellow-500' 
                            : 'text-muted-foreground/30'
                        }`} 
                      />
                    ))}
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed flex-1 italic">
                    "{review.comment}"
                  </p>
                  <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary uppercase shrink-0">
                      {review.customer_name.charAt(0)}
                    </div>
                    <span className="font-semibold text-sm text-foreground">{review.customer_name}</span>
                    <span className="text-xs text-primary ml-auto font-medium whitespace-nowrap">✓ Compra verificada</span>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious 
            className="-left-4 md:-left-5 h-7 w-7 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
            aria-label="Ver avaliação anterior" 
          />
          <CarouselNext 
            className="-right-4 md:-right-5 h-7 w-7 bg-transparent border-none shadow-none hover:bg-transparent text-foreground/70 hover:text-foreground animate-pulse" 
            aria-label="Ver próxima avaliação" 
          />
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
