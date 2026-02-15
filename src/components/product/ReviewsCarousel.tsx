import { memo, useRef } from "react";
import { Star } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
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

const ReviewCard = ({ review }: { review: Review }) => (
  <div className="rounded-xl bg-muted/30 backdrop-blur-sm px-5 pt-5 pb-4 md:px-6 md:pt-6 md:pb-5 h-full flex flex-col gap-3.5 select-none">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-3.5 h-3.5 ${
              star <= review.rating
                ? "fill-yellow-500 text-yellow-500"
                : "fill-muted text-muted-foreground/20"
            }`}
          />
        ))}
      </div>
      
    </div>

    <p className="text-sm md:text-[15px] text-foreground/85 leading-[1.7] italic line-clamp-3 max-w-[42ch]">
      {review.comment}
    </p>

    <div className="flex items-center gap-2 mt-auto">
      <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-bold text-primary uppercase shrink-0">
        {review.customer_name.charAt(0)}
      </div>
      <span className="font-semibold text-[13px] text-foreground truncate">
        {review.customer_name}
      </span>
    </div>
  </div>
);

const ReviewsCarousel = ({ reviews }: ReviewsCarouselProps) => {
  const autoplayRef = useRef(
    Autoplay({ delay: 4000, stopOnInteraction: true, stopOnMouseEnter: true })
  );

  if (reviews.length === 0) return null;

  return (
    <div className="mt-8 max-w-7xl mx-auto px-4">
      <h2 className="text-base md:text-lg font-bold text-foreground mb-4">
        Avaliações dos clientes
      </h2>

      {/* Wrapper com padding lateral para as setas no desktop */}
      <div className="md:px-12">
        <Carousel
          opts={{
            align: "start",
            loop: true,
            skipSnaps: false,
            duration: 20,
            slidesToScroll: 1,
          }}
          plugins={[autoplayRef.current]}
          className="w-full"
        >
          <CarouselContent className="-ml-3">
            {reviews.map((review) => (
              <CarouselItem
                key={review.id}
                className="pl-3 basis-[85%] sm:basis-[48%] lg:basis-[33.333%]"
              >
                <ReviewCard review={review} />
              </CarouselItem>
            ))}
          </CarouselContent>

          {/* Desktop: setas nas laterais, fora do conteúdo */}
          <CarouselPrevious
            className="hidden md:flex -left-11 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-card border-border/50 text-foreground/60 hover:bg-muted hover:text-foreground shadow-sm"
            aria-label="Ver avaliação anterior"
          />
          <CarouselNext
            className="hidden md:flex -right-11 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-card border-border/50 text-foreground/60 hover:bg-muted hover:text-foreground shadow-sm"
            aria-label="Ver próxima avaliação"
          />

          {/* Mobile: setas abaixo, compactas */}
          <div className="flex items-center justify-center gap-8 mt-3 md:hidden">
            <CarouselPrevious
              className="static translate-y-0 h-9 w-9 rounded-full bg-card border-border/50 text-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Ver avaliação anterior"
            />
            <CarouselNext
              className="static translate-y-0 h-9 w-9 rounded-full bg-card border-border/50 text-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Ver próxima avaliação"
            />
          </div>
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
