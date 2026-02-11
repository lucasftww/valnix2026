import { useParams, useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Minus, Plus, Star } from "lucide-react";
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
    if (!user) {
      navigate('/auth?redirect=' + encodeURIComponent(`/product/${id}`));
      return;
    }
    
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
    trackAddToCartEvent(user.uid, Number(product.price) * quantity, product.name);
  }, [user, product, quantity, navigate, id, addItem]);
  
  const handleBuyNow = useCallback(() => {
    if (!user) {
      navigate('/auth?redirect=/cart');
      return;
    }
    
    handleAddToCart();
    navigate('/cart');
  }, [user, navigate, handleAddToCart]);

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
            {/* Imagem Mobile */}
            <div className="rounded-xl overflow-hidden bg-black/90 border border-border/10 lg:hidden">
              <div className="relative flex items-center justify-center p-4 min-h-[280px] sm:min-h-[350px]">
                {product.image_url && (
                  <ProductImage
                    src={product.image_url}
                    alt={product.name}
                    className="max-w-[75%] sm:max-w-[65%] max-h-[260px] sm:max-h-[330px] w-auto h-auto"
                    priority={true}
                  />
                )}
              </div>
              <div className="flex items-center justify-center gap-4 px-4 py-3 bg-black border-t border-white/10">
                <div className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400 shrink-0" />
                  <span className="text-xs text-white/70 whitespace-nowrap">{productStats.reviewCount.toLocaleString('pt-BR')} avaliações</span>
                </div>
                <div className="w-px h-3.5 bg-white/20" />
                <span className="text-xs font-bold text-primary whitespace-nowrap">
                  +{productStats.sold.toLocaleString('pt-BR')} vendidos
                </span>
              </div>
            </div>

            {/* Card de Compra Mobile */}
            <div className="lg:hidden">
              <div className="rounded-xl overflow-hidden border border-primary/20 bg-card shadow-xl">
                <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
                  <div className="text-center">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Produto Digital</span>
                    <h1 className="text-2xl sm:text-3xl font-bold leading-tight mt-1 mb-1">{product.name}</h1>
                    <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center justify-center gap-1">
                      <span>🇧🇷</span>
                      <span>Ativável apenas no Brasil</span>
                    </p>
                  </div>

                  <div className="bg-primary/10 rounded-xl p-4 text-center border border-primary/20">
                    <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
                    <p className="text-3xl sm:text-4xl font-extrabold text-primary">
                      R$ {totalPrice}
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-4">
                    <span className="text-sm text-muted-foreground">Qtd:</span>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={decreaseQuantity} 
                        disabled={quantity <= 1}
                        className="h-10 w-10 rounded-lg"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-12 text-center text-lg font-bold">{quantity}</span>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={increaseQuantity} 
                        className="h-10 w-10 rounded-lg"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="text-green-500">✓</span> Entrega automática
                    </span>
                    <span className="flex items-center gap-1">
                      <img src={pixLogo} alt="PIX" className="w-4 h-4" loading="lazy" /> PIX
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop: Imagem + Tabs */}
            <div className="hidden lg:block space-y-6">
              <div className="relative rounded-xl overflow-hidden bg-black/80 border border-border/10">
                <div className="relative flex items-center justify-center p-12 min-h-[650px]">
                  {product.image_url && (
                    <ProductImage
                      src={product.image_url}
                      alt={product.name}
                      className="max-w-[60%] max-h-[630px] w-auto h-auto"
                      priority={true}
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
              <div className="sticky top-32 rounded-xl overflow-hidden border border-border/50 bg-card shadow-lg">
                <div className="p-8 space-y-8">
                  <div className="flex justify-center">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Produto Digital</span>
                  </div>

                  <div className="flex flex-col items-center text-center">
                    <h1 className="text-4xl font-bold leading-tight mb-3">{product.name}</h1>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <span>⚠️</span>
                      <span>Ativável apenas no Brasil</span>
                    </p>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-6 space-y-6">
                    <div className="flex flex-col items-center">
                      <p className="text-sm text-muted-foreground mb-2">Valor Total</p>
                      <p className="text-4xl font-bold text-center">R$ {totalPrice}</p>
                    </div>

                    <div className="flex flex-col items-center">
                      <p className="text-sm text-muted-foreground mb-3">Quantidade</p>
                      <div className="flex items-center justify-center gap-4">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={decreaseQuantity} 
                          disabled={quantity <= 1}
                          className="h-12 w-12 rounded-lg flex items-center justify-center"
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
                            className="w-20 h-12 text-center text-xl font-bold bg-background border border-border rounded-lg outline-none"
                          />
                        </div>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={increaseQuantity} 
                          className="h-12 w-12 rounded-lg flex items-center justify-center"
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
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <img src={pixLogo} alt="PIX" className="w-6 h-6" loading="lazy" />
                      <span>PIX - À vista</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Descrição Mobile */}
            <div className="lg:hidden bg-card border border-border/30 rounded-xl p-6">
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
        </div>
      </main>

      {/* Sticky CTA Mobile */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40 bg-black border-t border-primary/30" style={{ transform: 'translateZ(0)' }}>
        <div className="px-4 py-3 safe-area-inset-bottom">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs text-muted-foreground">Total:</span>
              <span className="text-xl font-extrabold text-primary ml-2">R$ {totalPrice}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-green-500">
              <span>✓</span>
              <span>Entrega imediata</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={handleAddToCart}
              variant="outline"
              className="flex-shrink-0 h-14 w-14 rounded-xl border-2 border-primary/50 bg-primary/10 hover:bg-primary/20"
              aria-label="Adicionar ao carrinho"
            >
              <Plus className="h-6 w-6 text-primary" />
            </Button>
            <Button 
              onClick={handleBuyNow} 
              className="flex-1 h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl active:scale-[0.98] transition-transform"
            >
              Comprar Agora
            </Button>
          </div>
        </div>
      </div>

      <Suspense fallback={<div className="h-20" />}>
        <CategoryCards />
      </Suspense>
      <Suspense fallback={<div className="h-20" />}>
        <FAQ />
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
