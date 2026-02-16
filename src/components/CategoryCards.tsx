import { memo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Skeleton } from "./ui/skeleton";
import { useHomeCategories } from "@/hooks/firebase";
import type { Category } from "@/types";


const CategoryCardItem = memo(({ category }: { category: Category }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const imageUrl = category.image_url || '';

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
    <Link 
      to={`/${category.slug}`} 
      aria-label={`Ver produtos de ${category.name}`}
      className="block group"
    >
      <div 
        ref={cardRef}
        className="overflow-hidden rounded-2xl border border-border/10 hover:border-border/30 transition-all duration-300 hover:shadow-xl hover:shadow-black/20"
      >
        <div className="aspect-[4/3] bg-muted overflow-hidden">
          {isVisible && category.image_url ? (
            <img
              src={imageUrl}
              alt={category.name}
              loading="lazy"
              decoding="async"
              width={400}
              height={300}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <span className="text-3xl font-bold text-primary/40">{category.name.charAt(0)}</span>
            </div>
          )}
        </div>
        <div className="p-3 bg-card">
          <h3 className="text-sm md:text-base font-bold text-foreground leading-tight mb-1">
            {category.name}
          </h3>
          <span className="inline-flex items-center text-[11px] font-semibold text-primary group-hover:underline">
            Ver produtos →
          </span>
        </div>
      </div>
    </Link>
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
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
          Categorias
        </h2>
        <p className="text-muted-foreground mt-1 text-xs md:text-sm">
          Explore nossos produtos por categoria
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
        {categories.map((category) => (
          <CategoryCardItem key={category.id} category={category} />
        ))}
      </div>
    </section>
  );
};

export const CategoryCards = memo(CategoryCardsComponent);
