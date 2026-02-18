import { memo, useCallback, useRef, useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS, CACHE_TIMES, formatPrice, ROUTES } from "@/lib/constants";
import { Star } from "lucide-react";



interface ProductCardProps {
  id: string | number;
  image: string;
  title: string;
  reviewCount: number;
  price: number;
  originalPrice?: number;
  discount?: number;
  priority?: boolean;
}

const ProductCardComponent = ({
  id,
  image,
  title,
  reviewCount,
  price,
  originalPrice,
  discount,
  priority = false,
}: ProductCardProps) => {
  const queryClient = useQueryClient();
  const productId = String(id);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [isVisible, setIsVisible] = useState(priority);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Prefetch otimizado - triggers on hover (desktop) and touchstart (mobile)
  const prefetchTriggered = useRef(false);
  const triggerPrefetch = useCallback(() => {
    if (!productId || prefetchTriggered.current) return;
    // Respect saveData and slow connections
    const conn = (navigator as any).connection;
    const slow = ["slow-2g", "2g"].includes(conn?.effectiveType);
    if (conn?.saveData || slow) return;
    prefetchTriggered.current = true;
    // Prefetch JS chunk + data in parallel (uses shared fetchProduct with timeout)
    import("@/pages/ProductDetail");
    queryClient
      .prefetchQuery({
        queryKey: [QUERY_KEYS.PRODUCT, productId],
        queryFn: async () => {
          const { fetchProduct } = await import("@/lib/fetchProduct");
          return fetchProduct(productId);
        },
        ...CACHE_TIMES.MODERATE,
      })
      .catch(() => {
        // Prefetch é best-effort — não poluir cache com erro
      });
  }, [queryClient, productId]);

  // Priority cards are visible immediately; non-priority show after first paint
  useEffect(() => {
    if (!priority) setIsVisible(true);
  }, [priority]);

  // Prefetch on hover/touch only (removed auto-prefetch on visibility to reduce Firebase reads)

  const hasDiscount = discount && discount > 0;
  const hasOriginalPrice = originalPrice && originalPrice > price;

  return (
    <Link 
      ref={cardRef}
      to={ROUTES.PRODUCT(productId)} 
      className={`group block touch-manipulation transition-opacity duration-300 ease-out ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      onMouseEnter={triggerPrefetch}
      onTouchStart={triggerPrefetch}
      aria-label={`Ver produto ${title}`}
    >
      <Card className="relative overflow-hidden border border-border/10 md:hover:border-border/30 bg-card cursor-pointer h-full rounded-2xl contain-layout transition-[border-color] duration-300">
        {/* Badge de desconto */}
        {hasDiscount && (
          <Badge className="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 bg-discount text-discount-foreground font-bold text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full">
            -{discount}%
          </Badge>
        )}
        
        {/* Imagem com lazy loading otimizado */}
        <div className="relative w-full aspect-[4/5] bg-background overflow-hidden">
          {isVisible ? (
            <img
              src={image}
              alt={title}
              width={300}
              height={375}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              {...(priority ? { fetchPriority: "high" as const } : {})}
              onLoad={() => setImageLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <div className="w-full h-full bg-muted animate-pulse" />
          )}
        </div>

        {/* Info area */}
        <div className="p-3 md:p-4 space-y-2">
          <h3 className="text-foreground font-semibold text-sm md:text-[15px] line-clamp-2 leading-snug min-h-[2.5rem] sm:min-h-0">
            {title}
          </h3>
          
          <div className="flex items-center gap-1">
            <Star className="w-3 h-3 md:w-3.5 md:h-3.5 fill-amber-400 text-amber-400 shrink-0" />
            <span className="text-muted-foreground text-[10px] md:text-xs">
              {reviewCount.toLocaleString('pt-BR')} avaliações
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            {hasOriginalPrice && (
              <span className="text-[10px] md:text-xs text-muted-foreground line-through">
                {formatPrice(originalPrice)}
              </span>
            )}
            <span className="text-base sm:text-lg md:text-lg font-bold text-foreground">
              {formatPrice(price)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
};

export const ProductCard = memo(ProductCardComponent);
