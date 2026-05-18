import { memo, useCallback, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, Trash2, Plus, Minus, ShoppingBag, ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { useCart } from "@/contexts/CartContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";
import { CouponInput } from "./CouponInput";

interface SuggestedProduct {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  category: string;
}

interface CartSidebarProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const CartSidebarComponent = ({ open, onOpenChange }: CartSidebarProps) => {
  const { items, totalItems, subtotal, discount, finalPrice, appliedCoupon, updateQuantity, removeItem } = useCart();
  const navigate = useNavigate();
  const [suggested, setSuggested] = useState<SuggestedProduct[]>([]);

  // Fetch featured products on first open of an empty cart — gives the
  // visitor something to click instead of bouncing.
  useEffect(() => {
    if (!open || items.length > 0 || suggested.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/site-data?type=featured');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = (data.products as SuggestedProduct[] | undefined)?.slice(0, 3) ?? [];
        setSuggested(list);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [open, items.length, suggested.length]);

  const handleCheckout = useCallback(() => {
    onOpenChange?.(false);
    navigate("/checkout");
  }, [onOpenChange, navigate]);

  const handlePrefetchCheckout = useCallback(() => {
    import("@/lib/prefetchRoutes").then((m) => m.prefetchCheckout()).catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
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
      </SheetTrigger>
      
       <SheetContent 
        side="right" 
        className="w-full sm:w-[400px] p-0 flex flex-col bg-background border-l border-border/30"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-5 py-4 border-b border-border/20 bg-secondary/50">
          <SheetTitle className="flex items-center gap-3 text-foreground">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="text-base font-semibold">Meu Carrinho</span>
              {totalItems > 0 && (
                <p className="text-xs text-muted-foreground font-normal">
                  {totalItems} {totalItems === 1 ? "item" : "itens"}
                </p>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center p-6">
            <div className="flex flex-col items-center text-center mt-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                <ShoppingCart className="w-7 h-7 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">Seu carrinho está vazio</h3>
              <p className="text-xs text-muted-foreground max-w-[230px]">
                Adicione produtos e use o cupom <strong className="text-foreground">PRIMEIRA5</strong> para 5% OFF na primeira compra.
              </p>
            </div>

            {suggested.length > 0 && (
              <div className="w-full space-y-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold text-center">
                  Sugeridos para você
                </p>
                <div className="space-y-2">
                  {suggested.map((p) => (
                    <Link
                      key={p.id}
                      to={`/product/${p.id}`}
                      onClick={handleClose}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-secondary/40 border border-border/10 hover:border-primary/30 hover:bg-secondary/70 transition-colors group"
                    >
                      <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-1">{p.name}</p>
                        <p className="text-sm font-bold text-primary">
                          R$ {Number(p.price).toFixed(2).replace('.', ',')}
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={handleClose} variant="outline" className="mt-6 w-full">
              Continuar navegando
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {items.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex gap-3 p-3 rounded-xl bg-secondary/50 border border-border/10"
                  >
                    <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                      <img 
                        src={item.image} 
                        alt={item.name} 
                        className="w-full h-full object-cover"
                        width={64}
                        height={64}
                        loading="lazy"
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-foreground line-clamp-2 leading-tight mb-1">
                        {item.name}
                      </h4>
                      <p className="text-primary font-bold text-sm">
                        R$ {(item.price * item.quantity).toFixed(2).replace('.', ',')}
                      </p>
                      
                      <div className="flex items-center justify-between mt-2">
                         <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                          <button
                            onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            disabled={item.quantity <= 1}
                            aria-label={`Diminuir quantidade de ${item.name}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center text-sm font-medium text-foreground">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Aumentar quantidade de ${item.name}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`Remover ${item.name} do carrinho`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-border/20 bg-secondary/50 p-4 space-y-3">
              {/* Coupon input + first-purchase nudge */}
              <CouponInput variant="compact" />
              {!appliedCoupon && (
                <p className="text-[10px] text-muted-foreground text-center -mt-1">
                  Primeira compra? Use <strong className="text-foreground">PRIMEIRA5</strong> para 5% OFF
                </p>
              )}

              <Separator className="bg-border/20" />

              {/* Price breakdown */}
              <div className="space-y-1.5">
                {discount > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-foreground">R$ {subtotal.toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-success">Desconto ({appliedCoupon?.code})</span>
                    <span className="text-success font-medium">− R$ {discount.toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Total</span>
                  <span className="text-xl font-bold text-primary">
                    R$ {finalPrice.toFixed(2).replace('.', ',')}
                  </span>
                </div>
              </div>

              <Button
                onClick={handleCheckout}
                onMouseEnter={handlePrefetchCheckout}
                onTouchStart={handlePrefetchCheckout}
                className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl gap-2 shadow-lg shadow-primary/20"
              >
                Finalizar Compra
                <ArrowRight className="w-4 h-4" />
              </Button>

              {/* Trust signals — Brazilian gift-card buyers fear fraud, these reduce abandonment */}
              <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground pt-1">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-success" /> Compra protegida
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-primary" /> Entrega imediata
                </span>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export const CartSidebar = memo(CartSidebarComponent);