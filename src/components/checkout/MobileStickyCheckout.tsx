import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronUp, Trash2, Minus, Plus } from "lucide-react";
import { CartItem } from "@/contexts/CartContext";

interface MobileStickyCheckoutProps {
  items: CartItem[];
  finalPrice: number;
  loading: boolean;
  paymentMethod: "pix" | "card";
  onSubmit: () => void;
  onRemoveItem?: (id: string) => void;
  onUpdateQuantity?: (id: string, quantity: number) => void;
}

const MobileStickyCheckoutComponent = ({
  items,
  finalPrice,
  loading,
  paymentMethod,
  onSubmit,
  onRemoveItem,
  onUpdateQuantity,
}: MobileStickyCheckoutProps) => {
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div className="lg:hidden fixed bottom-8 left-0 right-0 z-50">
      {/* Dropdown summary - slides up */}
      {showSummary && (
        <div
          className="bg-secondary/95 border-t border-border/10 px-4 pt-4 pb-2 animate-fade-in max-w-lg mx-auto"
          style={{ animationDuration: "150ms" }}
        >
          <div className="space-y-3 max-h-[40vh] overflow-y-auto overflow-x-hidden scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted overflow-hidden flex-shrink-0 border border-border/10">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    width={48}
                    height={48}
                    loading="lazy"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-[13px] font-medium truncate">
                    {item.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => onUpdateQuantity?.(item.id, Math.max(1, item.quantity - 1))}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-foreground text-[12px] min-w-[16px] text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity?.(item.id, item.quantity + 1)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-foreground text-[13px] font-medium shrink-0">
                  R${" "}
                  {(item.price * item.quantity).toFixed(2).replace(".", ",")}
                </p>
                {onRemoveItem && items.length > 1 && (
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="relative w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors shrink-0 before:content-[''] before:absolute before:inset-[-4px] before:rounded-lg"
                    aria-label={`Remover ${item.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky bar — raised 2cm (~20px) via extra bottom padding */}
      <div className="bg-background/95 border-t border-border/10 px-4 pt-3 pb-4 safe-area-inset-bottom max-w-lg mx-auto w-full">
        {/* Summary toggle + Total */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground underline underline-offset-2 min-h-[48px]"
            aria-expanded={showSummary}
            aria-label="Resumo do Pedido"
          >
            Resumo do Pedido
            <ChevronUp
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showSummary ? "rotate-180" : ""
              }`}
            />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Total</span>
            <span className="text-[18px] text-primary font-bold">
              R$ {finalPrice.toFixed(2).replace(".", ",")}
            </span>
          </div>
        </div>

        {/* CTA Button */}
        <Button
          onClick={onSubmit}
          disabled={loading || finalPrice < 1}
          className="w-full h-[52px] bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-[15px] transition-all duration-200 animate-pulse"
        >
          {loading ? (
            <span className="flex items-center gap-2.5">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="animate-pulse">Processando pagamento...</span>
            </span>
          ) : (
            "Finalizar Compra"
          )}
        </Button>
      </div>
    </div>
  );
};

export const MobileStickyCheckout = memo(MobileStickyCheckoutComponent);
