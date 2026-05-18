import { memo } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "./ui/skeleton";
import { useCategoriesApi } from "@/hooks/useApiData";
import type { Category } from "@/types";

const CategoryCardItem = memo(({ category }: { category: Category }) => {
  const imageUrl = category.image_url || '';

  return (
    <Link
      to={`/${category.slug}`}
      aria-label={`Ver produtos de ${category.name}`}
      className="block group"
    >
      <div className="rounded-2xl overflow-hidden contain-layout border border-border/10 transition-all duration-300 group-hover:border-primary/40 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-primary/10">
        <div className="aspect-[16/9] overflow-hidden">
          {category.image_url ? (
            <img
              src={imageUrl}
              alt={category.name}
              loading="lazy"
              decoding="async"
              width={400}
              height={225}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <span className="text-3xl font-bold text-primary/40">{category.name.charAt(0)}</span>
            </div>
          )}
        </div>
        <div className="px-3 py-2.5 bg-secondary group-hover:bg-secondary/80 transition-colors">
          <h3 className="text-sm md:text-base font-bold text-foreground leading-tight mb-0.5">
            {category.name}
          </h3>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary group-hover:gap-2 transition-all">
            Ver produtos
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
});

CategoryCardItem.displayName = 'CategoryCardItem';

const CategoryCardsComponent = () => {
  const { data: allCategories = [], isLoading } = useCategoriesApi();
  const categories = allCategories.filter(
    (cat) => cat.show_on_homepage && !cat.parent_id
  );

  if (isLoading) {
    return (
      <section className="container max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-12">
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
    <section className="container max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-12">
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
