import { memo, useEffect, useState } from 'react';
import { ShoppingCart, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '@/contexts/CartContext';

const DISMISS_KEY = 'valnix_cart_nudge_dismissed_v1';
const SHOW_AFTER_MS = 3000;
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h cooldown per dismiss

/**
 * Tiny bottom-left card that surfaces when a returning visitor has items
 * left in their cart from a previous session. Drives cart-recovery without
 * needing email automation infrastructure.
 *
 * Triggers:
 *   - User has 1+ items in localStorage cart at page load
 *   - 3s delay after first paint (lets the user settle)
 *   - Hidden on /checkout, /cart, /admin, /charles, /order routes
 *   - Hidden when CartSidebar is open (avoid double-prompt)
 *   - Dismissible with 6h cooldown
 */
const CartAbandonmentNudgeComponent = () => {
  const { items, totalItems, finalPrice } = useCart();
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only nudge on shopping surfaces
    const path = location.pathname;
    if (/^\/(checkout|cart|charles|admin|order|painel-pagar|entrega-prioritaria|protecao-total)/.test(path)) {
      setVisible(false);
      return;
    }
    if (items.length === 0) {
      setVisible(false);
      return;
    }

    // Honor cooldown
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored) {
        const ts = parseInt(stored, 10);
        if (Number.isFinite(ts) && Date.now() - ts < COOLDOWN_MS) return;
      }
    } catch {}

    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [items.length, location.pathname]);

  const handleDismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  if (!visible || items.length === 0) return null;

  return (
    <div
      className="fixed left-4 bottom-24 md:bottom-20 z-40 max-w-[280px] md:max-w-[320px] animate-in slide-in-from-left-4 fade-in duration-300"
      role="status"
    >
      <div className="bg-card border border-primary/30 rounded-xl shadow-lg shadow-primary/10 p-3 pr-9 relative">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-muted-foreground/60 hover:text-foreground p-1 -m-1"
          aria-label="Fechar"
        >
          <X className="w-3 h-3" />
        </button>

        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <ShoppingCart className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-foreground leading-tight">
              Você esqueceu algo!
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
              {totalItems} {totalItems === 1 ? 'item' : 'itens'} no carrinho • R$ {finalPrice.toFixed(2).replace('.', ',')}
            </p>
            <Link
              to="/checkout"
              className="inline-block mt-2 text-[11px] font-bold text-primary hover:underline"
              onClick={() => {
                // Don't snooze when user actually clicks through — they're
                // engaging, not dismissing.
                try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
              }}
            >
              Finalizar compra →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CartAbandonmentNudge = memo(CartAbandonmentNudgeComponent);
