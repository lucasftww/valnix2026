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

const ReviewCard = ({ review }: { review: Review }) => (
  <div className="rounded-xl bg-card border border-border/40 p-4 h-full flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <div className="flex gap-0.5">
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
      <span className="text-[11px] text-primary font-medium tracking-wide">✓ Verificada</span>
    </div>

    <p className="text-sm text-foreground/75 leading-relaxed italic line-clamp-2">
      "{review.comment}"
    </p>

    <div className="flex items-center gap-2 mt-auto">
      <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-bold text-primary uppercase shrink-0">
        {review.customer_name.charAt(0)}
      </div>
      <span className="font-semibold text-sm text-foreground truncate">
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
        <CarouselContent className="-ml-3">
          {reviews.map((review) => (
            <CarouselItem
              key={review.id}
              className="pl-3 basis-[80%] sm:basis-1/2 lg:basis-1/3"
            >
              <ReviewCard review={review} />
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Mobile arrows */}
        <div className="flex justify-center gap-6 mt-4 md:hidden">
          <CarouselPrevious
            className="static translate-y-0 h-7 w-7 rounded-full bg-muted/50 border-border/30 text-foreground/60 hover:bg-muted hover:text-foreground"
            aria-label="Ver avaliação anterior"
          />
          <CarouselNext
            className="static translate-y-0 h-7 w-7 rounded-full bg-muted/50 border-border/30 text-foreground/60 hover:bg-muted hover:text-foreground"
            aria-label="Ver próxima avaliação"
          />
        </div>

        {/* Desktop arrows */}
        <CarouselPrevious
          className="hidden md:flex -left-4 h-8 w-8 rounded-full bg-muted/60 border-border/30 text-foreground/60 hover:bg-muted hover:text-foreground"
          aria-label="Ver avaliação anterior"
        />
        <CarouselNext
          className="hidden md:flex -right-4 h-8 w-8 rounded-full bg-muted/60 border-border/30 text-foreground/60 hover:bg-muted hover:text-foreground"
          aria-label="Ver próxima avaliação"
        />
      </Carousel>
    </div>
  );
};

export default memo(ReviewsCarousel);
