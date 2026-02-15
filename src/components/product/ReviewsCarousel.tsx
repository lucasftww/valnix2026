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
  <div className="rounded-xl bg-card border border-border/50 p-4 md:p-5 h-full flex flex-col gap-3 select-none min-h-[120px]">
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
      <span className="text-[11px] text-primary font-medium shrink-0">✓ Verificada</span>
    </div>

    <p className="text-sm text-foreground/80 leading-relaxed italic line-clamp-2">
      &ldquo;{review.comment}&rdquo;
    </p>

    <div className="flex items-center gap-2.5 mt-auto pt-1">
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
    <div className="mt-8 max-w-7xl mx-auto px-4 md:px-14">
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
              className="pl-3 basis-[85%] sm:basis-[48%] lg:basis-[33.333%]"
            >
              <ReviewCard review={review} />
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Setas laterais - posicionadas fora dos cards via padding do container pai */}
        <CarouselPrevious
          className="-left-10 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-muted/50 border-border/40 text-foreground/60 hover:bg-muted hover:text-foreground hidden md:flex"
          aria-label="Ver avaliação anterior"
        />
        <CarouselNext
          className="-right-10 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-muted/50 border-border/40 text-foreground/60 hover:bg-muted hover:text-foreground hidden md:flex"
          aria-label="Ver próxima avaliação"
        />

        {/* Mobile: setas compactas abaixo, sem espaço excessivo */}
        <div className="flex items-center justify-center gap-8 mt-3 md:hidden">
          <CarouselPrevious
            className="static translate-y-0 h-9 w-9 rounded-full bg-muted/40 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver avaliação anterior"
          />
          <CarouselNext
            className="static translate-y-0 h-9 w-9 rounded-full bg-muted/40 border-border/40 text-foreground/50 hover:bg-muted hover:text-foreground"
            aria-label="Ver próxima avaliação"
          />
        </div>
      </Carousel>
    </div>
  );
};

export default memo(ReviewsCarousel);
