import { memo, useCallback, useRef, useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS, CACHE_TIMES, formatPrice, ROUTES } from "@/lib/constants";
import { Star } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

interface ProductCardProps {
  id: string | number;
  image: string;
  gameIcon: string;
  gameName: string;
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
    if (prefetchTriggered.current) return;
    prefetchTriggered.current = true;
    queryClient.prefetchQuery({
      queryKey: [QUERY_KEYS.PRODUCT, productId],
      queryFn: async () => {
        const snap = await getDoc(doc(db, "products", productId));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data?.is_active === false) return null;
        return { id: snap.id, ...data };
      },
      ...CACHE_TIMES.MODERATE,
    });
  }, [queryClient, productId]);

  // Intersection Observer para lazy loading
  useEffect(() => {
    if (priority) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px', threshold: 0.01 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [priority]);

  // Prefetch product data when card becomes visible on screen (mobile optimization)
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => triggerPrefetch(), 300);
    return () => clearTimeout(timer);
  }, [isVisible, triggerPrefetch]);

  const hasDiscount = discount && discount > 0;
  const hasOriginalPrice = originalPrice && originalPrice > price;

  return (
    <Link 
      ref={cardRef}
      to={ROUTES.PRODUCT(productId)} 
      className="group block touch-manipulation" 
      onMouseEnter={triggerPrefetch}
      onTouchStart={triggerPrefetch}
      aria-label={`Ver produto ${title}`}
    >
      <Card className="relative overflow-hidden border border-primary/20 md:border-2 hover:border-primary active:border-primary transition-colors duration-200 bg-card cursor-pointer h-full md:hover:shadow-2xl md:hover:shadow-primary/20 active:scale-[0.98] rounded-xl md:rounded-2xl">
        {/* Badge de desconto - mais visível no mobile */}
        {hasDiscount && (
          <Badge className="absolute top-2 left-2 md:top-3 md:left-3 z-10 bg-green-600 text-white font-bold text-[10px] md:text-sm px-2 py-0.5 md:px-3 md:py-1 rounded-md shadow-lg">
            -{discount}%
          </Badge>
        )}
        
        {/* Imagem com lazy loading otimizado */}
        <div className="relative w-full aspect-[4/5] bg-muted overflow-hidden">
          {isVisible ? (
            <img
              src={image}
              alt={title}
              width={300}
              height={375}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              {...(priority ? { fetchpriority: "high" } : {})}
              onLoad={() => setImageLoaded(true)}
              className={`w-full h-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <div className="w-full h-full bg-muted animate-pulse" />
          )}
        </div>

        {/* Área de informações - melhor espaçamento mobile */}
        <div className="bg-black p-3 md:p-4">
          <h3 className="text-white font-bold text-sm sm:text-base md:text-lg line-clamp-2 leading-tight min-h-[2.5rem] sm:min-h-0">
            {title}
          </h3>
          
          <div className="flex items-center gap-1 mt-2">
            <Star className="w-3.5 h-3.5 md:w-4 md:h-4 fill-yellow-400 text-yellow-400 shrink-0" />
            <span className="text-white/70 text-[11px] md:text-sm">
              {reviewCount.toLocaleString('pt-BR')} avaliações
            </span>
          </div>

          <div className="mt-2">
            {hasOriginalPrice && (
              <span className="text-[11px] md:text-sm text-white/40 line-through block">
                {formatPrice(originalPrice)}
              </span>
            )}
            <span className={`text-lg sm:text-xl md:text-xl font-extrabold text-primary`}>
              {formatPrice(price)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
};

export const ProductCard = memo(ProductCardComponent);
