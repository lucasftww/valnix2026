import { memo, useEffect, useState, useCallback } from "react";
import { User, LogOut, Shield, Menu, Package } from "lucide-react";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import logo from "@/assets/valnix-logo.png";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { SearchBar } from "./SearchBar";
import { CartSidebar } from "./CartSidebar";
import { useCategories } from "@/hooks/firebase";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface UserProfile {
  nickname: string | null;
  avatar_url: string | null;
  full_name: string | null;
}

const HeaderComponent = () => {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  const { data: categories = [] } = useCategories();

  // Buscar perfil do usuário
  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      return;
    }

    let mounted = true;

    const fetchProfile = async () => {
      try {
        const profileDoc = await getDoc(doc(db, "profiles", user.uid));
        
        if (mounted && profileDoc.exists()) {
          const data = profileDoc.data();
          setProfile({
            nickname: data.nickname || null,
            avatar_url: data.avatar_url || null,
            full_name: data.full_name || null
          });
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      }
    };

    fetchProfile();

    return () => { mounted = false; };
  }, [user?.uid]);

  const getInitials = useCallback(() => {
    if (profile?.nickname) return profile.nickname.slice(0, 2).toUpperCase();
    if (profile?.full_name) return profile.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return "US";
  }, [profile, user?.email]);

  const getDisplayName = useCallback(() => {
    if (profile?.nickname) return profile.nickname;
    if (profile?.full_name) return profile.full_name.split(" ")[0];
    return user?.email?.split("@")[0] || "Conta";
  }, [profile, user?.email]);

  const handleCloseMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleSignOut = useCallback(async (e: Event) => {
    e.preventDefault();
    await signOut();
    navigate("/");
  }, [signOut, navigate]);
  
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/10 bg-background/95">
      <div className="container h-14 md:h-16 flex items-center px-4 md:px-6">
        {/* Left Section - Menu (Mobile) + Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Menu Mobile */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden h-10 w-10 hover:bg-secondary rounded-full" 
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
          {/* User Menu */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="gap-2 h-10 px-2 sm:px-3 rounded-full hover:bg-secondary"
                >
                  <Avatar className="h-7 w-7 border border-primary/30">
                    <AvatarImage src={profile?.avatar_url || ""} alt="Avatar" />
                    <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm font-medium max-w-[80px] truncate">
                    {getDisplayName()}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-2 flex items-center gap-3">
                  <Avatar className="h-10 w-10 border border-primary/30">
                    <AvatarImage src={profile?.avatar_url || ""} alt="Avatar" />
                    <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{getDisplayName()}</p>
                    <p className="text-xs text-muted-foreground break-all">{user.email}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/my-orders" className="cursor-pointer flex items-center">
                    <Package className="w-4 h-4 mr-2" />
                    Meus Pedidos
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="cursor-pointer flex items-center">
                      <Shield className="w-4 h-4 mr-2" />
                      Painel Admin
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onSelect={handleSignOut} 
                  className="cursor-pointer text-destructive focus:text-destructive flex items-center"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/auth">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 h-10 px-3 rounded-full hover:bg-secondary"
              >
                <User className="h-4 w-4" />
                <span className="hidden sm:inline text-sm font-medium">Entrar</span>
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
