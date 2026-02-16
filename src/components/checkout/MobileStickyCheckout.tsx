import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronUp } from "lucide-react";
import { CartItem } from "@/contexts/CartContext";

interface MobileStickyCheckoutProps {
  items: CartItem[];
  finalPrice: number;
  loading: boolean;
  paymentMethod: "pix" | "balance" | "card";
  onSubmit: () => void;
}

const MobileStickyCheckoutComponent = ({
  items,
  finalPrice,
  loading,
  paymentMethod,
  onSubmit,
}: MobileStickyCheckoutProps) => {
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* Dropdown summary - slides up */}
      {showSummary && (
        <div
          className="bg-secondary/80 backdrop-blur-xl border-t border-border/10 px-4 pt-4 pb-2 animate-fade-in max-w-lg mx-auto"
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky bar */}
      <div className="bg-background/90 backdrop-blur-xl border-t border-border/10 px-4 pt-3 pb-8 safe-area-inset-bottom max-w-lg mx-auto w-full">
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
