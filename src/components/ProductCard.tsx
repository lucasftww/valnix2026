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
  /** Show a "Mais vendido" badge — typically passed for the top 3 products
   *  in a featured carousel. Reinforces social proof at-a-glance. */
  bestSeller?: boolean;
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
  bestSeller = false,
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
      <Card className="relative overflow-hidden border border-border/10 md:hover:border-primary/40 md:hover:shadow-lg md:hover:shadow-primary/10 md:hover:-translate-y-0.5 bg-card cursor-pointer h-full rounded-2xl md:transition-all md:duration-300">
        {/* Top-left badges (mutex priority: out-of-stock > discount) */}
        {isOutOfStock && (
          <Badge className="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 bg-muted text-muted-foreground font-bold text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full border border-border/30">
            Esgotado
          </Badge>
        )}
        {!isOutOfStock && hasDiscount && (
          <Badge className="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 bg-discount text-discount-foreground font-bold text-[10px] md:text-xs px-2 py-0.5 md:px-2.5 md:py-1 rounded-full shadow-md">
            -{discount}%
          </Badge>
        )}

        {/* Top-right badge for bestSeller — separate slot so it can coexist
            with discount badge on the left without overlap. */}
        {!isOutOfStock && bestSeller && (
          <Badge className="absolute top-2.5 right-2.5 md:top-3 md:right-3 z-10 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-[9px] md:text-[10px] px-2 py-0.5 md:px-2.5 md:py-1 rounded-full shadow-md">
            🔥 Top
          </Badge>
        )}

        {/* Imagem otimizada — inline style on the wrapper guarantees a fixed
            aspect ratio even before Tailwind hydrates (catches the FOUC
            "imagem gigante" flash on first paint with a cold cache). */}
        <div
          className="vn-product-thumb relative w-full aspect-[4/5] bg-muted/20 overflow-hidden rounded-t-2xl"
          style={{ aspectRatio: '4 / 5', width: '100%', position: 'relative', overflow: 'hidden' }}
        >
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
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', display: 'block' }}
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
