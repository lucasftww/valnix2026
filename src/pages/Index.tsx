import { lazy, Suspense, memo } from "react";

import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { SearchBar } from "@/components/SearchBar";

import { ProductGrid } from "@/components/ProductGrid";
import { useCategoryPrefetch } from "@/hooks/useCategoryPrefetch";


// Lazy load componentes não críticos
const CategoryCards = lazy(() => import("@/components/CategoryCards").then(m => ({ default: m.CategoryCards })));
const FAQ = lazy(() => import("@/components/FAQ").then(m => ({ default: m.FAQ })));
const Footer = lazy(() => import("@/components/Footer").then(m => ({ default: m.Footer })));
const FloatingContactButtons = lazy(() => import("@/components/FloatingContactButtons").then(m => ({ default: m.FloatingContactButtons })));

const IndexComponent = () => {
  // Prefetch categorias principais em background
  useCategoryPrefetch();
  
  
  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      <Helmet>
        <title>Comprar Valorant Points VP, Robux e RP | VALNIX</title>
        <meta name="description" content="Compre Valorant Points (VP), Robux e Riot Points (RP) com entrega automática e pagamento via PIX. Loja gamer segura com os melhores preços do Brasil." />
        <link rel="canonical" href="https://www.valnix.com.br/" />
        <meta property="og:title" content="VALNIX — Loja Gamer | VP, Robux e RP" />
        <meta property="og:description" content="Compre gift cards gamer com entrega automática via PIX. Valorant Points, Robux, Riot Points e mais com os melhores preços do Brasil." />
        <meta property="og:image" content="https://www.valnix.com.br/images/og-home.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content="https://www.valnix.com.br/" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="VALNIX" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="VALNIX — Loja Gamer | VP, Robux e RP" />
        <meta name="twitter:description" content="Gift cards gamer com entrega automática via PIX. Melhores preços do Brasil." />
        <meta name="twitter:image" content="https://www.valnix.com.br/images/og-home.jpg" />
      </Helmet>
      <Header />
      <Navigation />
      <main className="flex-1">
        {/* Search Bar Mobile */}
        <div className="md:hidden px-4 py-3 bg-background">
          <SearchBar />
        </div>
        
        <ProductGrid />
        <div className="content-lazy">
          <Suspense fallback={<div className="h-20" />}>
            <CategoryCards />
          </Suspense>
        </div>
        <div className="content-lazy">
          <Suspense fallback={<div className="h-20" />}>
            <FAQ />
          </Suspense>
        </div>
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
