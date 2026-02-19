import { memo, useState, useCallback, lazy, Suspense } from "react";
import { Menu, ShoppingCart } from "lucide-react";
import { Button } from "./ui/button";
import logo from "@/assets/valnix-logo.png";
import { Link } from "react-router-dom";

import { SearchBar } from "./SearchBar";
import { useCart } from "@/contexts/CartContext";
import { useCategoriesApi } from "@/hooks/useApiData";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// Lazy-load CartSidebar (pulls in ScrollArea, Separator, more Radix)
const LazyCartSidebar = lazy(() => import("./CartSidebar").then(m => ({ default: m.CartSidebar })));

const HeaderComponent = () => {
  const { totalItems } = useCart();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  
  const { data: categories = [] } = useCategoriesApi();

  const handleCloseMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);
  
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/10 bg-background">
      <div className="container h-14 md:h-16 flex items-center px-4 md:px-6">
        {/* Left Section - Menu (Mobile) + Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Menu Mobile */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden h-12 w-12 hover:bg-secondary rounded-full" 
                aria-label="Abrir menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent 
              side="left" 
              className="w-[280px] p-0 bg-background border-r border-border/30"
            >
              <SheetHeader className="px-5 py-4 border-b border-border/30">
                <SheetTitle className="text-left text-sm font-semibold text-primary uppercase tracking-wider">
                  Categorias
                </SheetTitle>
              </SheetHeader>
              
              <div className="flex flex-col py-2">
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    to={`/${category.slug}`}
                    onClick={handleCloseMobileMenu}
                    className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground active:bg-primary/10 active:text-primary md:hover:bg-primary/10 md:hover:text-primary"
                  >
                    {category.icon_url && (
                      <img src={category.icon_url} alt="" className="h-5 w-5 opacity-70 group-hover:opacity-100" loading="lazy" />
                    )}
                    <span>{category.name}</span>
                  </Link>
                ))}
              </div>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <img 
              src={logo} 
              alt="VALNIX" 
              className="h-11 md:h-14 w-auto object-contain"
              width={140}
              height={56}
            />
          </Link>
        </div>
        
        {/* Center Section - Search (Desktop) */}
        <div className="flex-1 flex justify-center px-4 md:px-8">
          <div className="w-full max-w-xl hidden md:block">
            <SearchBar />
          </div>
        </div>
        
        {/* Right Section - Cart */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {cartOpen ? (
            <Suspense fallback={null}>
              <LazyCartSidebar open={cartOpen} onOpenChange={setCartOpen} />
            </Suspense>
          ) : (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setCartOpen(true)}
              className="relative h-10 w-10 rounded-full hover:bg-secondary text-foreground hover:text-primary transition-colors"
              aria-label={`Carrinho${totalItems > 0 ? ` com ${totalItems} itens` : ''}`}
            >
              <ShoppingCart className="h-5 w-5" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg">
                  {totalItems > 99 ? "99+" : totalItems}
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export const Header = memo(HeaderComponent);
