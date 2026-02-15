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
import PageTransition from "@/components/PageTransition";

// Componente interno para usar hooks dentro do BrowserRouter
const AppContent = () => {
  useBackRedirect("/");
  return null;
};

// Carregamento prioritário das páginas principais
import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";

// Lazy load de rotas secundárias
const Valorant = lazy(() => import("./pages/Valorant"));
const Cart = lazy(() => import("./pages/Cart"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));
const Checkout = lazy(() => import("./pages/Checkout"));
const MyOrders = lazy(() => import("./pages/MyOrders"));
const About = lazy(() => import("./pages/About"));
const Terms = lazy(() => import("./pages/Terms"));
const Category = lazy(() => import("./pages/Category"));
const Seized = lazy(() => import("./pages/Seized"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PainelPagar = lazy(() => import("./pages/PainelPagar"));
const PainelPagarEntrega = lazy(() => import("./pages/PainelPagarEntrega"));
const PainelPagarTrocaDados = lazy(() => import("./pages/PainelPagarTrocaDados"));
const OrderDelivery = lazy(() => import("./pages/OrderDelivery"));
const CardPaymentCallback = lazy(() => import("./pages/CardPaymentCallback"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000, // 30 min - cache agressivo
      gcTime: 60 * 60 * 1000,    // 1 hora - mantém em memória
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
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
                    <PageTransition>
                      <Routes>
                        <Route path="/" element={<Index />} />
                        <Route path="/auth/*" element={<Auth />} />
                        <Route path="/cart" element={<Cart />} />
                        <Route path="/checkout" element={<Checkout />} />
                        <Route path="/my-orders" element={<MyOrders />} />
                        <Route path="/profile" element={<Profile />} />
                        <Route path="/admin/*" element={<Admin />} />

                        <Route path="/about" element={<About />} />
                        <Route path="/terms" element={<Terms />} />
                        <Route path="/seized" element={<Seized />} />
                        <Route path="/valorant" element={<Valorant />} />
                        <Route path="/painel-pagar" element={<PainelPagar />} />
                        <Route path="/painel-pagar-entrega" element={<PainelPagarEntrega />} />
                        <Route path="/painel-pagar-trocadados" element={<PainelPagarTrocaDados />} />

                        <Route path="/card-callback" element={<CardPaymentCallback />} />
                        <Route path="/order/:hash" element={<OrderDelivery />} />
                        <Route path="/product/:id" element={<ProductDetail />} />
                        {/* Categorias usam o slug direto na raiz (ex: /valorant) */}
                        <Route path="/:categorySlug" element={<Category />} />

                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </PageTransition>
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
