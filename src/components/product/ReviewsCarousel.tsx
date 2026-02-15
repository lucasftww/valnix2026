import { memo, useRef } from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
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

const ReviewCard = ({ review }: { review: Review }) => (
  <div className="rounded-xl bg-card border border-border/50 p-5 h-full flex flex-col gap-3.5 select-none">
    <div className="flex items-center justify-between">
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
      <span className="text-[11px] text-primary font-medium leading-none">✓ Verificada</span>
    </div>

    <p className="text-sm text-foreground/75 leading-relaxed italic line-clamp-2">
      "{review.comment}"
    </p>

    <div className="flex items-center gap-2.5 mt-auto">
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary uppercase shrink-0 leading-none">
        {review.customer_name.charAt(0)}
      </div>
      <span className="font-semibold text-sm text-foreground truncate leading-none">
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
    <div className="mt-8 max-w-7xl mx-auto px-4 md:px-6">
      <h2 className="text-base md:text-lg font-bold text-foreground mb-4">
        Avaliações dos clientes
      </h2>

      <div className="relative">
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
          <CarouselContent className="-ml-4">
            {reviews.map((review) => (
              <CarouselItem
                key={review.id}
                className="pl-4 basis-[82%] sm:basis-[48%] lg:basis-[32%]"
              >
                <ReviewCard review={review} />
              </CarouselItem>
            ))}
          </CarouselContent>

          {/* Mobile: setas abaixo */}
          <div className="flex items-center justify-center gap-8 mt-4 md:hidden">
            <CarouselPrevious
              className="static translate-y-0 h-8 w-8 rounded-full bg-muted/40 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Ver avaliação anterior"
            />
            <CarouselNext
              className="static translate-y-0 h-8 w-8 rounded-full bg-muted/40 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Ver próxima avaliação"
            />
          </div>

          {/* Desktop: setas laterais fora do conteúdo */}
          <CarouselPrevious
            className="hidden md:flex -left-5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-muted/50 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver avaliação anterior"
          />
          <CarouselNext
            className="hidden md:flex -right-5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-muted/50 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver próxima avaliação"
          />
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
