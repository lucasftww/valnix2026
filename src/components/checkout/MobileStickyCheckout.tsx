import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronUp, Trash2 } from "lucide-react";
import { CartItem } from "@/contexts/CartContext";

interface MobileStickyCheckoutProps {
  items: CartItem[];
  finalPrice: number;
  loading: boolean;
  paymentMethod: "pix" | "balance" | "card";
  onSubmit: () => void;
  onRemoveItem?: (id: string) => void;
}

const MobileStickyCheckoutComponent = ({
  items,
  finalPrice,
  loading,
  paymentMethod,
  onSubmit,
  onRemoveItem,
}: MobileStickyCheckoutProps) => {
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* Dropdown summary - slides up */}
      {showSummary && (
        <div
          className="bg-secondary/95 border-t border-border/10 px-4 pt-4 pb-2 animate-fade-in max-w-lg mx-auto"
          style={{ animationDuration: "150ms" }}
        >
          <div className="space-y-3 max-h-[40vh] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted overflow-hidden flex-shrink-0 border border-border/10">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-[13px] font-medium truncate">
                    {item.name}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Qtd: {item.quantity}
                  </p>
                </div>
                <p className="text-foreground text-[13px] font-medium shrink-0">
                  R${" "}
                  {(item.price * item.quantity).toFixed(2).replace(".", ",")}
                </p>
                {onRemoveItem && items.length > 1 && (
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors shrink-0"
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
      <div className="bg-background/95 border-t border-border/10 px-4 pt-3 pb-10 safe-area-inset-bottom max-w-lg mx-auto w-full">
        {/* Summary toggle + Total */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground underline underline-offset-2"
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
          className="w-full h-[52px] bg-foreground hover:bg-foreground/90 text-background font-bold rounded-xl text-[15px]"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Processando...
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
