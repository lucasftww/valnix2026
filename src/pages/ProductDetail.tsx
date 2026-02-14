import { useParams, useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Minus, Plus, Star, ShieldCheck, Zap, ChevronRight } from "lucide-react";
import { useState, useMemo, useEffect, lazy, Suspense, memo, useCallback } from "react";
import { useProductById, useProductReviews } from "@/hooks/firebase";
import { generateConsistentSalesAndReviews } from "@/hooks/firebase/useFirebaseProducts";
import pixLogo from "@/assets/pix-logo.png";
import DOMPurify from "dompurify";
import { trackViewContent, trackAddToCartEvent } from "@/lib/analytics";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Lazy load componentes não-críticos
const Footer = lazy(() => import("@/components/Footer").then(m => ({ default: m.Footer })));
const FloatingContactButtons = lazy(() => import("@/components/FloatingContactButtons").then(m => ({ default: m.FloatingContactButtons })));
const CategoryCards = lazy(() => import("@/components/CategoryCards").then(m => ({ default: m.CategoryCards })));
const FAQ = lazy(() => import("@/components/FAQ").then(m => ({ default: m.FAQ })));
const ReviewsCarousel = lazy(() => import("@/components/product/ReviewsCarousel"));
const RelatedProducts = lazy(() => import("@/components/product/RelatedProducts"));

