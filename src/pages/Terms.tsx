import { Helmet } from "react-helmet-async";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { FloatingContactButtons } from "@/components/FloatingContactButtons";
import { CategoryCards } from "@/components/CategoryCards";
import { FAQ } from "@/components/FAQ";

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>Termos e Condições | VALNIX</title>
        <meta name="description" content="Leia os termos e condições de uso da VALNIX. Informações sobre compras, entregas, reembolsos e responsabilidades." />
        <link rel="canonical" href="https://www.valnix.com.br/terms" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <Header />
      
      <main className="flex-1">
        <div className="container px-4 md:px-8 py-12 max-w-4xl">
          <h1 className="text-4xl font-bold text-foreground mb-8 border-b-4 border-primary inline-block pb-2">
            TERMOS E CONDIÇÕES
          </h1>

          <div className="space-y-6 text-muted-foreground">
            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">1. Aceitação dos Termos</h2>
              <p className="leading-relaxed">
                Ao acessar e utilizar o site da VALNIX, você concorda com os termos e condições aqui estabelecidos. 
                Se você não concordar com qualquer parte destes termos, não deverá utilizar nosso site ou serviços.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">2. Produtos e Serviços</h2>
              <p className="leading-relaxed mb-4">
                A VALNIX oferece produtos digitais para diversos jogos, incluindo:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Moedas virtuais (Robux, V-Bucks, VP, RP, Diamantes, etc.)</li>
                <li>Contas de jogos verificadas</li>
                <li>Bundles e pacotes exclusivos</li>
              </ul>
              <p className="leading-relaxed mt-4">
                Todos os produtos são entregues digitalmente e não podem ser revertidos após a entrega.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">3. Preços e Pagamento</h2>
              <p className="leading-relaxed mb-4">
                Os preços exibidos em nosso site são válidos no momento da compra e podem sofrer alterações sem aviso prévio. 
                Aceitamos as seguintes formas de pagamento:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>PIX (pagamento instantâneo)</li>
                <li>Cartões de crédito VISA e MasterCard</li>
              </ul>
              <p className="leading-relaxed mt-4">
                Todas as transações são processadas com segurança através de sistemas certificados.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">4. Entrega dos Produtos</h2>
              <p className="leading-relaxed">
                A maioria dos produtos é entregue automaticamente e de forma instantânea após a confirmação do pagamento. 
                Em casos específicos, a entrega pode levar até 24 horas. Você receberá as informações do produto através 
                do email cadastrado na compra.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">5. Política de Reembolso</h2>
              <p className="leading-relaxed mb-4">
                Devido à natureza digital dos produtos, não oferecemos reembolsos após a entrega do produto. 
                Exceções podem ser feitas nos seguintes casos:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Produto não entregue após 24 horas</li>
                <li>Produto entregue com defeito ou não funcional</li>
                <li>Cobrança duplicada</li>
              </ul>
              <p className="leading-relaxed mt-4">
                Para solicitar análise de reembolso, entre em contato através do email valnixbr@gmail.com com 
                os detalhes da sua compra.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">6. Responsabilidades do Usuário</h2>
              <p className="leading-relaxed mb-4">
                Ao utilizar nossos serviços, você concorda em:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Fornecer informações verdadeiras e atualizadas</li>
                <li>Manter a confidencialidade de suas credenciais de acesso</li>
                <li>Não compartilhar ou revender produtos adquiridos</li>
                <li>Utilizar os produtos de acordo com os termos de serviço dos respectivos jogos</li>
                <li>Não realizar chargebacks indevidos</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-foreground mb-4">7. Alterações nos Termos</h2>
              <p className="leading-relaxed">
                A VALNIX reserva-se o direito de modificar estes termos e condições a qualquer momento. 
                As alterações entrarão em vigor imediatamente após sua publicação no site. 
                Recomendamos que você revise periodicamente estes termos.
              </p>
            </section>

            <section className="bg-card/50 border border-border rounded-lg p-6">
              <h2 className="text-2xl font-bold text-foreground mb-4">8. Contato</h2>
              <p className="leading-relaxed mb-4">
                Para dúvidas, reclamações ou sugestões relacionadas a estes termos e condições, 
                entre em contato conosco:
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

            <p className="text-sm italic mt-8">
              Última atualização: Janeiro de 2025
            </p>
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
