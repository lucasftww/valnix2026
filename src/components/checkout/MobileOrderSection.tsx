import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Lock, ShieldCheck, Zap, Tag } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { CouponInput } from '@/components/CouponInput';

/**
 * Mobile-only checkout summary section. The desktop OrderSummary uses
 * `hidden lg:block`, leaving the mobile flow without:
 *   - coupon input (lost first-purchase 5% conversion)
 *   - discount breakdown (customer can't tell their cupom is working)
 *   - trust signals (PIX seguro, entrega imediata, garantia)
 *   - terms acceptance copy (compliance)
 *
 * This component fills that gap on screens < lg. It renders after the
 * PersonalInfoForm and before the sticky bottom bar so customers can
 * apply a coupon + see the breakdown without scrolling away from the form.
 */
const MobileOrderSectionComponent = () => {
  const { subtotal, discount, finalPrice, appliedCoupon } = useCart();

  const formatted = {
    subtotal: subtotal.toFixed(2).replace('.', ','),
    discount: discount.toFixed(2).replace('.', ','),
    final: finalPrice.toFixed(2).replace('.', ','),
  };

  return (
    <div className="lg:hidden space-y-4">
      {/* Coupon input */}
      <div className="bg-secondary/40 border border-border/20 rounded-xl p-3">
        <CouponInput variant="compact" />
      </div>

      {/* Totals breakdown — same shape as desktop OrderSummary */}
      <div className="bg-secondary/40 border border-border/20 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="text-foreground">R$ {formatted.subtotal}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-[13px]">
            <span className="text-success flex items-center gap-1">
              <Tag className="w-3 h-3" /> Desconto{appliedCoupon ? ` (${appliedCoupon.code})` : ''}
            </span>
            <span className="text-success font-medium">− R$ {formatted.discount}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-2 border-t border-border/10">
          <span className="text-[14px] text-foreground font-medium">Total</span>
          <span className="text-[20px] text-primary font-bold">R$ {formatted.final}</span>
        </div>
      </div>

      {/* Trust signals — reduces last-mile abandonment */}
      <div className="space-y-2 px-1 text-[12px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Lock className="w-3.5 h-3.5 text-success" />
          <span>Pagamento 100% seguro via PIX</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Zap className="w-3.5 h-3.5 text-success" />
          <span>Entrega imediata após confirmação</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          <span>Garantia de reposição em códigos inválidos</span>
        </div>
      </div>

      {/* Terms — same copy as desktop sidebar, compliance */}
      <p className="text-[11px] text-muted-foreground/60 text-center px-2 leading-relaxed pb-1">
        Ao finalizar a compra, você aceita os{' '}
        <Link to="/terms" className="text-primary underline">termos e condições</Link>
        {' '}e a{' '}
        <Link to="/terms" className="text-primary underline">política de privacidade</Link>.
      </p>
    </div>
  );
};

export const MobileOrderSection = memo(MobileOrderSectionComponent);
