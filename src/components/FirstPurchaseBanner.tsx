import { memo, useState, useEffect } from 'react';
import { Tag, X, Check } from 'lucide-react';

const DISMISS_KEY = 'valnix_first_purchase_banner_v3';
const COUPON_CODE = 'PRIMEIRA5';
const REOPEN_AFTER_DAYS = 14;

/**
 * Slim top-of-page promo strip. Sits ABOVE the sticky header in a shared
 * sticky wrapper (see Index.tsx) so it never overlaps the logo.
 *
 * Mobile-first compact design with a copy-to-clipboard inline button.
 * Dismissible — persisted to localStorage with a 14-day cool-down so
 * returning visitors see the cupom hint again after 2 weeks instead of
 * having it disappear forever. Returns null when dismissed so the
 * wrapper collapses cleanly.
 */
const FirstPurchaseBannerComponent = () => {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid CLS
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (!stored) {
        setDismissed(false);
        return;
      }
      const ts = parseInt(stored, 10);
      if (!Number.isFinite(ts)) {
        setDismissed(false);
        return;
      }
      // Show again if it's been >14 days since dismissal.
      const isStale = Date.now() - ts > REOPEN_AFTER_DAYS * 24 * 60 * 60 * 1000;
      setDismissed(!isStale);
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    // Persist timestamp so we can re-show after 14d.
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COUPON_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (dismissed) return null;

  return (
    // relative + z-[55] needed so the banner stays in front of the sticky
    // header (z-50) during the scroll transition — otherwise the header
    // slides up underneath and crops the banner content (visual bug
    // captured in production screenshot before this fix).
    <div className="relative z-[55] bg-gradient-to-r from-primary via-primary to-primary/95 text-primary-foreground">
      <div className="container max-w-7xl px-4 py-1.5 sm:py-2 flex items-center justify-center gap-2 sm:gap-3 relative">
        <div className="flex items-center gap-2 text-[11px] sm:text-xs md:text-sm font-medium text-center">
          <Tag className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="hidden sm:inline">Primeira compra? Ganhe</span>
          <span className="sm:hidden">Ganhe</span>
          <strong className="font-bold">5% OFF</strong>
          <span className="hidden xs:inline">com</span>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 font-mono font-bold bg-white/15 hover:bg-white/25 active:bg-white/30 px-2 py-0.5 rounded text-[11px] sm:text-xs transition-colors"
            aria-label="Copiar cupom PRIMEIRA5"
          >
            {copied ? <Check className="w-3 h-3" /> : null}
            {copied ? 'COPIADO' : COUPON_CODE}
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-primary-foreground/70 hover:text-primary-foreground p-1.5 -m-1 rounded hover:bg-white/10"
          aria-label="Fechar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const FirstPurchaseBanner = memo(FirstPurchaseBannerComponent);
