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
    <div className="mt-8 max-w-7xl mx-auto">
      <div className="relative rounded-2xl bg-gradient-to-br from-card to-card/80 border border-border/50 p-6 md:p-8 shadow-lg">
        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-6">Avaliações dos clientes</h2>
        <Carousel
          opts={{
            align: "start",
            loop: true,
          }}
          plugins={[autoplayRef.current]}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {reviews.map((review) => (
              <CarouselItem key={review.id} className="pl-2 md:pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                <div className="relative rounded-xl bg-muted/40 border border-border/30 p-5 h-full flex flex-col gap-3 hover:bg-muted/60 transition-colors">
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
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary uppercase">
                      {review.customer_name.charAt(0)}
                    </div>
                    <span className="font-semibold text-sm text-foreground">{review.customer_name}</span>
                    <span className="text-xs text-primary ml-auto font-medium">✓ Compra verificada</span>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="-left-3 md:-left-4 h-7 w-7" aria-label="Ver avaliação anterior" />
          <CarouselNext className="-right-3 md:-right-4 h-7 w-7" aria-label="Ver próxima avaliação" />
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
