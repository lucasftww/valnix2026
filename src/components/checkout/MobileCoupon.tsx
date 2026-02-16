import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface MobileCouponProps {
  couponCode: string;
  onCouponChange: (code: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  appliedCoupon: { code: string } | null;
  applyingCoupon: boolean;
  discount: number;
}

export const MobileCoupon = memo(function MobileCoupon({
  couponCode,
  onCouponChange,
  onApplyCoupon,
  onRemoveCoupon,
  appliedCoupon,
  applyingCoupon,
  discount,
}: MobileCouponProps) {
  return (
    <div className="lg:hidden mx-auto w-full max-w-lg">
      <div className="flex items-center gap-2">
        <Input
          id="mobile-coupon-code"
          name="mobile-coupon"
          value={couponCode}
          onChange={(e) => onCouponChange(e.target.value.toUpperCase())}
          placeholder="Cupom de desconto"
          disabled={!!appliedCoupon}
          className="h-9 bg-transparent border-0 border-b border-border/20 rounded-none text-foreground placeholder:text-muted-foreground/40 text-[13px] flex-1 focus-visible:ring-0 focus-visible:border-primary/50 px-0"
        />
        {appliedCoupon ? (
          <button
            onClick={onRemoveCoupon}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Remover
          </button>
        ) : (
          <button
            onClick={onApplyCoupon}
            disabled={applyingCoupon || !couponCode.trim()}
            className="text-[12px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-30 shrink-0"
          >
            {applyingCoupon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Aplicar"}
          </button>
        )}
      </div>
      {appliedCoupon && (
        <p className="text-green-500/80 text-[11px] mt-1">
          {appliedCoupon.code} · -R$ {discount.toFixed(2).replace(".", ",")}
        </p>
      )}
    </div>
  );
});
