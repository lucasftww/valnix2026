import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { AuthProvider } from "@/contexts/FirebaseAuthContext";
import { ScrollToTop } from "@/components/ScrollToTop";
import { SecurityHeaders } from "@/components/SecurityHeaders";
import { CrispChat } from "@/components/CrispChat";

import { HelmetProvider } from "react-helmet-async";
import { lazy, Suspense } from "react";

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
const SeedDatabase = lazy(() => import("./pages/SeedDatabase"));
const MigrateDatabase = lazy(() => import("./pages/MigrateDatabase"));
const PainelPagar = lazy(() => import("./pages/PainelPagar"));
const PainelPagarEntrega = lazy(() => import("./pages/PainelPagarEntrega"));
const PainelPagarTrocaDados = lazy(() => import("./pages/PainelPagarTrocaDados"));
// SetAdmin page removed for security - admin roles should only be granted via Firebase Admin SDK

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
          <SecurityHeaders />
          <CrispChat />
          <AuthProvider>
            <CartProvider>
              <Toaster />
                <BrowserRouter>
                  <ScrollToTop />
                  
                  <Suspense fallback={
                    <div className="min-h-screen bg-background" />
                  }>
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
                      <Route path="/seed-database" element={<SeedDatabase />} />
                      <Route path="/migrate-database" element={<MigrateDatabase />} />
                      <Route path="/painel-pagar" element={<PainelPagar />} />
                      <Route path="/painel-pagar-entrega" element={<PainelPagarEntrega />} />
                      <Route path="/painel-pagar-trocadados" element={<PainelPagarTrocaDados />} />
                      {/* SetAdmin route removed for security - privilege escalation vulnerability */}

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
