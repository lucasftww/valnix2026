import { memo, useState, useCallback, lazy, Suspense } from "react";
import { Menu, ShoppingCart, ChevronRight, Tag, MessageCircle, ShieldCheck, Zap } from "lucide-react";
import { Button } from "./ui/button";
import logo from "@/assets/valnix-logo.png";
import { Link } from "react-router-dom";

import { SearchBar } from "./SearchBar";
import { useCart } from "@/contexts/CartContext";
import { useCategoriesApi } from "@/hooks/useApiData";

// Lazy-load Sheet (Radix Dialog) — not needed until user taps menu
const LazySheet = lazy(() => import("@/components/ui/sheet").then(m => ({ default: m.Sheet })));
const LazySheetContent = lazy(() => import("@/components/ui/sheet").then(m => ({ default: m.SheetContent })));
const LazySheetHeader = lazy(() => import("@/components/ui/sheet").then(m => ({ default: m.SheetHeader })));
const LazySheetTitle = lazy(() => import("@/components/ui/sheet").then(m => ({ default: m.SheetTitle })));

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
    <header className="sticky top-0 z-50 w-full border-b border-border/10 bg-background backdrop-blur-sm">
      <div className="container max-w-7xl mx-auto h-14 md:h-16 flex items-center px-4 md:px-6">
        {/* Left Section - Menu (Mobile) + Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Menu Mobile */}
          {/* Mobile menu button — always visible, Sheet lazy-loads on open */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden h-12 w-12 hover:bg-secondary rounded-full" 
            aria-label="Abrir menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {mobileMenuOpen && (
            <Suspense fallback={null}>
              <LazySheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <LazySheetContent
                  side="left"
                  className="w-[300px] p-0 bg-background border-r border-border/30 flex flex-col"
                >
                  {/* Gradient hero header with V logo + branding */}
                  <LazySheetHeader className="px-5 py-5 border-b border-border/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
                    <LazySheetTitle className="text-left flex items-center gap-3">
                      <img
                        src={logo}
                        alt="VALNIX"
                        className="h-8 w-auto object-contain"
                        style={{ height: 32, width: 'auto', maxWidth: 100, maxHeight: 32, objectFit: 'contain', display: 'block' }}
                      />
                    </LazySheetTitle>
                    <p className="text-xs text-muted-foreground mt-2">Sua loja gamer de confiança</p>
                  </LazySheetHeader>

                  {/* Coupon nudge — visual hint that PRIMEIRA5 exists */}
                  <Link
                    to="/"
                    onClick={handleCloseMobileMenu}
                    className="mx-4 mt-4 px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/30 flex items-center gap-2.5 active:scale-[0.98] transition-transform"
                  >
                    <Tag className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-primary leading-tight">Primeira compra?</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        Use <strong className="text-foreground font-mono">PRIMEIRA5</strong> e ganhe 5% OFF
                      </p>
                    </div>
                  </Link>

                  {/* Categories — section title + visual cards */}
                  <div className="px-5 py-4 mt-2">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                      Categorias
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {categories.map((category) => (
                        <Link
                          key={category.id}
                          to={`/${category.slug}`}
                          onClick={handleCloseMobileMenu}
                          className="group flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-foreground bg-secondary/30 border border-border/10 active:bg-primary/15 active:border-primary/40 active:scale-[0.98] md:hover:bg-primary/10 md:hover:border-primary/30 transition-all"
                        >
                          {/* Category image — fallback to first letter */}
                          <div className="w-9 h-9 rounded-lg bg-muted/40 border border-border/10 overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {category.image_url ? (
                              <img
                                src={category.image_url}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                                width={36}
                                height={36}
                              />
                            ) : (
                              <span className="text-sm font-bold text-primary/60">
                                {category.name.charAt(0)}
                              </span>
                            )}
                          </div>
                          <span className="flex-1 truncate">{category.name}</span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-active:text-primary transition-colors shrink-0" />
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* Footer area — trust signals + WhatsApp shortcut */}
                  <div className="mt-auto px-5 py-4 border-t border-border/20 bg-secondary/20 space-y-3">
                    <a
                      href={`https://wa.me/${import.meta.env.VITE_WHATSAPP_NUMBER || '5511999999999'}?text=${encodeURIComponent('Olá! Vim pelo site da VALNIX e quero tirar uma dúvida.')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleCloseMobileMenu}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#25D366]/15 border border-[#25D366]/30 active:bg-[#25D366]/25 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4 text-[#25D366]" />
                      <span className="text-xs font-semibold text-foreground">Falar no WhatsApp</span>
                    </a>

                    <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-success" />
                        Compra segura
                      </span>
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-primary" />
                        Entrega imediata
                      </span>
                    </div>
                  </div>
                </LazySheetContent>
              </LazySheet>
            </Suspense>
          )}

          {/* Logo — INLINE styles lock dimensions BEFORE Tailwind hydrates.
              The previous version rendered the source PNG at intrinsic size
              (~1024px wide) during the brief gap between HTML parse and
              CSS-class application, producing a gigantic V across the
              entire viewport on cold-cache first paints (production bug). */}
          <Link
            to="/"
            className="header-logo-link hover:opacity-90 transition-opacity"
            aria-label="VALNIX home"
            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: 44, overflow: 'hidden' }}
          >
            <img
              src={logo}
              alt="VALNIX"
              className="header-logo-img h-9 md:h-11 w-auto object-contain block"
              width={120}
              height={44}
              decoding="async"
              fetchPriority="high"
              style={{ height: 44, width: 'auto', maxWidth: 140, maxHeight: 44, objectFit: 'contain', display: 'block' }}
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
