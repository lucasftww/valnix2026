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
    <div className="mt-6 max-w-7xl mx-auto">
      <div className="relative rounded-2xl border-2 border-primary/30 bg-card p-6">
        <h2 className="text-2xl font-bold mb-6">Últimas avaliações</h2>
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
                <div className="relative rounded-xl border-2 border-primary/20 bg-muted/30 p-4 h-full">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm">{review.customer_name}</span>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(star => (
                        <Star 
                          key={star} 
                          className={`w-4 h-4 ${
                            star <= review.rating 
                              ? 'fill-yellow-500 text-yellow-500' 
                              : 'text-gray-600'
                          }`} 
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {review.comment}
                  </p>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-2 h-12 w-12" aria-label="Ver avaliação anterior" />
          <CarouselNext className="right-2 h-12 w-12" aria-label="Ver próxima avaliação" />
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
