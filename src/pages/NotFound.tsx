import { useLocation } from "react-router-dom";
import { useEffect } from "react";
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
      <Header />
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold">404</h1>
          <p className="mb-4 text-xl text-muted-foreground">Oops! Página não encontrada</p>
          <a href="/" className="text-primary underline hover:text-primary/90">
            Voltar para Início
          </a>
        </div>
      </main>
      <CategoryCards />
      <FAQ />
      <Footer />
    </div>
  );
};

export default NotFound;
