import { Mail, MessageCircle, Shield, ArrowUp, Headphones, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import paymentMethods from "@/assets/payment-methods.png";
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
            <div className="flex flex-col items-center gap-2.5 w-full">
              <h3 className="text-foreground font-bold text-sm text-center">Métodos de pagamento</h3>
              <img src={paymentMethods} alt="PIX, Visa, Mastercard e mais" className="h-8 w-auto object-contain" />
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
            <div className="flex flex-col items-center gap-3 flex-shrink-0 bg-black px-8 py-7 rounded-lg">
              <h3 className="text-foreground font-bold text-sm text-center">Métodos de pagamento</h3>
              <img src={paymentMethods} alt="PIX, Visa, Mastercard e mais" className="h-10 w-auto object-contain" />
            </div>
          </div>

          {/* Security Badges */}
          <div className="mb-8 pb-8 border-b border-border/30">
            <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider mb-4">Segurança verificada</p>
            <div className="flex items-center justify-center gap-8">
              <img src={nortonSecured} alt="Norton Secured" className="h-14 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={reclameAqui} alt="Reclame Aqui" className="h-8 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
              <img src={googleSafe} alt="Google Safe Browsing" className="h-14 object-contain opacity-70" style={{ mixBlendMode: 'lighten' }} />
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