import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { CategoryCards } from "@/components/CategoryCards";
import { FAQ } from "@/components/FAQ";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Helmet>
        <title>Página não encontrada — VALNIX</title>
        <meta name="robots" content="noindex,follow" />
      </Helmet>
      <Header />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="max-w-md text-center space-y-4">
          <p className="text-sm uppercase tracking-widest text-primary">404</p>
          <h1 className="text-3xl md:text-4xl font-bold">Página não encontrada</h1>
          <p className="text-muted-foreground">
            A página que você procurou não existe ou foi removida. Veja nossas categorias logo abaixo.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              Voltar para o início
            </a>
            <a
              href="/valorant"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Ver categorias
            </a>
          </div>
        </div>
      </main>
      <CategoryCards />
      <FAQ />
      <Footer />
    </div>
  );
};

export default NotFound;
