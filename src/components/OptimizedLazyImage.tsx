import { ImgHTMLAttributes, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { optimizeSupabaseImage, imagePresets } from "@/lib/imageOptimization";

interface OptimizedLazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'placeholder'> {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  blurDataURL?: string;
  aspectRatio?: string;
  preset?: keyof typeof imagePresets;
  optimizationOptions?: { width?: number; height?: number; quality?: number };
}

export function OptimizedLazyImage({ 
  src, 
  alt, 
  className, 
  priority = false,
  blurDataURL,
  aspectRatio = "auto",
  preset = "productCard",
  optimizationOptions,
  ...props 
}: OptimizedLazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Otimizar URL da imagem do Supabase
  const optimizedSrc = optimizeSupabaseImage(
    src, 
    optimizationOptions || imagePresets[preset]
  );

  // Intersection Observer para lazy loading
  useEffect(() => {
    if (priority || isInView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: "200px", // Carregar 200px antes de entrar na viewport
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [priority, isInView]);

  // Gerar blur placeholder se não foi fornecido
  const defaultBlurDataURL = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxYTFhMWEiLz48L3N2Zz4=";

  return (
    <div 
      ref={imgRef}
      className={cn("relative overflow-hidden", className)}
      style={{ aspectRatio }}
    >
      {/* Blur placeholder */}
      {!isLoaded && !error && (
        <div className="absolute inset-0">
          <img
            src={blurDataURL || defaultBlurDataURL}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover blur-xl scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent animate-pulse" />
        </div>
      )}

      {/* Imagem real */}
      {isInView && !error && (
        <img
          src={optimizedSrc}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          width={300}
          height={375}
          onLoad={() => setIsLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "w-full h-full object-cover transition-all duration-500",
            isLoaded ? "opacity-100 scale-100" : "opacity-0 scale-105",
            className
          )}
          {...props}
        />
      )}

      {/* Fallback de erro */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary/30 border-2 border-dashed border-border">
          <div className="text-center p-4">
            <span className="text-4xl mb-2 block">🖼️</span>
            <p className="text-xs text-muted-foreground font-medium">Imagem indisponível</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Faça upload novamente</p>
          </div>
        </div>
      )}

      {/* Loading spinner */}
      {!isLoaded && !error && isInView && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
