import { memo, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Link } from "react-router-dom";
import { useCategoriesTree } from "@/hooks/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

const NavigationComponent = () => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const { data: categories = [] } = useCategoriesTree();
  const queryClient = useQueryClient();

  const prefetchCategoryProducts = useCallback((categorySlug: string) => {
    queryClient.prefetchQuery({
      queryKey: ["category-products", categorySlug],
      queryFn: async () => {
        const q = query(
          collection(db, "products"),
          where("category", "==", categorySlug)
        );
        const snapshot = await getDocs(q);

        type ProductDoc = { id: string; is_active?: boolean; display_order?: number; [key: string]: unknown };
        
        return snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ProductDoc))
          .filter((p) => p?.is_active !== false)
          .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
          .map((p) => ({ ...p, reviewCount: 0 }));
      },
      staleTime: 10 * 60 * 1000,
    });
  }, [queryClient]);

  const handleMouseEnter = useCallback((categoryId: string, categorySlug: string, hasChildren: boolean) => {
    if (hasChildren) setOpenDropdown(categoryId);
    prefetchCategoryProducts(categorySlug);
  }, [prefetchCategoryProducts]);

  const handleMouseLeave = useCallback(() => {
    setOpenDropdown(null);
  }, []);

  if (categories.length === 0) return null;

  return (
    <nav className="hidden md:block sticky top-16 w-full border-b border-border/10 bg-background z-40">
      <div className="container px-4 md:px-8">
        <div className="flex items-center justify-center gap-1 py-1.5 flex-wrap">
          {categories.map((category) => {
            const hasChildren = category.children && category.children.length > 0;
            const categoryLink = `/${category.slug}`;

            return (
              <div 
                key={category.id} 
                className="relative"
                onMouseEnter={() => handleMouseEnter(category.id, category.slug, !!hasChildren)}
                onMouseLeave={handleMouseLeave}
              >
                {hasChildren ? (
                  <>
                    <Link to={categoryLink} aria-label={`Ver produtos de ${category.name}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground hover:bg-transparent whitespace-nowrap font-medium transition-all h-9 text-[13px] tracking-wide rounded-full"
                        aria-label={`${category.name} - expandir subcategorias`}
                      >
                        {category.icon_url && (
                          <img src={category.icon_url} alt="" aria-hidden="true" className="h-4 w-4 mr-1.5 opacity-70" width={16} height={16} loading="lazy" />
                        )}
                        {category.name}
                        <ChevronDown 
                          className={`ml-1 h-3 w-3 transition-transform duration-200 ${
                            openDropdown === category.id ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </Button>
                    </Link>
                    {openDropdown === category.id && (
                      <div className="absolute left-0 top-full pt-2 z-50" role="menu">
                        <div className="bg-card border border-border/20 rounded-xl shadow-2xl shadow-black/20 min-w-[200px] py-1">
                          {category.children!.map((child) => (
                            <Link
                              key={child.id}
                              to={`/${child.slug}`}
                              className="w-full px-4 py-2.5 text-left text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-sm font-medium block"
                              role="menuitem"
                              aria-label={`Ver produtos de ${child.name}`}
                            >
                              {child.icon_url && (
                                <img src={child.icon_url} alt="" aria-hidden="true" className="h-4 w-4 inline mr-2" width={16} height={16} loading="lazy" />
                              )}
                              {child.name.toUpperCase()}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <Link to={categoryLink} aria-label={`Ver produtos de ${category.name}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground hover:bg-transparent whitespace-nowrap font-medium transition-all h-9 text-[13px] tracking-wide rounded-full"
                    >
                      {category.icon_url && (
                        <img src={category.icon_url} alt="" aria-hidden="true" className="h-4 w-4 mr-1.5 opacity-70" width={16} height={16} loading="lazy" />
                      )}
                      {category.name}
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export const Navigation = memo(NavigationComponent);
