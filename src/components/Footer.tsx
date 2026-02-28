import { Mail, MessageCircle, Shield, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import pixLogo from "@/assets/pix-logo.png";
import visaLogo from "@/assets/visa-logo.svg";
import mastercardLogo from "@/assets/mastercard-logo.svg";
import googleSafe from "@/assets/google-safe.png";
import nortonSecured from "@/assets/norton-secured.png";
import reclameAqui from "@/assets/reclame-aqui.png";
import { NewsletterForm } from "@/components/NewsletterForm";
import { useCategoriesApi } from "@/hooks/useApiData";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useIsMobile } from "@/hooks/use-mobile";

interface FooterProps {
  showFullVersion?: boolean;
}

import { memo } from "react";

const FooterComponent = ({ showFullVersion = true }: FooterProps) => {
  const isMobile = useIsMobile();
  const { data: categories = [] } = useCategoriesApi();

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="w-full bg-muted/20 border-t border-border/10 mt-16 content-lazy">
      {/* Main Footer Content */}
      {showFullVersion && (
        <>
          {/* Back to Top Button */}
          <div className="border-b border-border/30 py-4">
            <div className="container px-4 md:px-8 flex justify-center">
              <Button 
                onClick={scrollToTop}
                variant="ghost"
                className="text-muted-foreground hover:text-foreground font-medium px-6 transition-colors rounded-full text-sm"
              >
                <ArrowUp className="w-4 h-4 mr-2" />
                Voltar ao topo
              </Button>
            </div>
          </div>
        </>
      )}

      {showFullVersion && isMobile && (
        <div className="px-0 py-0">
          {/* Mobile Accordion Layout */}
          <Accordion type="single" collapsible className="w-full">
            {/* Atendimento ao Cliente */}
            <AccordionItem value="item-1" className="border-b border-border/30">
              <AccordionTrigger className="px-6 py-4 text-foreground font-semibold text-sm tracking-wide hover:no-underline">
                Atendimento ao Cliente
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <ul className="space-y-3">
                  <li>
                    <a 
                      href="https://discord.gg/ZYdz9xYdq5" 
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-foreground hover:text-primary transition-colors flex items-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Discord
                    </a>
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            {/* Políticas */}
            <AccordionItem value="item-2" className="border-b border-border/30">
              <AccordionTrigger className="px-6 py-4 text-foreground font-semibold text-sm tracking-wide hover:no-underline">
                Políticas
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <ul className="space-y-3">
                  <li>
                    <Link to="/about" className="text-sm text-foreground hover:text-primary transition-colors block">
                      Sobre Nós
                    </Link>
                  </li>
                  <li>
                    <Link to="/terms" className="text-sm text-foreground hover:text-primary transition-colors block">
                      Termos e Condições
                    </Link>
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            {/* Categorias */}
            <AccordionItem value="item-3" className="border-b border-border/30">
              <AccordionTrigger className="px-6 py-4 text-foreground font-semibold text-sm tracking-wide hover:no-underline">
                Categorias
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <ul className="space-y-3">
                  {categories.map((category) => (
                    <li key={category.id}>
                      <Link to={`/${category.slug}`} className="text-sm text-foreground hover:text-primary transition-colors block">
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>

            {/* Newsletter */}
            <AccordionItem value="item-4" className="border-b border-border/30">
              <AccordionTrigger className="px-6 py-4 text-foreground font-semibold text-sm tracking-wide hover:no-underline">
                Newsletter
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <NewsletterForm showTitle={false} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Warning Message and Payment Methods - Mobile */}
          <div className="px-6 py-6 space-y-6 border-t border-border/30">
            {/* Warning Message */}
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground leading-relaxed">
                Preços e condições de pagamento exclusivos para compras neste site oficial, podendo variar com o tempo da oferta. 
                Evite comprar produtos mais baratos ou de outras lojas, pois você pode estar sendo enganado(a) por um golpista. 
                Caso você compre os mesmos produtos em outras lojas não nos responsabilizamos por quaisquer problemas.
              </p>
            </div>

            {/* Payment Methods */}
            <div className="flex flex-col items-center gap-3 w-full">
              <h3 className="text-foreground font-bold text-sm text-center">Métodos de pagamento</h3>
              <div className="flex items-center justify-center gap-1.5">
                <img src={pixLogo} alt="PIX" className="h-7 w-auto object-contain" width={48} height={28} loading="lazy" />
                <img src={visaLogo} alt="Visa" className="h-7 w-auto object-contain" width={48} height={28} loading="lazy" />
                <img src={mastercardLogo} alt="Mastercard" className="h-7 w-auto object-contain" width={48} height={28} loading="lazy" />
              </div>
            </div>
          </div>

          {/* Security Badges - Mobile */}
          <div className="px-6 py-6 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider mb-4">Segurança verificada</p>
            <div className="flex items-center justify-center gap-5">
              <img src={nortonSecured} alt="Norton Secured" className="h-8 object-contain opacity-70" width={60} height={32} loading="lazy" />
              <img src={reclameAqui} alt="Reclame Aqui" className="h-6 object-contain opacity-70" width={60} height={24} loading="lazy" />
              <img src={googleSafe} alt="Google Safe Browsing" className="h-8 object-contain opacity-70" width={60} height={32} loading="lazy" />
            </div>
          </div>

          {/* Copyright - Mobile */}
          <div className="px-6 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              © 2025-2026 VALNIX - Todos os direitos reservados
            </p>
          </div>
        </div>
      )}

      {showFullVersion && !isMobile && (
        <div className="container px-4 md:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Atendimento ao Cliente */}
          <div>
            <h3 className="text-foreground font-semibold text-sm mb-4 tracking-wide">
              Atendimento ao Cliente
            </h3>
            <ul className="space-y-3">
              <li>
                <a 
                  href="https://discord.gg/ZYdz9xYdq5" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Discord
                </a>
              </li>
            </ul>
          </div>

          {/* Políticas */}
          <div>
            <h3 className="text-foreground font-semibold text-sm mb-4 tracking-wide">
              Políticas
            </h3>
            <ul className="space-y-3">
              <li>
                <Link to="/about" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Sobre Nós
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Termos e Condições
                </Link>
              </li>
            </ul>
          </div>

          {/* Categorias */}
          <div>
            <h3 className="text-foreground font-semibold text-sm mb-4 tracking-wide">
              Categorias
            </h3>
            <ul className="space-y-2">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link to={`/${category.slug}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <NewsletterForm />
          </div>
          </div>

          {/* Bottom Section */}
          <div className="mt-12 pt-8 border-t border-border/30">
          {/* Warning Message and Payment Methods */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 mb-8">
            {/* Warning Message */}
            <div className="flex items-start gap-3 flex-1">
              <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Preços e condições de pagamento exclusivos para compras neste site oficial, podendo variar com o tempo da oferta. 
                Evite comprar produtos mais baratos ou de outras lojas, pois você pode estar sendo enganado(a) por um golpista. 
                Caso você compre os mesmos produtos em outras lojas não nos responsabilizamos por quaisquer problemas.
              </p>
            </div>

            {/* Payment Methods */}
            <div className="flex flex-col items-center gap-3 flex-shrink-0 px-6 py-5 rounded-lg">
              <h3 className="text-foreground font-bold text-sm text-center">Métodos de pagamento</h3>
              <div className="flex items-center justify-center gap-2">
                <img src={pixLogo} alt="PIX" className="h-9 w-auto object-contain" width={60} height={36} loading="lazy" />
                <img src={visaLogo} alt="Visa" className="h-9 w-auto object-contain" width={60} height={36} loading="lazy" />
                <img src={mastercardLogo} alt="Mastercard" className="h-9 w-auto object-contain" width={60} height={36} loading="lazy" />
              </div>
            </div>
          </div>

          {/* Security Badges */}
          <div className="mb-8 pb-8 border-b border-border/30">
            <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider mb-4">Segurança verificada</p>
            <div className="flex items-center justify-center gap-8">
              <img src={nortonSecured} alt="Norton Secured" className="h-14 object-contain opacity-70" width={80} height={56} loading="lazy" />
              <img src={reclameAqui} alt="Reclame Aqui" className="h-8 object-contain opacity-70" width={80} height={32} loading="lazy" />
              <img src={googleSafe} alt="Google Safe Browsing" className="h-14 object-contain opacity-70" width={80} height={56} loading="lazy" />
            </div>
          </div>

            {/* Copyright */}
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                © 2025-2026 VALNIX - Todos os direitos reservados
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Simplified Footer for other pages */}
      {!showFullVersion && (
        <div className="container px-4 md:px-8 py-6 border-t border-border/30">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              © 2025-2026 VALNIX - Todos os direitos reservados
            </p>
          </div>
        </div>
      )}
    </footer>
  );
};

export const Footer = memo(FooterComponent);