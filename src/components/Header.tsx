import { memo, useState, useCallback } from "react";
import { Shield, Menu } from "lucide-react";
import { Button } from "./ui/button";
import logo from "@/assets/valnix-logo.png";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { SearchBar } from "./SearchBar";
import { CartSidebar } from "./CartSidebar";
import { useCategories } from "@/hooks/firebase/useFirebaseCategories";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const HeaderComponent = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  
  const { data: categories = [] } = useCategories();

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
              aria-describedby={undefined}
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
                    className="flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-foreground hover:bg-primary/10 hover:text-primary transition-all group"
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
        
        {/* Right Section - Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Admin Link (only visible for admins) */}
          {isAdmin && (
            <Link to="/admin" aria-label="Painel Admin">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 h-10 px-3 rounded-full hover:bg-secondary"
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline text-sm font-medium">Admin</span>
              </Button>
            </Link>
          )}
          
          {/* Cart Sidebar */}
          <CartSidebar open={cartOpen} onOpenChange={setCartOpen} />
        </div>
      </div>
    </header>
  );
};

export const Header = memo(HeaderComponent);