import { memo, useMemo } from "react";
import { ShieldCheck, Zap, CreditCard, HeadphonesIcon, HelpCircle, Lock, Star, Users, BadgeCheck, Clock } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import googleSafe from "@/assets/google-safe.png";
import nortonSecured from "@/assets/norton-secured.png";
import reclameAqui from "@/assets/reclame-aqui.png";

interface FAQProps {
  productName?: string;
  productCategory?: string;
}

function getProductLabel(productName?: string, productCategory?: string): string {
  const name = (productName || productCategory || "").toLowerCase();
  
  if (name.includes("robux") || name.includes("roblox")) return "Robux";
  if (name.includes("valorant") || name.includes("vp")) return "Valorant Points (VP)";
  if (name.includes("riot") || name.includes("rp") || name.includes("league") || name.includes("lol")) return "Riot Points (RP)";
  if (name.includes("free fire") || name.includes("freefire") || name.includes("diamante")) return "Diamantes Free Fire";
  if (name.includes("playstation") || name.includes("psn")) return "PlayStation Store";
  if (name.includes("xbox") || name.includes("game pass")) return "Xbox / Game Pass";
  if (name.includes("steam")) return "Steam";
  if (name.includes("google") || name.includes("play")) return "Google Play";
  if (name.includes("netflix")) return "Netflix";
  if (name.includes("spotify")) return "Spotify";
  
  return "gift cards";
}

function buildFaqs(label: string) {
  return [
    {
      icon: HelpCircle,
      question: `Como comprar ${label} na VALNIX?`,
      answer: `É super simples! Escolha o ${label} desejado, adicione ao carrinho e pague via PIX ou Cartão de Crédito (Visa, Mastercard, Amex). A entrega é automática e instantânea — você recebe em segundos após a confirmação do pagamento.`,
    },
    {
      icon: ShieldCheck,
      question: "É seguro comprar na VALNIX?",
      answer: null, // Handled with custom rich content
    },
    {
      icon: Zap,
      question: `Como recebo o ${label}?`,
      answer: `Entrega instantânea! Após a confirmação do pagamento via PIX ou Cartão de Crédito, você receberá o código automaticamente na tela. Sem espera, sem complicação — é na hora.`,
    },
    {
      icon: CreditCard,
      question: "Quais formas de pagamento são aceitas?",
      answer: "Aceitamos PIX (confirmação em segundos) e Cartão de Crédito (Visa, Mastercard, Amex) com processamento instantâneo. Ambos os métodos possuem entrega automática e imediata do seu gift card.",
    },
    {
      icon: HeadphonesIcon,
      question: "E se eu precisar de ajuda?",
      answer: "Nosso suporte é humanizado e rápido! Atendemos diariamente das 10h às 23h pelo nosso Discord. Tempo médio de resposta: menos de 5 minutos. Estamos sempre prontos para ajudar você.",
    },
  ];
}

const SecurityAnswer = () => (
  <div className="space-y-4">
    <p className="text-muted-foreground text-sm leading-relaxed">
      A <span className="text-foreground font-semibold">VALNIX</span> é uma das lojas mais confiáveis do mercado gamer brasileiro. 
      Levamos a segurança dos nossos clientes a sério em cada etapa da compra.
    </p>
    
    {/* Trust indicators grid */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="w-4 h-4 text-emerald-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Criptografia SSL 256-bit</p>
          <p className="text-xs text-muted-foreground mt-0.5">Seus dados são criptografados com a mesma tecnologia usada por bancos</p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <BadgeCheck className="w-4 h-4 text-blue-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Pagamento 100% Seguro</p>
          <p className="text-xs text-muted-foreground mt-0.5">Processado por gateways certificados PCI-DSS nível 1</p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <Star className="w-4 h-4 text-amber-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Avaliação 4.9 ★★★★★</p>
          <p className="text-xs text-muted-foreground mt-0.5">Mais de 20 mil clientes satisfeitos com nota máxima</p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
          <Clock className="w-4 h-4 text-purple-500" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">Entrega Instantânea</p>
          <p className="text-xs text-muted-foreground mt-0.5">Código entregue automaticamente em segundos após o pagamento</p>
        </div>
      </div>
    </div>

    {/* Certification badges */}
    <div className="flex items-center gap-4 pt-2 flex-wrap">
      <img src={googleSafe} alt="Google Safe Browsing" className="h-8 opacity-70 hover:opacity-100 transition-opacity" />
      <img src={nortonSecured} alt="Norton Secured" className="h-8 opacity-70 hover:opacity-100 transition-opacity" />
      <img src={reclameAqui} alt="Reclame Aqui" className="h-8 opacity-70 hover:opacity-100 transition-opacity" />
    </div>

    <p className="text-xs text-muted-foreground/70 leading-relaxed">
      Compre com total tranquilidade. Todos os seus dados pessoais e financeiros são protegidos em todas as etapas. 
      Se tiver qualquer dúvida, nosso suporte está disponível para ajudar.
    </p>
  </div>
);

const FAQComponent = ({ productName, productCategory }: FAQProps) => {
  const label = useMemo(() => getProductLabel(productName, productCategory), [productName, productCategory]);
  const faqs = useMemo(() => buildFaqs(label), [label]);

  return (
    <section className="container px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 md:mb-10">
          <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            Dúvidas frequentes
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Tudo o que você precisa saber antes de comprar
          </p>
        </div>
        
        <Accordion type="single" collapsible className="space-y-3 md:space-y-4">
          {faqs.map((faq, index) => {
            const Icon = faq.icon;
            const isSecurityFaq = faq.question === "É seguro comprar na VALNIX?";
            return (
              <AccordionItem 
                key={index} 
                value={`item-${index}`}
                className="border border-border/10 rounded-xl px-4 md:px-5 bg-card/30 hover:bg-card/50 transition-colors"
              >
                <AccordionTrigger className="text-left hover:no-underline py-4 md:py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm md:text-base font-medium text-foreground">
                      {faq.question}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 md:pb-5 pl-11">
                  {isSecurityFaq ? <SecurityAnswer /> : (
                    <p className="text-muted-foreground text-sm">{faq.answer}</p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </section>
  );
};

export const FAQ = memo(FAQComponent);
