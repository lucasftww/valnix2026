import { memo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, Trash2, Plus, Minus, ShoppingBag, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";

interface CartSidebarProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const CartSidebarComponent = ({ open, onOpenChange }: CartSidebarProps) => {
  const { items, totalItems, finalPrice, discount, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleCheckout = useCallback(() => {
    onOpenChange?.(false);
    navigate("/checkout");
  }, [onOpenChange, navigate]);

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
        className="w-full sm:w-[400px] p-0 flex flex-col bg-[#0a0a0a] border-l border-[#1f1f1f]"
      >
        <SheetHeader className="px-5 py-4 border-b border-[#1f1f1f] bg-[#0d0d0d]">
          <SheetTitle className="flex items-center gap-3 text-white">
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
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-[#111] flex items-center justify-center mb-4">
              <ShoppingCart className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Carrinho vazio</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-[200px]">
              Explore nossos produtos e adicione itens ao seu carrinho
            </p>
            <Button onClick={handleClose} className="bg-primary hover:bg-primary/90">
              Explorar produtos
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {items.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex gap-3 p-3 rounded-xl bg-[#111] border border-[#1a1a1a] hover:border-[#252525] transition-colors"
                  >
                    <div className="w-16 h-16 rounded-lg bg-[#1a1a1a] overflow-hidden flex-shrink-0">
                      <img 
                        src={item.image} 
                        alt={item.name} 
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-white line-clamp-2 leading-tight mb-1">
                        {item.name}
                      </h4>
                      <p className="text-primary font-bold text-sm">
                        R$ {(item.price * item.quantity).toFixed(2)}
                      </p>
                      
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 bg-[#1a1a1a] rounded-lg p-0.5">
                          <button
                            onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#252525] text-muted-foreground hover:text-white transition-colors"
                            disabled={item.quantity <= 1}
                            aria-label="Diminuir quantidade"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium text-white">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[#252525] text-muted-foreground hover:text-white transition-colors"
                            aria-label="Aumentar quantidade"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                          aria-label="Remover item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-[#1f1f1f] bg-[#0d0d0d] p-4 space-y-4">
              <div className="space-y-2">
                {discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Desconto</span>
                    <span className="text-green-500 font-medium">-R$ {discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-xl font-bold text-primary">
                    R$ {finalPrice.toFixed(2)}
                  </span>
                </div>
              </div>

              <Separator className="bg-[#1f1f1f]" />

              <Button 
                onClick={handleCheckout}
                className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl gap-2 shadow-lg shadow-primary/20"
              >
                Finalizar Compra
                <ArrowRight className="w-4 h-4" />
              </Button>
              
              <p className="text-center text-[11px] text-muted-foreground">
                Pagamento seguro via PIX • Entrega imediata
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export const CartSidebar = memo(CartSidebarComponent);
