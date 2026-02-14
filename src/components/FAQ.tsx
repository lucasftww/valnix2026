import { memo, useMemo } from "react";
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
      question: `Como comprar ${label} na VALNIX?`,
      answer: `Basta escolher o ${label} desejado, adicionar ao carrinho e pagar via PIX ou Cartão de Crédito. A entrega é automática e instantânea após a confirmação do pagamento.`,
    },
    {
      question: "É seguro comprar na VALNIX?",
      answer: "Sim! Priorizamos a segurança de nossos clientes em todas as etapas da compra. Utilizamos criptografia SSL no site, garantindo que suas informações e dados pessoais estejam protegidos durante a transação. Mais de 1250 clientes satisfeitos com avaliação média de 4.8 estrelas.",
    },
    {
      question: `Como recebo o ${label}?`,
      answer: `Após a confirmação do pagamento via PIX ou Cartão de Crédito, você receberá o código do gift card automaticamente. A entrega é instantânea — sem espera.`,
    },
    {
      question: "Quais formas de pagamento são aceitas?",
      answer: "Aceitamos PIX e Cartão de Crédito (Visa, Mastercard, Amex) com confirmação instantânea. Após o pagamento ser confirmado, a entrega do gift card é automática e imediata.",
    },
    {
      question: "E se eu precisar de ajuda?",
      answer: "Nossa equipe de suporte está disponível das 10h às 23h diariamente. Entre em contato através do nosso Discord e responderemos o mais rápido possível.",
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
        </div>
        
        <Accordion type="single" collapsible className="space-y-3 md:space-y-4">
          {faqs.map((faq, index) => (
            <AccordionItem 
              key={index} 
              value={`item-${index}`}
              className="border border-primary/30 md:border-2 rounded-lg px-4 md:px-6 bg-card/50 hover:border-primary transition-colors"
            >
              <AccordionTrigger className="text-left hover:no-underline py-4 md:py-6">
                <span className="text-sm md:text-lg font-semibold text-primary">
                  {faq.question}
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm md:text-base pb-4 md:pb-6">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
};

export const FAQ = memo(FAQComponent);
