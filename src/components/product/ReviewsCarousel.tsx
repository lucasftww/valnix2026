import { memo, useRef, useMemo } from "react";
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
  targetCount?: number;
}

const FAKE_NAMES = [
  "matheus_gamer", "joao_clutch", "pedrin", "lucas_pro", "biel", "gustavinho",
  "rafael_sniper", "davi_plays", "kaio_fps", "nick_valorant", "bruno_ace",
  "arthur_rush", "leo_tk", "gabriel_aim", "igor_flash", "thiago_mvp",
  "vini_carry", "henrique_gg", "felipe_rank", "caio_win", "pedro_kills",
  "enzo_top", "murilo_fps", "ryan_play", "luan_rank", "diego_pro",
  "samuel_vp", "daniel_rush", "gustavo_ace", "renan_aim", "yuri_clutch",
  "andre_gg", "julio_carry", "marcos_mvp", "alex_top", "thomas_win",
  "bernardo_fps", "nicolas_play", "otavio_rank", "lorenzo_pro", "heitor_vp",
  "miguel_rush", "eduardo_ace", "victor_aim", "carlos_flash", "ramon_gg",
  "rodrigo_carry", "leandro_mvp", "fabio_top", "sergio_win", "patrick_kills",
];

const FAKE_COMMENTS = [
  "veio certinho, muito rápido", "caiu na hora, recomendo demais",
  "melhor site que já comprei, confiável", "os vp caiu em 2 min, sensacional",
  "comprei e ja recebi, top demais", "entrega super rapida, amei",
  "site confiavel, ja é a terceira vez que compro", "veio tudo certo mano",
  "comprei pra pegar a skin, chegou rapidao", "muito bom, vou comprar de novo",
  "salvou minha vida, comprei vp e caiu na hora", "rapido e seguro, recomendo",
  "os vp caiu na conta instantaneo", "otimo atendimento e entrega rapida",
  "ja indiquei pros meus amigos, muito bom", "perfeito, sem problema nenhum",
  "primeira vez comprando aqui, surpreendeu", "entregou antes do esperado",
  "preço bom e entrega imediata", "confiavel demais, ja comprei varias vezes",
  "show de bola, caiu rapidinho", "muito satisfeito com a compra",
  "excelente, voltarei a comprar com certeza", "surreal a velocidade da entrega",
  "melhor custo beneficio que achei", "nota 10, entrega instantanea",
  "recomendo pra todo mundo", "nunca tive problema, sempre entrega",
  "mto bom vei os vp caiu em 2 min", "mlk os vp veio certinho ja to radiante",
  "comprei e nao me arrependi", "site seguro e rapido, aprovado",
  "ja fiz 5 compras aqui, sempre certo", "os vp cai muito rapido confia",
  "preco justo e entrega na hora", "confia que é bom demais",
  "veio tudo certo como prometido", "muito rapido, menos de 5 min",
  "sensacional a entrega", "top tier site de vp",
];

function generateFakeReviews(count: number, seed: number): Review[] {
  const fakes: Review[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (seed + i * 7 + i * i) % FAKE_NAMES.length;
    const cidx = (seed + i * 13 + i) % FAKE_COMMENTS.length;
    fakes.push({
      id: `fake_${seed}_${i}`,
      customer_name: FAKE_NAMES[idx],
      rating: 5,
      comment: FAKE_COMMENTS[cidx],
    });
  }
  return fakes;
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

const ReviewsCarousel = ({ reviews, targetCount = 0 }: ReviewsCarouselProps) => {
  const autoplayRef = useRef(
    Autoplay({ delay: 2500, stopOnInteraction: false, stopOnMouseEnter: true })
  );

  const allReviews = useMemo(() => {
    if (targetCount <= reviews.length || targetCount === 0) return reviews;
    const needed = targetCount - reviews.length;
    const seed = reviews.length > 0 ? reviews[0].customer_name.charCodeAt(0) * 17 : 42;
    return [...reviews, ...generateFakeReviews(needed, seed)];
  }, [reviews, targetCount]);

  if (allReviews.length === 0) return null;

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
            duration: 12,
            slidesToScroll: 1,
            containScroll: "trimSnaps",
          }}
          plugins={[autoplayRef.current]}
          className="w-full"
        >
          <CarouselContent className="-ml-3">
            {allReviews.map((review) => (
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
