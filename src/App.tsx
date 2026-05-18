// TooltipProvider moved to admin/sidebar only — not needed on homepage
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { ScrollToTop } from "@/components/ScrollToTop";

import { HelmetProvider } from "react-helmet-async";
import { lazy, Suspense, useEffect } from "react";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";

// Lazy-load non-critical UI (Toaster only needed on user actions)
const Toaster = lazy(() => import("@/components/ui/toaster").then(m => ({ default: m.Toaster })));

// Cart abandonment nudge — global so it works on any storefront route.
// 3s delay + 6h cooldown, lazy so not on critical path.
const CartAbandonmentNudge = lazy(() => import("@/components/CartAbandonmentNudge").then(m => ({ default: m.CartAbandonmentNudge })));

// Redirect to external URL
const ExternalRedirect = ({ url }: { url: string }) => {
  useEffect(() => { window.location.href = url; }, [url]);
  return null;
};

// Carregamento prioritário da homepage
import Index from "./pages/Index";

// Lazy load de todas as rotas secundárias (incluindo ProductDetail)
const ProductDetail = lazy(() => import("./pages/ProductDetail"));

const Cart = lazy(() => import("./pages/Cart"));
const Admin = lazy(() => import("./pages/Admin"));
const Checkout = lazy(() => import("./pages/Checkout"));
// `prefetchCheckout` now lives in src/lib/prefetchRoutes.ts so that
// CartContext / CartSidebar don't have to dynamic-import the entire App.tsx
// module just to warm up the Checkout chunk (broke code-splitting).
const About = lazy(() => import("./pages/About"));
const Terms = lazy(() => import("./pages/Terms"));
const Category = lazy(() => import("./pages/Category"));

const NotFound = lazy(() => import("./pages/NotFound"));
const PainelPagar = lazy(() => import("./pages/PainelPagar"));
const PainelPagarEntrega = lazy(() => import("./pages/PainelPagarEntrega"));
const PainelPagarTrocaDados = lazy(() => import("./pages/PainelPagarTrocaDados"));
const OrderDelivery = lazy(() => import("./pages/OrderDelivery"));


export { queryClient } from "@/lib/queryClient";

const App = () => {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <>
            <CartProvider>
              <Suspense fallback={null}>
                <Toaster />
              </Suspense>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                  <ScrollToTop />
                  
                  <Suspense fallback={
                    <div className="min-h-screen bg-background flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  }>
                    <GlobalErrorBoundary>
                      <Routes>
                          <Route path="/" element={<Index />} />
                          <Route path="/cart" element={<Cart />} />
                          <Route path="/checkout" element={<Checkout />} />
                          <Route path="/admin" element={<ExternalRedirect url="https://www.youtube.com/watch?v=xjIYi6fnGh0" />} />
                          <Route path="/charles/*" element={<Admin />} />

                          <Route path="/about" element={<About />} />
                          <Route path="/terms" element={<Terms />} />
                          
                          
                          <Route path="/painel-pagar" element={<PainelPagar />} />
                          <Route path="/entrega-prioritaria" element={<PainelPagarEntrega />} />
                          <Route path="/protecao-total" element={<PainelPagarTrocaDados />} />
                          {/* Legacy redirects */}
                          <Route path="/painel-pagar-entrega" element={<PainelPagarEntrega />} />
                          <Route path="/painel-pagar-trocadados" element={<PainelPagarTrocaDados />} />


                          <Route path="/order" element={<OrderDelivery />} />
                          <Route path="/order/:hash" element={<OrderDelivery />} />
                          <Route path="/product/:id" element={<ProductDetail />} />
                          {/* Categorias usam o slug direto na raiz (ex: /valorant) */}
                          <Route path="/:categorySlug" element={<Category />} />

                          <Route path="*" element={<NotFound />} />
                      </Routes>
                    </GlobalErrorBoundary>
                  </Suspense>
                  <Suspense fallback={null}>
                    <CartAbandonmentNudge />
                  </Suspense>
                </BrowserRouter>
            </CartProvider>
        </>
      </QueryClientProvider>
    </HelmetProvider>
  );
};

export default App;
