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
    <div className="lg:hidden bg-secondary/50 backdrop-blur-xl rounded-2xl border border-border/10 p-4">
      <div className="flex gap-2">
        <Input
          id="mobile-coupon-code"
          name="mobile-coupon"
          value={couponCode}
          onChange={(e) => onCouponChange(e.target.value.toUpperCase())}
          placeholder="Código do cupom"
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
            className="h-10 border-border/20 text-muted-foreground hover:bg-muted rounded-xl px-4 text-[13px]"
          >
            {applyingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
          </Button>
        )}
      </div>
      {appliedCoupon && (
        <p className="text-green-500 text-[12px] mt-2">
          Cupom {appliedCoupon.code} aplicado! -R$ {discount.toFixed(2).replace(".", ",")}
        </p>
      )}
    </div>
  );
});
