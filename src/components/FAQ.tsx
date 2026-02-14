import { memo, useMemo } from "react";
import { ShieldCheck, Zap, CreditCard, HeadphonesIcon, HelpCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
      answer: "100% seguro! A VALNIX é referência em segurança no mercado gamer brasileiro. Utilizamos criptografia SSL de 256 bits, certificação Google Safe Browsing e Norton Secured. Já são mais de 20 mil clientes satisfeitos, com avaliação média de 4.9 estrelas. Seus dados estão completamente protegidos em todas as etapas.",
    },
    {
      icon: Zap,
      question: `Como recebo o ${label}?`,
      answer: `Entrega instantânea! Após a confirmação do pagamento via PIX ou Cartão de Crédito, você receberá o código automaticamente na tela e por e-mail. Sem espera, sem complicação — é na hora.`,
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

const FAQComponent = ({ productName, productCategory }: FAQProps) => {
  const label = useMemo(() => getProductLabel(productName, productCategory), [productName, productCategory]);
  const faqs = useMemo(() => buildFaqs(label), [label]);

  return (
    <section className="container px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 md:mb-10">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground border-b-4 border-primary inline-block pb-2">
            DÚVIDAS FREQUENTES
          </h2>
          <p className="text-muted-foreground text-sm md:text-base mt-3">
            Tudo o que você precisa saber antes de comprar
          </p>
        </div>
        
        <Accordion type="single" collapsible className="space-y-3 md:space-y-4">
          {faqs.map((faq, index) => {
            const Icon = faq.icon;
            return (
              <AccordionItem 
                key={index} 
                value={`item-${index}`}
                className="border border-primary/30 md:border-2 rounded-lg px-4 md:px-6 bg-card/50 hover:border-primary transition-colors"
              >
                <AccordionTrigger className="text-left hover:no-underline py-4 md:py-6">
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 md:w-5 md:h-5 text-primary shrink-0" />
                    <span className="text-sm md:text-lg font-semibold text-primary">
                      {faq.question}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-sm md:text-base pb-4 md:pb-6 pl-7 md:pl-8">
                  {faq.answer}
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
