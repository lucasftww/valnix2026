import { memo, useState, useEffect, useRef } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { invokeFunction } from '@/lib/apiHelper';

interface Sale {
  customer: string;
  product: string;
  paid_at: string;
}

const DISMISS_KEY = 'valnix_recent_sales_ticker_v1';
const ROTATE_MS = 6000;
const FIRST_SHOW_MS = 8000;

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'agora mesmo';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

/**
 * Bottom-left floating ticker: "João S. comprou 1200 Robux há 3 min".
 * Rotates through up to 12 real paid orders from the last 24h.
 *
 * - Dismissible (persisted to localStorage for 7 days)
 * - Hidden on checkout / admin / order pages
 * - Hidden if no recent sales exist (keeps the UX honest — no fake data)
 * - Delayed 8s after load so it doesn't compete with first paint
 */
const RecentSalesTickerComponent = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    if (/^\/(checkout|admin|charles|painel-pagar|entrega-prioritaria|protecao-total|order)/.test(path)) return;
    try {
      const ts = localStorage.getItem(DISMISS_KEY);
      if (ts && Date.now() - parseInt(ts, 10) < 7 * 24 * 60 * 60 * 1000) return;
    } catch {}
    setDismissed(false);
  }, []);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await invokeFunction('site-data', {
          method: 'GET',
          queryParams: { type: 'recent-sales' },
        });
        const data = await res.json();
        if (cancelled) return;
        const list = (data.sales as Sale[] | undefined) ?? [];
        if (list.length === 0) return; // honest — show nothing if there are no real recent sales
        setSales(list);
        setVisible(true);
      } catch {
        /* silently fail — ticker is a nice-to-have */
      }
    }, FIRST_SHOW_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [dismissed]);

  useEffect(() => {
    if (!visible || sales.length <= 1) return;
    intervalRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % sales.length);
    }, ROTATE_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [visible, sales.length]);

  const handleDismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  if (dismissed || !visible || sales.length === 0) return null;
  const current = sales[idx];

  return (
    <div
      className="fixed left-4 bottom-20 md:bottom-20 z-40 max-w-[260px] md:max-w-[300px] animate-in slide-in-from-left-4 fade-in duration-300 hidden sm:block"
      role="status"
      aria-live="polite"
    >
      <div className="bg-card border border-border/30 rounded-xl shadow-lg shadow-black/20 p-3 flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
          <ShoppingBag className="w-4 h-4 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-foreground leading-tight">
            <strong className="font-semibold">{current.customer}</strong> comprou{' '}
            <span className="text-primary font-medium">{current.product}</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(current.paid_at)}</p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground/50 hover:text-foreground p-0.5 -m-0.5 flex-shrink-0"
          aria-label="Fechar"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export const RecentSalesTicker = memo(RecentSalesTickerComponent);
