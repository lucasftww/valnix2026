import { useCategoriesTree } from "@/hooks/firebase/useFirebaseCategories";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "./ui/skeleton";

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  icon_url: string | null;
  is_active: boolean;
  display_order: number;
  children?: Category[];
}

export const CategorySidebar = () => {
  const location = useLocation();
  const currentPath = location.pathname.replace("/", "");

  const { data: categories = [], isLoading } = useCategoriesTree();

  if (isLoading) {
    return (
       <div className="bg-secondary/50 backdrop-blur-xl rounded-2xl p-5 sticky top-32 self-start max-h-[calc(100vh-9rem)] overflow-y-auto border border-border/10">
        <h3 className="text-xs font-bold mb-4 text-muted-foreground tracking-widest uppercase">Categorias</h3>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const renderCategory = (category: Category, isChild = false) => {
    const isActive = currentPath === category.slug;
    const hasChildren = category.children && category.children.length > 0;
    
    // Check if any child is active to expand parent
    const hasActiveChild = hasChildren && category.children!.some(
      (child) => currentPath === child.slug
    );
    const shouldExpand = isActive || hasActiveChild;

    return (
      <div key={category.id} className={isChild ? "ml-6" : ""}>
        <Link
          to={`/${category.slug}`}
          className={`flex items-center justify-between py-2.5 px-3 rounded-xl transition-colors text-sm ${
            isActive
              ? "bg-foreground text-background font-bold"
              : isChild
              ? "text-muted-foreground hover:text-foreground hover:bg-secondary"
              : "text-foreground hover:bg-secondary font-medium"
          }`}
        >
          <div className="flex items-center gap-3">
            {category.icon_url && (
              <img 
                src={category.icon_url} 
                alt={category.name}
                className="h-5 w-5 object-contain"
              />
            )}
            <span>{category.name}</span>
          </div>
          {hasChildren && !shouldExpand && (
            <ChevronRight className="h-4 w-4 opacity-50" />
          )}
        </Link>
        
        {hasChildren && shouldExpand && category.children!.map((child) => renderCategory(child, true))}
      </div>
    );
  };

  return (
    <div className="bg-secondary/50 backdrop-blur-xl rounded-2xl p-5 sticky top-32 self-start max-h-[calc(100vh-9rem)] overflow-y-auto border border-border/10">
      <h3 className="text-xs font-bold mb-4 text-muted-foreground tracking-widest uppercase">Categorias</h3>
      <div className="space-y-1">
        {categories.map((category) => renderCategory(category))}
      </div>
    </div>
  );
};