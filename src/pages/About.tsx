import { Helmet } from "react-helmet-async";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { FloatingContactButtons } from "@/components/FloatingContactButtons";
import { CategoryCards } from "@/components/CategoryCards";
import { FAQ } from "@/components/FAQ";

export default function About() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Sobre a VALNIX | Loja de Gift Cards e Moedas Virtuais</title>
        <meta name="description" content="Conheça a VALNIX: loja especializada em gift cards e moedas virtuais para Valorant, Roblox, League of Legends e mais. Entrega automática via PIX." />
        <link rel="canonical" href="https://www.valnix.com.br/about" />
        <meta property="og:title" content="Sobre a VALNIX | Loja Gamer Segura" />
        <meta property="og:description" content="Conheça a VALNIX: loja especializada em gift cards e moedas virtuais com entrega automática." />
        <meta property="og:url" content="https://www.valnix.com.br/about" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Sobre a VALNIX | Loja Gamer Segura" />
      </Helmet>
      <Header />
      
      <main className="flex-1">
        <div className="container px-4 md:px-8 py-12 max-w-4xl">
          <h1 className="text-4xl font-bold text-foreground mb-8 border-b-4 border-primary inline-block pb-2">
            SOBRE NÓS
          </h1>

          <div className="space-y-6 text-muted-foreground">
            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">Quem Somos</h2>
              <p className="leading-relaxed">
                A VALNIX é uma loja especializada em produtos digitais para os principais jogos do mercado. 
                Oferecemos uma experiência segura e confiável para compra de moedas virtuais, contas e itens exclusivos 
                para Roblox, Fortnite, Valorant, Free Fire, League of Legends e Brawl Stars.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">Nossa Missão</h2>
              <p className="leading-relaxed">
                Proporcionar aos gamers a melhor experiência de compra, com produtos de qualidade, 
                preços competitivos e atendimento excepcional. Nossa missão é facilitar o acesso aos 
                melhores conteúdos digitais dos jogos que você ama.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">Segurança e Confiança</h2>
              <p className="leading-relaxed mb-4">
                A segurança dos nossos clientes é nossa prioridade. Por isso, contamos com:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Certificações de segurança Google Safe Browsing e Norton Secured</li>
                <li>Processo de pagamento 100% seguro</li>
                <li>Produtos verificados e autênticos</li>
                <li>Entrega rápida e automatizada</li>
                <li>Suporte ao cliente dedicado</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">Por Que Escolher a VALNIX?</h2>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Mais de 4 anos de experiência no mercado</li>
                <li>Milhares de clientes satisfeitos</li>
                <li>Preços competitivos e promoções exclusivas</li>
                <li>Entrega instantânea na maioria dos produtos</li>
                <li>Atendimento ao cliente via email e Discord</li>
                <li>Pagamento facilitado via PIX, VISA e MasterCard</li>
              </ul>
            </section>

            <section className="bg-card/50 border border-border rounded-lg p-6">
              <h2 className="text-2xl font-bold text-foreground mb-4">Entre em Contato</h2>
              <p className="leading-relaxed mb-4">
                Tem alguma dúvida ou precisa de ajuda? Nossa equipe está sempre disponível para atendê-lo:
              </p>
              <ul className="space-y-2">
                <li>
                  <strong className="text-foreground">Discord:</strong>{" "}
                  <a href="https://discord.gg/ZYdz9xYdq5" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Entre em contato através do nosso servidor
                  </a>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>

      <CategoryCards />
      <FAQ />
      <Footer />
      <FloatingContactButtons />
    </div>
  );
}
