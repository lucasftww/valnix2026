import { X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Floating support cluster: WhatsApp (primary for BR — direct line to admin)
 * + Discord (community). Stacked vertically bottom-right.
 *
 * Shown on home, category, AND product detail pages (high-intent context
 * where customers want to ask "is this safe?" before committing). Hidden on
 * admin / checkout / payment / post-payment pages where it would distract.
 */
export const FloatingContactButtons = () => {
  const [isVisible, setIsVisible] = useState(true);
  const location = useLocation();
  const path = location.pathname;

  const isAdminPage = path.startsWith("/admin") || path.startsWith("/charles");
  const isCheckoutPage = path.startsWith("/checkout");
  const isProductPage = path.startsWith("/product/");
  const isPaymentFlow =
    path.startsWith("/card-callback") ||
    path.startsWith("/painel-pagar") ||
    path.startsWith("/entrega-prioritaria") ||
    path.startsWith("/protecao-total") ||
    path.startsWith("/order");
  const shouldShow = !isAdminPage && !isCheckoutPage && !isPaymentFlow;

  if (!shouldShow || !isVisible) return null;

  // Push the cluster higher on /product/* mobile so it doesn't collide
  // with the sticky "Comprar agora" bar.
  const bottomClass = isProductPage ? 'bottom-24 md:bottom-20' : 'bottom-20';

  // Replace WhatsApp number with the admin's real number (digits only,
  // country code first — no + or spaces). Falls back to a placeholder so
  // the button still renders for testing.
  const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER || "5511999999999";
  const whatsappMsg = encodeURIComponent(
    "Olá! Vim pelo site da VALNIX e quero tirar uma dúvida.",
  );

  return (
    <div className={`fixed right-4 ${bottomClass} z-40 flex flex-col items-end gap-3`}>
      {/* Dismiss button — shared close for the whole cluster */}
      <button
        onClick={() => setIsVisible(false)}
        className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-muted/90 hover:bg-muted flex items-center justify-center z-10 transition-colors shadow-sm before:absolute before:inset-[-8px] before:content-['']"
        aria-label="Fechar botões de contato"
      >
        <X className="h-3.5 w-3.5 text-foreground" />
      </button>

      {/* WhatsApp — primary CTA for BR e-commerce trust */}
      <a
        href={`https://wa.me/${whatsappNumber}?text=${whatsappMsg}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-[#25D366] hover:bg-[#1DA851] shadow-lg shadow-[#25D366]/30 transition-colors flex items-center justify-center"
      >
        <svg
          className="h-7 w-7 md:h-8 md:w-8 text-white"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
        </svg>
      </a>

      {/* Discord (community) */}
      <a
        href="https://discord.gg/4kpUy45CM8"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Entrar no Discord"
        className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-discord hover:bg-discord/90 shadow-lg transition-colors flex items-center justify-center"
      >
        <svg
          className="h-6 w-6 text-white"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      </a>
    </div>
  );
};
