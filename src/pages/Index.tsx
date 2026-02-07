import { lazy, Suspense, memo, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { SearchBar } from "@/components/SearchBar";
import { HeroBanner } from "@/components/HeroBanner";
import { ProductGrid } from "@/components/ProductGrid";
import { useCategoryPrefetch } from "@/hooks/useCategoryPrefetch";
import { trackPageView } from "@/lib/analytics";
import { useAuth } from "@/contexts/FirebaseAuthContext";

// Lazy load componentes não críticos
const CategoryCards = lazy(() => import("@/components/CategoryCards").then(m => ({ default: m.CategoryCards })));
const FAQ = lazy(() => import("@/components/FAQ").then(m => ({ default: m.FAQ })));
const Footer = lazy(() => import("@/components/Footer").then(m => ({ default: m.Footer })));
const FloatingContactButtons = lazy(() => import("@/components/FloatingContactButtons").then(m => ({ default: m.FloatingContactButtons })));

const IndexComponent = () => {
  const { user } = useAuth();
  // Prefetch categorias principais em background
  useCategoryPrefetch();
  
  // Track PageView for analytics funnel
  useEffect(() => {
    trackPageView(user?.uid);
  }, []);
  
  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      <Helmet>
        <title>Comprar Valorant Points VP, Robux e RP | VALNIX</title>
        <meta name="description" content="Compre Valorant Points (VP), Robux e Riot Points (RP) com entrega automática e pagamento via PIX. Loja gamer segura com os melhores preços do Brasil." />
        <link rel="canonical" href="https://valnixbr.com/" />
      </Helmet>
      <Header />
      <Navigation />
      <main className="flex-1">
        {/* Search Bar Mobile */}
        <div className="md:hidden px-4 py-4 bg-background border-b border-border/30">
          <SearchBar />
        </div>
        <HeroBanner />
        <ProductGrid />
        <Suspense fallback={<div className="h-20" />}>
          <CategoryCards />
        </Suspense>
        <Suspense fallback={<div className="h-20" />}>
          <FAQ />
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <Footer showFullVersion={true} />
      </Suspense>
      <Suspense fallback={null}>
        <FloatingContactButtons />
      </Suspense>
    </div>
  );
};

export default memo(IndexComponent);
