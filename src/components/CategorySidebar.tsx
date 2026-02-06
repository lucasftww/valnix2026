import { useCategoriesTree } from "@/hooks/firebase";
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
      <div className="bg-card border border-border rounded-xl p-6 sticky top-32 self-start max-h-[calc(100vh-9rem)] overflow-y-auto">
        <h3 className="text-xl font-bold mb-4 text-primary">CATEGORIAS</h3>
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
          className={`flex items-center justify-between py-3 px-4 rounded-lg transition-all group ${
            isActive
              ? "bg-primary text-primary-foreground font-bold"
              : isChild
              ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              : "text-foreground hover:text-primary hover:bg-primary/10 font-semibold"
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
    <div className="bg-card border border-border rounded-xl p-6 sticky top-32 self-start max-h-[calc(100vh-9rem)] overflow-y-auto">
      <h3 className="text-xl font-bold mb-4 text-primary">CATEGORIAS</h3>
      <div className="space-y-1">
        {categories.map((category) => renderCategory(category))}
      </div>
    </div>
  );
};