// Componente de imagem otimizado inline (evita re-render)
const ProductImage = memo(({ src, alt, className, priority = false }: { 
  src: string; 
  alt: string; 
  className?: string;
  priority?: boolean;
}) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`relative ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-contain ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
});
ProductImage.displayName = 'ProductImage';

// Skeleton de loading mais leve
const ProductDetailSkeleton = memo(() => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
));
ProductDetailSkeleton.displayName = 'ProductDetailSkeleton';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { user } = useAuth();
  const [quantity, setQuantity] = useState(1);
  

  // Buscar produto com Firebase
  const { data: product, isLoading } = useProductById(id);

  // Buscar avaliações com Firebase - defer até produto carregar
  const { data: reviews = [] } = useProductReviews(product?.category);

  // Memoizar stats para evitar recálculo
  const productStats = useMemo(() => 
    id ? generateConsistentSalesAndReviews(id) : { sold: 0, reviewCount: 0 },
    [id]
  );

  // Memoizar HTML sanitizado para evitar re-sanitize a cada render
  const sanitizedDescription = useMemo(() => 
    product?.rich_description ? DOMPurify.sanitize(product.rich_description) : '',
    [product?.rich_description]
  );
  const sanitizedInstructions = useMemo(() => 
    product?.instructions ? DOMPurify.sanitize(product.instructions) : '',
    [product?.instructions]
  );
  const sanitizedTerms = useMemo(() => 
    product?.terms_conditions ? DOMPurify.sanitize(product.terms_conditions) : '',
    [product?.terms_conditions]
  );

  // Track ViewContent for analytics funnel
  useEffect(() => {
    if (product) {
      trackViewContent(user?.uid, product.name, product.category);
    }
  }, [product?.id]);


  // Memoizar handlers para evitar re-renders
  const handleAddToCart = useCallback(() => {
    if (!product) return;
    
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        image: product.image_url || '',
        type: 'product'
      });
    }
    
    // Track AddToCart for analytics funnel
    if (user) {
      trackAddToCartEvent(user.uid, Number(product.price) * quantity, product.name);
    }
  }, [user, product, quantity, addItem]);
  
  const handleBuyNow = useCallback(() => {
    handleAddToCart();
    navigate('/cart');
  }, [navigate, handleAddToCart]);

  const decreaseQuantity = useCallback(() => setQuantity(q => Math.max(1, q - 1)), []);
  const increaseQuantity = useCallback(() => setQuantity(q => q + 1), []);

  if (isLoading) {
    return <ProductDetailSkeleton />;
  }
  
  if (!product) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <Navigation />
        <main className="flex-1 container px-4 md:px-8 py-12">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-4">Produto não encontrado</h1>
            <Button onClick={() => navigate(-1)}>Voltar</Button>
          </div>
        </main>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </div>
    );
  }

  const totalPrice = (product.price * quantity).toFixed(2).replace('.', ',');

  return (
    <div className="min-h-screen min-h-[100dvh] bg-background flex flex-col pb-[88px] lg:pb-0">
      <Helmet>
        <title>{`Comprar ${product.name} Barato | VALNIX`}</title>
        <meta name="description" content={`Compre ${product.name} com entrega automática via PIX. Melhor preço: R$ ${product.price.toFixed(2).replace('.', ',')}. Entrega instantânea e segura na VALNIX.`} />
        <link rel="canonical" href={`https://www.valnix.com.br/product/${product.id}`} />
        <meta property="og:title" content={`Comprar ${product.name} | VALNIX`} />
        <meta property="og:description" content={`${product.name} por R$ ${product.price.toFixed(2).replace('.', ',')} com entrega automática via PIX.`} />
        <meta property="og:url" content={`https://www.valnix.com.br/product/${product.id}`} />
        <meta property="og:type" content="product" />
        {product.image_url && <meta property="og:image" content={product.image_url} />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`Comprar ${product.name} | VALNIX`} />
        <meta name="twitter:description" content={`${product.name} por R$ ${product.price.toFixed(2).replace('.', ',')} com entrega automática via PIX.`} />
        {product.image_url && <meta name="twitter:image" content={product.image_url} />}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": product.name,
          "description": product.description || `Gift card ${product.name} com entrega automática`,
          "image": product.image_url,
          "brand": { "@type": "Brand", "name": "VALNIX" },
          "offers": {
            "@type": "Offer",
            "price": product.price,
            "priceCurrency": "BRL",
            "availability": "https://schema.org/InStock",
            "seller": { "@type": "Organization", "name": "VALNIX" },
            "url": `https://www.valnix.com.br/product/${product.id}`
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.8",
            "reviewCount": String(productStats.reviewCount || 50)
          }
        })}</script>
      </Helmet>
      <Header />
      <Navigation />
      <main className="flex-1">
        {/* Breadcrumb */}
        <div className="container px-4 md:px-8 pt-4 pb-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground overflow-x-auto whitespace-nowrap scrollbar-hide">
            <Link to="/" className="hover:text-primary transition-colors shrink-0">
              Início
            </Link>
            <span>/</span>
            <span className="text-foreground truncate max-w-[200px] sm:max-w-none">{product.name}</span>
          </div>
        </div>

        {/* Product Content */}
        <div className="container px-4 md:px-8 pb-6 lg:pb-12">
          <div className="flex flex-col lg:grid lg:grid-cols-[1fr_420px] gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto">
            {/* === MOBILE LAYOUT === */}
            <div className="lg:hidden space-y-3">
              {/* Hero: Imagem + Nome + Preço — tudo num bloco só */}
              <div className="rounded-2xl overflow-hidden border border-border/20 bg-card">
                {/* Badge vendidos */}
                <div className="flex items-center gap-1.5 px-4 py-2.5">
                  <Zap className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-[11px] font-semibold text-foreground">+{productStats.sold.toLocaleString('pt-BR')} vendidos</span>
                </div>
                {/* Imagem */}
                <div className="flex items-center justify-center px-10 py-4 bg-gradient-to-b from-muted/20 to-background">
                  {product.image_url && (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="eager"
                      decoding="async"
                      className="w-full max-h-[300px] object-contain drop-shadow-2xl"
                    />
                  )}
                </div>

                {/* Info */}
                <div className="px-5 pb-5 pt-3 space-y-2.5">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Produto Digital</p>
                  <h1 className="text-xl font-bold leading-snug">{product.name}</h1>

                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{productStats.reviewCount.toLocaleString('pt-BR')} avaliações</span>
                  </div>

                  <div className="flex items-baseline gap-2 pt-0.5">
                    {product.old_price && product.old_price > product.price && (
                      <span className="text-sm text-muted-foreground line-through">
                        R$ {product.old_price.toFixed(2).replace('.', ',')}
                      </span>
                    )}
                    <span className="text-2xl font-extrabold text-primary">R$ {totalPrice}</span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border/10 mt-1">
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-primary" /> Entrega automática</span>
                    <span className="flex items-center gap-1"><img src={pixLogo} alt="PIX" className="w-3.5 h-3.5" loading="lazy" /> PIX</span>
                    <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-primary" /> Seguro</span>
                  </div>
                </div>
              </div>

              {/* Quantidade */}
              <div className="rounded-2xl border border-border/20 bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Quantidade</span>
                  <div className="flex items-center gap-3">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={decreaseQuantity} 
                      disabled={quantity <= 1}
                      className="h-9 w-9 rounded-lg"
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-8 text-center text-lg font-bold">{quantity}</span>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={increaseQuantity} 
                      className="h-9 w-9 rounded-lg"
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Garantias */}
              <div className="rounded-2xl border border-border/20 bg-card p-4 space-y-2.5">
                <div className="flex items-center gap-3">
                  <Zap className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Entrega Instantânea</p>
                    <p className="text-[11px] text-muted-foreground">Receba na hora após o pagamento</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Compra 100% Segura</p>
                    <p className="text-[11px] text-muted-foreground">Dados protegidos e criptografados</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <img src={pixLogo} alt="PIX" className="w-4 h-4 shrink-0" loading="lazy" />
                  <div>
                    <p className="text-sm font-medium">Pagamento via PIX</p>
                    <p className="text-[11px] text-muted-foreground">Aprovação instantânea</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 text-primary"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                  <div>
                    <p className="text-sm font-medium">Cartão de Crédito</p>
                    <p className="text-[11px] text-muted-foreground">Pagamento instantâneo</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop: Imagem + Tabs */}
            <div className="hidden lg:block space-y-6">
              <div className="relative rounded-xl overflow-hidden bg-black/80 border border-border/10">
                <div className="relative flex items-center justify-center p-12">
                  {product.image_url && (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="eager"
                      decoding="async"
                      className="max-w-full max-h-[420px] w-auto h-auto object-contain"
                    />
                  )}
                </div>
              </div>

              <div className="bg-card border border-border/30 rounded-xl overflow-hidden">
                <Tabs defaultValue="description" className="w-full">
                  <TabsList className="w-full justify-start bg-transparent border-b border-border/30 rounded-none h-auto p-0">
                    <TabsTrigger 
                      value="description" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-6 py-4 text-sm font-medium"
                    >
                      Descrição
                    </TabsTrigger>
                    {product.instructions && (
                      <TabsTrigger 
                        value="instructions" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-6 py-4 text-sm font-medium"
                      >
                        Instruções
                      </TabsTrigger>
                    )}
                    {product.terms_conditions && (
                      <TabsTrigger 
                        value="terms" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary px-6 py-4 text-sm font-medium"
                      >
                        Termos
                      </TabsTrigger>
                    )}
                  </TabsList>
                  
                  <TabsContent value="description" className="p-6 mt-0">
                    <div className="description-content text-sm text-muted-foreground leading-relaxed space-y-4">
                      {product.rich_description ? (
                        <div 
                          className="prose prose-invert prose-sm max-w-none" 
                          dangerouslySetInnerHTML={{ __html: sanitizedDescription }} 
                        />
                      ) : product.description ? (
                        <p className="whitespace-pre-line">{product.description}</p>
                      ) : (
                        <p>Sem descrição disponível.</p>
                      )}
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="instructions" className="p-6 mt-0">
                    {product.instructions ? (
                      <div 
                        className="prose prose-invert prose-sm max-w-none text-muted-foreground" 
                        dangerouslySetInnerHTML={{ __html: sanitizedInstructions }} 
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Instruções não disponíveis.</p>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="terms" className="p-6 mt-0">
                    {product.terms_conditions ? (
                      <div 
                        className="prose prose-invert prose-sm max-w-none text-muted-foreground" 
                        dangerouslySetInnerHTML={{ __html: sanitizedTerms }} 
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Termos não disponíveis.</p>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {/* Card de Compra Desktop */}
            <div className="hidden lg:block">
              <div className="sticky top-28 rounded-xl overflow-hidden border border-border/50 bg-card shadow-lg">
                <div className="p-6 space-y-5">
                  <div className="flex justify-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Produto Digital</span>
                  </div>

                  <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold leading-tight mb-2">{product.name}</h1>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <span>⚠️</span>
                      <span>Ativável apenas no Brasil</span>
                    </p>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-4 space-y-4">
                    <div className="flex flex-col items-center">
                      <p className="text-sm text-muted-foreground mb-1">Valor Total</p>
                      <p className="text-3xl font-bold text-center">R$ {totalPrice}</p>
                    </div>

                    <div className="flex flex-col items-center">
                      <p className="text-sm text-muted-foreground mb-3">Quantidade</p>
                      <div className="flex items-center justify-center gap-4">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={decreaseQuantity} 
                          disabled={quantity <= 1}
                          className="h-10 w-10 rounded-lg flex items-center justify-center"
                          aria-label="Diminuir quantidade"
                        >
                          <Minus className="h-5 w-5" />
                        </Button>
                        <div className="flex items-center justify-center">
                          <input 
                            type="number" 
                            readOnly 
                            value={quantity}
                            aria-label="Quantidade do produto"
                            className="w-16 h-10 text-center text-lg font-bold bg-background border border-border rounded-lg outline-none"
                          />
                        </div>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={increaseQuantity} 
                          className="h-10 w-10 rounded-lg flex items-center justify-center"
                          aria-label="Aumentar quantidade"
                        >
                          <Plus className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 flex flex-col items-center w-full">
                    <Button 
                      onClick={handleBuyNow} 
                      className="w-full h-14 text-base font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-lg flex items-center justify-center"
                    >
                      Comprar agora
                    </Button>
                    <Button 
                      onClick={handleAddToCart}
                      variant="outline"
                      className="w-full h-12 text-base font-medium rounded-lg flex items-center justify-center"
                    >
                      Adicionar ao carrinho
                    </Button>
                  </div>

                  <div className="flex items-center justify-center gap-2 text-sm">
                    <span className="text-green-500">✓</span>
                    <span className="text-muted-foreground">Entrega automática</span>
                  </div>

                  <p className="text-sm text-center text-muted-foreground">
                    +{productStats.sold.toLocaleString('pt-BR')} vendidos
                  </p>

                  <div className="pt-4 border-t border-border/50 flex flex-col items-center">
                    <h3 className="font-semibold text-sm mb-3">Meios de pagamento</h3>
                    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <img src={pixLogo} alt="PIX" className="w-5 h-5" loading="lazy" />
                        <span>PIX - À vista</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                        <span>Cartão de crédito</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Descrição Mobile */}
            <div className="lg:hidden bg-card border border-border/20 rounded-2xl p-5">
              <h2 className="text-xl font-bold mb-4">Sobre o Produto</h2>
              <div className="description-content text-sm text-muted-foreground leading-relaxed">
                {product.rich_description ? (
                  <div 
                    className="prose prose-invert prose-sm max-w-none" 
                    dangerouslySetInnerHTML={{ __html: sanitizedDescription }} 
                  />
                ) : product.description ? (
                  <p className="whitespace-pre-line">{product.description}</p>
                ) : (
                  <p>Sem descrição disponível.</p>
                )}
              </div>
            </div>
          </div>

          {/* Reviews - Lazy loaded */}
          {reviews.length > 0 && (
            <Suspense fallback={<div className="h-48 mt-6 animate-pulse bg-muted/20 rounded-2xl" />}>
              <ReviewsCarousel reviews={reviews} />
            </Suspense>
          )}

          {/* Produtos Relacionados */}
          <Suspense fallback={<div className="h-48 mt-6 animate-pulse bg-muted/20 rounded-2xl" />}>
            <RelatedProducts category={product.category} currentProductId={product.id} />
          </Suspense>
        </div>
      </main>

      {/* Sticky CTA Mobile — redesenhado */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40 bg-background/95 backdrop-blur-md border-t border-border/30" style={{ transform: 'translateZ(0)' }}>
        <div className="px-4 py-3 safe-area-inset-bottom flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-[11px] text-muted-foreground block">Total</span>
            <span className="text-2xl font-extrabold text-primary whitespace-nowrap">R$&nbsp;{totalPrice}</span>
          </div>
          <Button 
            onClick={handleBuyNow} 
            className="shrink-0 h-14 px-8 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl active:scale-[0.98] transition-transform"
          >
            Comprar Agora
          </Button>
        </div>
      </div>

      <Suspense fallback={<div className="h-20" />}>
        <CategoryCards />
      </Suspense>
      <Suspense fallback={<div className="h-20" />}>
        <FAQ productName={product.name} productCategory={product.category} />
      </Suspense>
      <Suspense fallback={null}>
        <Footer />
      </Suspense>
      <Suspense fallback={null}>
        <FloatingContactButtons />
      </Suspense>
    </div>
  );
};

export default memo(ProductDetail);
