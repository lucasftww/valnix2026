import { Mail, MessageCircle, Shield, ArrowUp, Headphones, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import pixLogo from "@/assets/pix-logo.png";
import googleSafe from "@/assets/google-safe.png";
import nortonSecured from "@/assets/norton-secured.png";
import reclameAqui from "@/assets/reclame-aqui.png";
import { NewsletterForm } from "@/components/NewsletterForm";
import { useCategories } from "@/hooks/firebase";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface FooterProps {
  showFullVersion?: boolean;
}

export const Footer = ({ showFullVersion = true }: FooterProps) => {
  const isMobile = useIsMobile();
  const { data: categories = [] } = useCategories();

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="w-full bg-background border-t border-border mt-16">
      {/* Main Footer Content */}
      {showFullVersion && (
        <>
          {/* Back to Top Button - Only on homepage */}
          <div className="border-b border-border/30 py-4">
            <div className="container px-4 md:px-8 flex justify-center">
              <Button 
                onClick={scrollToTop}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 transition-colors rounded-full"
              >
                <ArrowUp className="w-4 h-4 mr-2" />
                Voltar ao topo
              </Button>
            </div>
          </div>

          {/* Trust Badges - Carousel no mobile, grid no desktop */}
          <div className="bg-black/40 py-8 border-b border-border/30">
            <div className="container px-4 md:px-8">
              {/* Mobile: Carrossel */}
              {isMobile ? (
                <div className="relative max-w-md mx-auto">
                  <Carousel 
                    opts={{
                      align: "start",
                      loop: true,
                    }}
                    className="w-full"
                  >
                    <CarouselContent>
                      <CarouselItem>
                        <div className="flex items-start gap-3 px-4">
                          <div className="flex-shrink-0">
                            <Shield className="w-6 h-6 text-primary" strokeWidth={1.5} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Compra Segura</h4>
                            <p className="text-xs text-muted-foreground">Ambiente seguro para pagamentos online</p>
                          </div>
                        </div>
                      </CarouselItem>
                      
                      <CarouselItem>
                        <div className="flex items-start gap-3 px-4">
                          <div className="flex-shrink-0">
                            <Mail className="w-6 h-6 text-primary" strokeWidth={1.5} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Envio Imediato</h4>
                            <p className="text-xs text-muted-foreground">Envio imediato via E-mail após a compra</p>
                          </div>
                        </div>
                      </CarouselItem>
                      
                      <CarouselItem>
                        <div className="flex items-start gap-3 px-4">
                          <div className="flex-shrink-0">
                            <Headphones className="w-6 h-6 text-primary" strokeWidth={1.5} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Suporte Profissional</h4>
                            <p className="text-xs text-muted-foreground">Equipe de suporte das 10h às 23h diariamente</p>
                          </div>
                        </div>
                      </CarouselItem>
                      
                      <CarouselItem>
                        <div className="flex items-start gap-3 px-4">
                          <div className="flex-shrink-0">
                            <RefreshCcw className="w-6 h-6 text-primary" strokeWidth={1.5} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-1">Entrega ou Reembolso</h4>
                            <p className="text-xs text-muted-foreground">Caso haja qualquer tipo de problema, devolvemos seu dinheiro integralmente!</p>
                          </div>
                        </div>
                      </CarouselItem>
                    </CarouselContent>
                    <div className="flex justify-center gap-3 mt-6">
                      <CarouselPrevious className="static translate-y-0 bg-primary/10 hover:bg-primary/20 border-primary/30 text-foreground h-8 w-8" aria-label="Ver benefício anterior" />
                      <CarouselNext className="static translate-y-0 bg-primary/10 hover:bg-primary/20 border-primary/30 text-foreground h-8 w-8" aria-label="Ver próximo benefício" />
                    </div>
                  </Carousel>
                </div>
              ) : (
                /* Desktop: Grid */
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <Shield className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">Compra Segura</h4>
                      <p className="text-xs text-muted-foreground">Ambiente seguro para pagamentos online</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <Mail className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">Envio Imediato</h4>
                      <p className="text-xs text-muted-foreground">Envio imediato via E-mail após a compra</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <Headphones className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">Suporte Profissional</h4>
                      <p className="text-xs text-muted-foreground">Equipe de suporte das 10h às 23h diariamente</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <RefreshCcw className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">Entrega ou Reembolso</h4>
                      <p className="text-xs text-muted-foreground">Caso haja qualquer tipo de problema, devolvemos seu dinheiro integralmente!</p>
                    </div>
                  </div>
                </div>
              )}
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
              <AccordionTrigger className="px-6 py-4 text-primary font-bold text-base uppercase tracking-wide hover:no-underline">
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
              <AccordionTrigger className="px-6 py-4 text-primary font-bold text-base uppercase tracking-wide hover:no-underline">
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
              <AccordionTrigger className="px-6 py-4 text-primary font-bold text-base uppercase tracking-wide hover:no-underline">
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
              <AccordionTrigger className="px-6 py-4 text-primary font-bold text-base uppercase tracking-wide hover:no-underline">
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
              <div className="flex items-center justify-center gap-2">
                <div className="w-12 h-8 rounded-md bg-[#00b894] flex items-center justify-center">
                  <img src={pixLogo} alt="PIX" className="h-5 w-auto object-contain brightness-0 invert" width={20} height={20} />
                </div>
                <div className="w-12 h-8 rounded-md bg-[#1a1f71] flex items-center justify-center">
                  <svg viewBox="0 0 48 32" className="w-8 h-5"><path d="M19.5 25.2L22.1 6.8H26.1L23.5 25.2H19.5Z" fill="#fff"/><path d="M38.4 7.2C37.6 6.9 36.3 6.5 34.7 6.5C30.7 6.5 27.9 8.6 27.9 11.5C27.8 13.7 29.8 14.9 31.3 15.7C32.8 16.5 33.3 17 33.3 17.7C33.3 18.8 32 19.3 30.8 19.3C29.1 19.3 28.2 19.1 26.8 18.4L26.2 18.1L25.6 22C26.7 22.5 28.6 22.9 30.6 22.9C34.9 22.9 37.6 20.8 37.6 17.8C37.6 16.1 36.6 14.8 34.3 13.7C32.9 13 32.1 12.5 32.1 11.7C32.1 11 32.9 10.3 34.5 10.3C35.9 10.2 36.9 10.5 37.7 10.9L38.1 11.1L38.4 7.2Z" fill="#fff"/><path d="M43.2 6.8H40.2C39.3 6.8 38.6 7.1 38.2 8L32.2 25.2H36.5L37.4 22.6H42.6L43.1 25.2H47L43.2 6.8ZM38.6 19.5C39 18.5 40.5 14.3 40.5 14.3L41.7 19.5H38.6Z" fill="#fff"/><path d="M16.4 6.8L12.5 19.2L12 16.7C11.2 13.9 8.6 10.8 5.7 9.3L9.4 25.2H13.7L20.7 6.8H16.4Z" fill="#fff"/></svg>
                </div>
                <div className="w-12 h-8 rounded-md bg-[#1a1a2e] flex items-center justify-center">
                  <svg viewBox="0 0 32 20" className="w-7 h-5"><circle cx="11" cy="10" r="7" fill="#eb001b"/><circle cx="21" cy="10" r="7" fill="#f79e1b"/><path d="M16 4.6a7 7 0 010 10.8 7 7 0 000-10.8z" fill="#ff5f00"/></svg>
                </div>
              </div>
            </div>
          </div>

          {/* Security Badges - Mobile */}
          <div className="px-6 py-6 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider mb-4">Segurança verificada</p>
            <div className="flex items-center justify-center gap-5">
              <img src={nortonSecured} alt="Norton Secured" className="h-8 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={reclameAqui} alt="Reclame Aqui" className="h-6 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={googleSafe} alt="Google Safe Browsing" className="h-8 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
            </div>
          </div>

          {/* Copyright - Mobile */}
          <div className="px-6 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              © 2021-2025 VALNIX - Todos os direitos reservados
            </p>
          </div>
        </div>
      )}

      {showFullVersion && !isMobile && (
        <div className="container px-4 md:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Atendimento ao Cliente */}
          <div>
            <h3 className="text-primary font-bold text-sm uppercase mb-4 tracking-wider">
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
            <h3 className="text-primary font-bold text-sm uppercase mb-4 tracking-wider">
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
            <h3 className="text-primary font-bold text-sm uppercase mb-4 tracking-wider">
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
            <div className="flex flex-col items-center gap-3 flex-shrink-0 bg-black px-10 py-7 rounded-lg">
              <h3 className="text-foreground font-bold text-sm text-center">Métodos de pagamento</h3>
              <div className="flex items-center justify-center gap-3">
                <div className="w-14 h-10 rounded-md bg-[#00b894] flex items-center justify-center">
                  <img src={pixLogo} alt="PIX" className="h-6 w-auto object-contain brightness-0 invert" width={24} height={24} />
                </div>
                <div className="w-14 h-10 rounded-md bg-[#1a1f71] flex items-center justify-center">
                  <svg viewBox="0 0 48 32" className="w-9 h-6"><path d="M19.5 25.2L22.1 6.8H26.1L23.5 25.2H19.5Z" fill="#fff"/><path d="M38.4 7.2C37.6 6.9 36.3 6.5 34.7 6.5C30.7 6.5 27.9 8.6 27.9 11.5C27.8 13.7 29.8 14.9 31.3 15.7C32.8 16.5 33.3 17 33.3 17.7C33.3 18.8 32 19.3 30.8 19.3C29.1 19.3 28.2 19.1 26.8 18.4L26.2 18.1L25.6 22C26.7 22.5 28.6 22.9 30.6 22.9C34.9 22.9 37.6 20.8 37.6 17.8C37.6 16.1 36.6 14.8 34.3 13.7C32.9 13 32.1 12.5 32.1 11.7C32.1 11 32.9 10.3 34.5 10.3C35.9 10.2 36.9 10.5 37.7 10.9L38.1 11.1L38.4 7.2Z" fill="#fff"/><path d="M43.2 6.8H40.2C39.3 6.8 38.6 7.1 38.2 8L32.2 25.2H36.5L37.4 22.6H42.6L43.1 25.2H47L43.2 6.8ZM38.6 19.5C39 18.5 40.5 14.3 40.5 14.3L41.7 19.5H38.6Z" fill="#fff"/><path d="M16.4 6.8L12.5 19.2L12 16.7C11.2 13.9 8.6 10.8 5.7 9.3L9.4 25.2H13.7L20.7 6.8H16.4Z" fill="#fff"/></svg>
                </div>
                <div className="w-14 h-10 rounded-md bg-[#1a1a2e] flex items-center justify-center">
                  <svg viewBox="0 0 32 20" className="w-8 h-6"><circle cx="11" cy="10" r="7" fill="#eb001b"/><circle cx="21" cy="10" r="7" fill="#f79e1b"/><path d="M16 4.6a7 7 0 010 10.8 7 7 0 000-10.8z" fill="#ff5f00"/></svg>
                </div>
              </div>
            </div>
          </div>

          {/* Security Badges */}
          <div className="mb-8 pb-8 border-b border-border/30">
            <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider mb-4">Segurança verificada</p>
            <div className="flex items-center justify-center gap-8">
              <img src={nortonSecured} alt="Norton Secured" className="h-10 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={reclameAqui} alt="Reclame Aqui" className="h-8 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={googleSafe} alt="Google Safe Browsing" className="h-10 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
            </div>
          </div>

            {/* Copyright */}
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                © 2021-2025 VALNIX - Todos os direitos reservados
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
              © 2021-2025 VALNIX - Todos os direitos reservados
            </p>
          </div>
        </div>
      )}
    </footer>
  );
};