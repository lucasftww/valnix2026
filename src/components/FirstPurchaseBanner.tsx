import { memo, useState, useEffect } from 'react';
import { Tag, X } from 'lucide-react';

const DISMISS_KEY = 'valnix_first_purchase_banner_v1';

/**
 * Slim top-of-page banner offering the PRIMEIRA5 coupon for new visitors.
 * Dismissible — choice persisted to localStorage so it doesn't pester.
 *
 * Only shown on the storefront (Index, Category, ProductDetail). Hidden on
 * checkout/admin/order pages where it would be distracting.
 */
const FirstPurchaseBannerComponent = () => {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid CLS

  useEffect(() => {
    try {
      setDismissed(!!localStorage.getItem(DISMISS_KEY));
    } catch {}
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText('PRIMEIRA5'); } catch {}
  };

  if (dismissed) return null;

  return (
    <div className="bg-primary text-primary-foreground border-b border-primary-foreground/10">
      <div className="container px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <Tag className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">
            Primeira compra? Use{' '}
            <button
              onClick={handleCopy}
              className="font-mono font-bold underline underline-offset-2 hover:opacity-90"
              aria-label="Copiar cupom PRIMEIRA5"
            >
              PRIMEIRA5
            </button>{' '}
            no carrinho e ganhe 5% OFF.
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-primary-foreground/70 hover:text-primary-foreground p-1 -m-1"
          aria-label="Fechar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const FirstPurchaseBanner = memo(FirstPurchaseBannerComponent);
