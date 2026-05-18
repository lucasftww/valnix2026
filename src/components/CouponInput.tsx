import { useState, useCallback } from 'react';
import { Tag, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart } from '@/contexts/CartContext';
import { invokeFunction } from '@/lib/apiHelper';
import { useToast } from '@/hooks/use-toast';

interface CouponInputProps {
  /** Compact = inline single-line variant (for cart sidebar);
   *  full = stacked with hint copy (for checkout). */
  variant?: 'compact' | 'full';
}

/**
 * Coupon input — validates against the public /api/site-data?type=coupon
 * preview endpoint, stashes the resolved coupon in CartContext (localStorage).
 * The authoritative re-validation happens in /api/create-order at checkout time,
 * so a stale preview won't actually let the customer pay less than they should.
 */
export function CouponInput({ variant = 'compact' }: CouponInputProps) {
  const { appliedCoupon, applyCoupon, clearCoupon, subtotal } = useCart();
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApply = useCallback(async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await invokeFunction('site-data', {
        method: 'GET',
        queryParams: { type: 'coupon', code: trimmed },
      });
      const data = await res.json();
      if (!res.ok || !data.coupon) {
        toast({
          title: 'Cupom inválido',
          description: data.error || 'Verifique o código e tente novamente.',
          variant: 'destructive',
        });
        return;
      }
      const c = data.coupon;
      if (subtotal < Number(c.min_order || 0)) {
        toast({
          title: 'Pedido mínimo não atingido',
          description: `Este cupom exige pedido mínimo de R$ ${Number(c.min_order).toFixed(2).replace('.', ',')}.`,
          variant: 'destructive',
        });
        return;
      }
      applyCoupon({
        code: c.code,
        type: c.type,
        value: Number(c.value),
        min_order: Number(c.min_order || 0),
        max_discount: c.max_discount ? Number(c.max_discount) : null,
        description: c.description,
      });
      setCode('');
      toast({ title: 'Cupom aplicado!', description: c.description || `Cupom ${c.code} ativo.` });
    } catch (err) {
      toast({
        title: 'Erro ao validar cupom',
        description: 'Tente novamente em alguns segundos.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [code, applyCoupon, subtotal, toast]);

  if (appliedCoupon) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/30">
        <div className="flex items-center gap-2 min-w-0">
          <Check className="w-4 h-4 text-success shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-success truncate">
              Cupom {appliedCoupon.code} aplicado
            </p>
            {appliedCoupon.description && variant === 'full' && (
              <p className="text-[10px] text-muted-foreground truncate">{appliedCoupon.description}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0 hover:bg-destructive/10 hover:text-destructive"
          onClick={clearCoupon}
          aria-label="Remover cupom"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
            placeholder="Cupom de desconto"
            className="pl-9 h-9 text-sm uppercase"
            maxLength={40}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3"
          onClick={handleApply}
          disabled={!code.trim() || loading}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Aplicar'}
        </Button>
      </div>
      {variant === 'full' && (
        <p className="text-[10px] text-muted-foreground">
          Primeira compra? Use <strong className="text-foreground">PRIMEIRA5</strong> e ganhe 5% OFF.
        </p>
      )}
    </div>
  );
}
