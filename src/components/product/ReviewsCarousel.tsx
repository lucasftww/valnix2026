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
  <div className="rounded-xl border border-border/10 bg-card px-5 pt-5 pb-4 md:px-6 md:pt-6 md:pb-5 h-full flex flex-col gap-3.5 select-none">
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-3.5 h-3.5 ${
            star <= review.rating
              ? "fill-amber-400 text-amber-400"
              : "fill-muted text-muted-foreground/20"
          }`}
        />
      ))}
    </div>

    <p className="text-sm md:text-[15px] text-muted-foreground leading-[1.7] line-clamp-3 max-w-[42ch]">
      {review.comment}
    </p>

    <div className="flex items-center gap-2.5 mt-auto">
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-foreground/60 uppercase shrink-0">
        {review.customer_name.charAt(0)}
      </div>
      <span className="font-medium text-[13px] text-foreground truncate">
        {review.customer_name}
      </span>
    </div>
  </div>
);

const ReviewsCarousel = ({ reviews }: ReviewsCarouselProps) => {
  const autoplayRef = useRef(
    Autoplay({ delay: 3000, stopOnInteraction: false, stopOnMouseEnter: true })
  );

  if (reviews.length === 0) return null;

  return (
    <div className="mt-10 max-w-7xl mx-auto">
      <h2 className="text-base md:text-lg font-bold text-foreground tracking-tight mb-5">
        Avaliações dos clientes
      </h2>

      {/* Wrapper com padding lateral para as setas no desktop */}
      <div className="md:px-12">
        <Carousel
          opts={{
            align: "start",
            loop: true,
            dragFree: true,
            skipSnaps: true,
            duration: 18,
            slidesToScroll: 1,
            containScroll: "trimSnaps",
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

          {/* Desktop: setas nas laterais */}
          <CarouselPrevious
            className="hidden md:flex -left-11 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-card border-border/10 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver avaliação anterior"
          />
          <CarouselNext
            className="hidden md:flex -right-11 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-card border-border/10 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver próxima avaliação"
          />

          {/* Mobile: setas abaixo */}
          <div className="flex items-center justify-center gap-8 mt-4 md:hidden">
            <CarouselPrevious
              className="static translate-y-0 h-9 w-9 rounded-full bg-card border-border/10 text-foreground/40 hover:bg-muted hover:text-foreground"
              aria-label="Ver avaliação anterior"
            />
            <CarouselNext
              className="static translate-y-0 h-9 w-9 rounded-full bg-card border-border/10 text-foreground/40 hover:bg-muted hover:text-foreground"
              aria-label="Ver próxima avaliação"
            />
          </div>
        </Carousel>
      </div>
    </div>
  );
};

export default memo(ReviewsCarousel);
