import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, Trash2, Plus, Minus } from "lucide-react";
import { CartItem } from "@/contexts/CartContext";

interface OrderSummaryProps {
  items: CartItem[];
  totalPrice: number;
  finalPrice: number;
  discount: number;
  appliedCoupon: { code: string } | null;
  couponCode: string;
  onCouponChange: (code: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  onRemoveItem: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  applyingCoupon: boolean;
  loading: boolean;
  isFormValid: boolean;
  onSubmit: () => void;
  paymentMethod?: "pix" | "balance" | "card";
}

export const OrderSummary = memo(function OrderSummary({
  items,
  totalPrice,
  finalPrice,
  discount,
  appliedCoupon,
  couponCode,
  onCouponChange,
  onApplyCoupon,
  onRemoveCoupon,
  onRemoveItem,
  onUpdateQuantity,
  applyingCoupon,
  loading,
  isFormValid,
  onSubmit,
  paymentMethod = "pix",
}: OrderSummaryProps) {
  
  const formattedPrices = useMemo(() => ({
    total: totalPrice.toFixed(2).replace('.', ','),
    discount: discount.toFixed(2).replace('.', ','),
    final: finalPrice.toFixed(2).replace('.', ','),
  }), [totalPrice, discount, finalPrice]);

  const isSubmitDisabled = loading || finalPrice < 1 || !isFormValid;

  return (
    <div className="hidden lg:block w-full lg:w-[340px] space-y-5">
      {/* Cupom de desconto */}
      <div className="bg-secondary/50 rounded-2xl border border-border/10 p-5">
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Cupom de desconto</h3>
        <div className="flex gap-2">
          <Input
            id="desktop-coupon-code"
            name="desktop-coupon"
            value={couponCode}
            onChange={(e) => onCouponChange(e.target.value.toUpperCase())}
            placeholder="Digite o código do cupom"
            disabled={!!appliedCoupon}
            className="h-10 bg-background border-border/10 text-foreground placeholder:text-muted-foreground/50 rounded-xl text-[13px] flex-1"
          />
          {appliedCoupon ? (
            <Button 
              variant="outline" 
              onClick={onRemoveCoupon}
              className="h-10 border-border/20 text-muted-foreground hover:bg-muted rounded-xl px-4 text-[13px]"
            >
              Remover
            </Button>
          ) : (
            <Button 
              variant="outline" 
              onClick={onApplyCoupon}
              disabled={applyingCoupon || !couponCode.trim()}
              className="h-10 border-primary/30 text-primary hover:bg-primary/10 rounded-xl px-5 text-[13px] font-medium"
            >
              {applyingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
            </Button>
          )}
        </div>
        {appliedCoupon && (
          <p className="text-green-500 text-[12px] mt-2">
            Cupom {appliedCoupon.code} aplicado!
          </p>
        )}
      </div>

      {/* Resumo */}
      <div className="bg-secondary/50 rounded-2xl border border-border/10 p-5">
        <h3 className="text-[15px] font-semibold text-foreground mb-4">Resumo</h3>
        
        {/* Items */}
        <div className="space-y-4 mb-5">
          {items.map((item) => (
            <div key={item.id} className="flex gap-3">
              <div className="w-14 h-14 rounded-xl bg-muted overflow-hidden flex-shrink-0 border border-border/10">
                <img 
                  src={item.image} 
                  alt={item.name} 
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-foreground text-[13px] font-medium leading-tight line-clamp-2">{item.name}</p>
                <div className="flex items-center gap-3 mt-2">
                  {/* Quantity Controls */}
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                      disabled={item.quantity <= 1}
                      className="w-6 h-6 rounded-lg bg-muted border border-border/10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-7 text-center text-[12px] text-foreground font-medium">{item.quantity}</span>
                    <button 
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      className="w-6 h-6 rounded-lg bg-muted border border-border/10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/20 transition-colors"
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {/* Remove Button */}
                  <button 
                    onClick={() => onRemoveItem(item.id)}
                    className="w-6 h-6 rounded-lg bg-muted border border-border/10 flex items-center justify-center text-muted-foreground hover:text-red-500 hover:border-red-500/30 transition-colors"
                    aria-label={`Remover ${item.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              <div className="text-right flex-shrink-0">
                <p className="text-foreground text-[13px] font-medium">
                  R$ {(item.price * item.quantity).toFixed(2).replace('.', ',')}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-2 border-t border-border/10 pt-4 mb-5">
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Preço oficial</span>
            <span className="text-foreground">R$ {formattedPrices.total}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Desconto</span>
            <span className={discount > 0 ? "text-green-500" : "text-foreground"}>
              {discount > 0 ? `-R$ ${formattedPrices.discount}` : "R$ 0,00"}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="text-[14px] text-foreground font-medium">Total</span>
            <span className="text-[22px] text-primary font-bold">
              R$ {formattedPrices.final}
            </span>
          </div>
        </div>

        {/* Pay Button - Desktop */}
        <Button 
          onClick={onSubmit}
          disabled={isSubmitDisabled}
          className="w-full h-14 bg-foreground hover:bg-foreground/90 text-background font-bold rounded-xl text-base hidden lg:flex"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Finalizar Compra"
          )}
        </Button>

        {/* Terms */}
        <p className="text-[11px] text-muted-foreground/60 text-center mt-4 leading-relaxed">
          Ao clicar em "Pagar", reconheço que li e aceito os{" "}
          <Link to="/terms" className="text-primary hover:underline">termos e condições</Link>
          , e a{" "}
          <Link to="/terms" className="text-primary hover:underline">política de privacidade</Link>.
        </p>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground text-[12px]">
          <div className="w-4 h-4 rounded-full border border-border/20 flex items-center justify-center">
            <Lock className="w-2.5 h-2.5" />
          </div>
          <span>Compra 100% segura</span>
        </div>
      </div>
    </div>
  );
});
