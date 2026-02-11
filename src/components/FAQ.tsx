import { memo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "Como comprar Valorant Points (VP) na VALNIX?",
    answer: "Basta escolher o gift card de Valorant Points desejado, adicionar ao carrinho e pagar via PIX. A entrega é automática e instantânea após a confirmação do pagamento."
  },
  {
    question: "É seguro comprar gift cards na VALNIX?",
    answer: "Sim! Priorizamos a segurança de nossos clientes em todas as etapas da compra. Utilizamos criptografia SSL no site, garantindo que suas informações e dados pessoais estejam protegidos durante a transação. Mais de 1250 clientes satisfeitos com avaliação média de 4.8 estrelas."
  },
  {
    question: "Como recebo o produto (VP, Robux, RP)?",
    answer: "Após a confirmação do pagamento via PIX, você receberá o código do gift card automaticamente. A entrega é instantânea para todos os produtos digitais como Valorant Points, Robux e Riot Points."
  },
  {
    question: "Quais formas de pagamento são aceitas?",
    answer: "Aceitamos PIX com confirmação instantânea. Após o pagamento ser confirmado, a entrega do gift card é automática e imediata."
  },
  {
    question: "E se eu precisar de ajuda?",
    answer: "Nossa equipe de suporte está disponível das 10h às 23h diariamente. Entre em contato através do nosso Discord e responderemos o mais rápido possível."
  }
] as const;

const FAQComponent = () => {
  return (
    <section className="container px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-6 md:mb-8">
          Perguntas Frequentes
        </h2>
        
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
