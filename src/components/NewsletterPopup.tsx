import { useState, useEffect, useCallback, memo } from 'react';
import { X, Mail, Tag, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';

const DISMISS_KEY = 'valnix_newsletter_popup_v1';
const SHOW_DELAY_MS = 20_000;
const REOPEN_AFTER_DAYS = 30;

const COUPON_CODE = 'PRIMEIRA5';
const COUPON_LABEL = '5% OFF na primeira compra';

const emailSchema = z.string().trim().email().max(255);

/**
 * Modal-ish popup that appears 20s after first visit (per browser) and
 * offers an email signup in exchange for the PRIMEIRA5 coupon. Dismissed
 * choices are persisted to localStorage with a 30-day cool-down so the
 * popup doesn't pester repeat visitors.
 *
 * Hidden on:
 *   - /checkout, /admin, /charles, /entrega-prioritaria, /protecao-total,
 *     /painel-pagar, /order — where a popup would disrupt the flow
 *   - When user already subscribed (this session)
 */
function shouldShowPopup(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  if (/^\/(checkout|admin|charles|entrega-prioritaria|protecao-total|painel-pagar|order)/.test(path)) {
    return false;
  }
  try {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (!stored) return true;
    const ts = parseInt(stored, 10);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > REOPEN_AFTER_DAYS * 24 * 60 * 60 * 1000;
  } catch { return true; }
}

const NewsletterPopupComponent = () => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!shouldShowPopup()) return;
    const t = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const handleDismiss = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  }, []);

  // ESC + click outside closes; success state auto-closes after 4s.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleDismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleDismiss]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast({ title: 'Email inválido', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const normalized = parsed.data.toLowerCase();
      const { error } = await supabase
        .from('newsletter_subscribers')
        .insert({ email: normalized, user_id: null });
      // 23505 = unique violation; treat as success (already subscribed → still gets coupon)
      if (error && error.code !== '23505') throw error;
      setSuccess(true);
      try {
        await navigator.clipboard.writeText(COUPON_CODE);
        toast({ title: 'Cupom copiado!', description: `${COUPON_CODE} colado na área de transferência.` });
      } catch {
        toast({ title: 'Inscrito!', description: `Use ${COUPON_CODE} no carrinho.` });
      }
      // Persist dismissal so the popup doesn't reopen for this user.
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
      setTimeout(() => setOpen(false), 4000);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Newsletter popup error:', err);
      toast({ title: 'Erro', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, toast]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) handleDismiss(); }}
    >
      <div className="relative w-full max-w-sm bg-card border border-border/30 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Close */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted/50"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-5 text-center border-b border-border/10">
          <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-primary/20 flex items-center justify-center">
            <Tag className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Ganhe 5% OFF agora</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre seu e-mail e receba o cupom <strong className="text-primary font-mono">{COUPON_CODE}</strong> para sua primeira compra.
          </p>
        </div>

        <div className="p-5">
          {success ? (
            <div className="flex flex-col items-center text-center py-2 space-y-2">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <Check className="w-5 h-5 text-success" />
              </div>
              <p className="text-sm font-semibold text-foreground">Tudo certo!</p>
              <code className="bg-primary/10 text-primary px-3 py-1.5 rounded font-mono text-sm font-bold">{COUPON_CODE}</code>
              <p className="text-xs text-muted-foreground">
                Use no carrinho — {COUPON_LABEL}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="pl-10 h-11"
                  required
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold"
              >
                {loading ? 'Enviando...' : 'Quero meu cupom'}
              </Button>
              <button
                type="button"
                onClick={handleDismiss}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
              >
                Não, obrigado
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export const NewsletterPopup = memo(NewsletterPopupComponent);
