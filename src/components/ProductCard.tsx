import { memo, useCallback, useRef } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Link } from "react-router-dom";
import { QUERY_KEYS, CACHE_TIMES, formatPrice, ROUTES } from "@/lib/constants";
import { queryClient } from "@/lib/queryClient";
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
  /** Effective stock for this product. null = unlimited (manual delivery
   *  without explicit stock); 0 = out of stock; >0 = available. */
  stock?: number | null;
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
  stock,
}: ProductCardProps) => {
  const productId = String(id);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const isOutOfStock = typeof stock === 'number' && stock <= 0;

  // Prefetch on focus/hover. queryClient is already in the entry chunk (eager
  // import from App.tsx + main.tsx), so we can use it directly — the previous
  // dynamic import was producing a vite warning ("static and dynamic import
  // conflict") AND duplicating a tiny module into a wasted lazy chunk.
  const prefetchTriggered = useRef(false);
  const triggerPrefetch = useCallback(() => {
    if (!productId || prefetchTriggered.current) return;
    const conn = (navigator as any).connection;
    if (conn?.saveData || ["slow-2g", "2g"].includes(conn?.effectiveType)) return;
    prefetchTriggered.current = true;
    const schedule = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 50));
    schedule(() => {
      // ProductDetail route + fetchProduct stay dynamic (they're heavy/route-scoped).
      Promise.all([
        import("@/pages/ProductDetail"),
        import("@/lib/fetchProduct").then((m) => m.fetchProduct),
      ])
        .then(([, fetchProduct]) => {
          queryClient
            .prefetchQuery({
              queryKey: [QUERY_KEYS.PRODUCT, productId],
              queryFn: () => fetchProduct(productId),
              ...CACHE_TIMES.MODERATE,
            })
            .catch(() => {});
        })
        .catch(() => {});
    });
  }, [productId]);

  const hasDiscount = !isOutOfStock && discount && discount > 0;
  const hasOriginalPrice = originalPrice && originalPrice > price;

  return (
    <Link
      ref={cardRef}
      to={ROUTES.PRODUCT(productId)}
      className="group block"
      onFocus={triggerPrefetch}
      aria-label={`Ver produto ${title}${isOutOfStock ? ' (esgotado)' : ''}`}
    >
      <Card className="relative overflow-hidden border border-border/10 md:hover:border-border/30 bg-card cursor-pointer h-full rounded-2xl md:transition-[border-color] md:duration-300">
        {/* Out-of-stock badge takes priority over discount */}
        {isOutOfStock && (
          <Badge className="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 bg-muted text-muted-foreground font-bold text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full border border-border/30">
            Esgotado
          </Badge>
        )}
        {hasDiscount && (
          <Badge className="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 bg-discount text-discount-foreground font-bold text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full">
            -{discount}%
          </Badge>
        )}

        {/* Imagem otimizada (sem placeholder preto durante drag) */}
        <div className="vn-product-thumb relative w-full aspect-[4/5] bg-muted/20 overflow-hidden">
          <img
            src={image}
            alt={title}
            width={300}
            height={375}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "sync" : "async"}
            fetchPriority={priority ? "high" : "auto"}
            sizes="(max-width: 640px) 45vw, (max-width: 768px) 35vw, (max-width: 1024px) 33vw, 25vw"
            className={`w-full h-full object-cover ${isOutOfStock ? 'grayscale opacity-60' : ''}`}
            draggable={false}
          />
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
            {hasOriginalPrice && !isOutOfStock && (
              <span className="text-[10px] md:text-xs text-muted-foreground line-through">
                {formatPrice(originalPrice)}
              </span>
            )}
            <span className={`text-base sm:text-lg md:text-lg font-bold ${isOutOfStock ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {formatPrice(price)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
};

export const ProductCard = memo(ProductCardComponent);
