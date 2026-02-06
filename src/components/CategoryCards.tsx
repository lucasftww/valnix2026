import { memo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Skeleton } from "./ui/skeleton";
import { useHomeCategories } from "@/hooks/firebase";
import type { Category } from "@/types";
import { optimizeSupabaseImage, imagePresets } from "@/lib/imageOptimization";

const CategoryCardItem = memo(({ category }: { category: Category }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const optimizedImageUrl = optimizeSupabaseImage(category.image_url, imagePresets.categoryIcon);

  useEffect(() => {
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
  }, []);
  
  return (
    <div 
      ref={cardRef}
      className="relative group overflow-hidden rounded-xl md:rounded-2xl border border-primary/30 md:border-2 hover:border-primary transition-colors shadow-md md:shadow-lg hover:shadow-xl md:hover:shadow-2xl"
    >
      <div className="aspect-square md:aspect-[16/9] relative bg-muted">
        {isVisible && category.image_url ? (
          <img
            src={optimizedImageUrl}
            alt={category.name}
            loading="lazy"
            decoding="async"
            width={400}
            height={300}
            className="w-full h-full object-cover md:object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
            <span className="text-2xl md:text-4xl font-bold text-primary/40">{category.name.charAt(0)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 p-3 md:p-6 space-y-1 md:space-y-3">
        <h3 className="text-sm md:text-2xl font-bold text-foreground leading-tight">
          {category.name}
        </h3>
        {category.description && (
          <p className="hidden md:block text-sm text-muted-foreground line-clamp-2">
            {category.description}
          </p>
        )}
        <Link to={`/${category.slug}`} aria-label={`Ver produtos de ${category.name}`}>
          <Button 
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs md:text-sm h-8 md:h-10 px-4 min-w-[48px]"
          >
            VER
          </Button>
        </Link>
      </div>
    </div>
  );
});

CategoryCardItem.displayName = 'CategoryCardItem';

const CategoryCardsComponent = () => {
  const { data: categories = [], isLoading } = useHomeCategories();

  if (isLoading) {
    return (
      <section className="container px-4 md:px-8 py-8 md:py-12">
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square md:aspect-[16/9]">
              <Skeleton className="w-full h-full rounded-xl md:rounded-2xl" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (categories.length === 0) return null;

  return (
    <section className="container px-4 md:px-8 py-8 md:py-12">
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
        {categories.map((category) => (
          <CategoryCardItem key={category.id} category={category} />
        ))}
      </div>
    </section>
  );
};

export const CategoryCards = memo(CategoryCardsComponent);
