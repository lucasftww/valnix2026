import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { AuthProvider } from "@/contexts/FirebaseAuthContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { useBackRedirect } from "@/hooks/useBackRedirect";

import { HelmetProvider } from "react-helmet-async";
import { lazy, Suspense } from "react";

// Componente interno para usar hooks dentro do BrowserRouter
const AppContent = () => {
  useBackRedirect("/");
  return null;
};

// Carregamento prioritário da homepage
import Index from "./pages/Index";

// Lazy load de todas as rotas secundárias (incluindo ProductDetail)
const ProductDetail = lazy(() => import("./pages/ProductDetail"));

const Cart = lazy(() => import("./pages/Cart"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));
const checkoutImport = () => import("./pages/Checkout");
const Checkout = lazy(checkoutImport);
// Export for prefetch when user adds to cart
export const prefetchCheckout = () => { checkoutImport(); };
const MyOrders = lazy(() => import("./pages/MyOrders"));
const About = lazy(() => import("./pages/About"));
const Terms = lazy(() => import("./pages/Terms"));
const Category = lazy(() => import("./pages/Category"));

const NotFound = lazy(() => import("./pages/NotFound"));
const PainelPagar = lazy(() => import("./pages/PainelPagar"));
const PainelPagarEntrega = lazy(() => import("./pages/PainelPagarEntrega"));
const PainelPagarTrocaDados = lazy(() => import("./pages/PainelPagarTrocaDados"));
const OrderDelivery = lazy(() => import("./pages/OrderDelivery"));
const CardPaymentCallback = lazy(() => import("./pages/CardPaymentCallback"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 3,
    },
  },
});

// Exportar para prefetch global
export { queryClient };

const App = () => {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <CartProvider>
              <Toaster />
                <BrowserRouter>
                  <AppContent />
                  <ScrollToTop />
                  
                  <Suspense fallback={
                    <div className="min-h-screen bg-background flex items-center justify-center">
                      <div className="relative">
                        <div className="w-10 h-10 border-3 border-primary/20 rounded-full" />
                        <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
                      </div>
                    </div>
                  }>
                    <Routes>
                        <Route path="/" element={<Index />} />
                        <Route path="/auth/*" element={<Auth />} />
                        <Route path="/cart" element={<Cart />} />
                        <Route path="/checkout" element={<Checkout />} />
                        <Route path="/my-orders" element={<MyOrders />} />
                        <Route path="/admin/*" element={<Admin />} />

                        <Route path="/about" element={<About />} />
                        <Route path="/terms" element={<Terms />} />
                        
                        
                        <Route path="/painel-pagar" element={<PainelPagar />} />
                        <Route path="/entrega-prioritaria" element={<PainelPagarEntrega />} />
                        <Route path="/protecao-total" element={<PainelPagarTrocaDados />} />
                        {/* Legacy redirects */}
                        <Route path="/painel-pagar-entrega" element={<PainelPagarEntrega />} />
                        <Route path="/painel-pagar-trocadados" element={<PainelPagarTrocaDados />} />

                        <Route path="/card-callback" element={<CardPaymentCallback />} />
                        <Route path="/order/:hash" element={<OrderDelivery />} />
                        <Route path="/product/:id" element={<ProductDetail />} />
                        {/* Categorias usam o slug direto na raiz (ex: /valorant) */}
                        <Route path="/:categorySlug" element={<Category />} />

                        <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </BrowserRouter>
            </CartProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
};

export default App;
