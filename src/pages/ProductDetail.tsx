import { useParams, useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Header } from "@/components/Header";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Minus, Plus, Star, ChevronDown } from "lucide-react";
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

// Skeleton de loading mais leve
const ProductDetailSkeleton = memo(() => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-10 h-10 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
  </div>
));
ProductDetailSkeleton.displayName = 'ProductDetailSkeleton';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { user } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const [mobileSection, setMobileSection] = useState<string | null>(null);
  

  // Buscar produto com Firebase
  const { data: product, isLoading } = useProductById(id);

  // Buscar avaliações com Firebase - defer até produto carregar
  const { data: reviews = [] } = useProductReviews(product?.category);

  // Memoizar stats para evitar recálculo
  const productStats = useMemo(() => 
    id ? generateConsistentSalesAndReviews(id) : { sold: 0, reviewCount: 0 },
    [id]
  );

  // Remove "bonox" (case-insensitive) de qualquer texto
  const stripBonox = (html: string) => html.replace(/bonoxs?\b/gi, 'VALNIX');

  // Memoizar HTML sanitizado para evitar re-sanitize a cada render
  const sanitizedDescription = useMemo(() => 
    product?.rich_description ? stripBonox(DOMPurify.sanitize(product.rich_description)) : '',
    [product?.rich_description]
  );
  const sanitizedInstructions = useMemo(() => 
    product?.instructions ? stripBonox(DOMPurify.sanitize(product.instructions)) : '',
    [product?.instructions]
  );
  const sanitizedTerms = useMemo(() => 
    product?.terms_conditions ? stripBonox(DOMPurify.sanitize(product.terms_conditions)) : '',
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
        delivery_type: product.delivery_type || 'manual',
        type: 'product'
      });
    }
    
    // Track AddToCart for analytics funnel (logged-in and guests)
    trackAddToCartEvent(user?.uid || null, Number(product.price) * quantity, product.name);
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
        <meta property="og:site_name" content="VALNIX" />
        {product.image_url && <meta property="og:image" content={product.image_url} />}
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
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
        {/* Breadcrumb - desktop only */}
        <div className="container px-4 md:px-8 pt-6 pb-2 hidden lg:block">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors shrink-0">
              Início
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground font-medium truncate">{product.name}</span>
          </div>
        </div>

        {/* Product Content */}
        <div className="container px-4 md:px-8 pb-6 lg:pb-12">
          <div className="flex flex-col lg:grid lg:grid-cols-[1fr_400px] gap-4 sm:gap-6 lg:gap-10 max-w-7xl mx-auto">
            {/* === MOBILE LAYOUT === */}
            <div className="lg:hidden space-y-3">
              {/* Hero: Imagem + Nome + Preço */}
              <div className="space-y-4">
                {/* Imagem */}
                <div className="rounded-2xl overflow-hidden bg-muted/30">
                  <div className="flex items-center justify-center px-6 py-6">
                    {product.image_url && (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        loading="eager"
                        decoding="async"
                        className="w-full max-h-[360px] object-contain"
                      />
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="space-y-3 px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-medium">+{productStats.sold.toLocaleString('pt-BR')} vendidos</span>
                  </div>

                  <h1 className="text-xl font-bold leading-snug tracking-tight">{product.name}</h1>

                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{productStats.reviewCount.toLocaleString('pt-BR')} avaliações</span>
                  </div>

                  <div className="flex items-baseline gap-2.5 pt-1">
                    {product.old_price && product.old_price > product.price && (
                      <span className="text-sm text-muted-foreground line-through">
                        R$ {product.old_price.toFixed(2).replace('.', ',')}
                      </span>
                    )}
                    <span className="text-2xl font-extrabold tracking-tight">R$&nbsp;{totalPrice}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop: Imagem + Tabs */}
            <div className="hidden lg:block space-y-8">
              {/* Imagem */}
              <div className="rounded-2xl overflow-hidden bg-muted/20">
                <div className="flex items-center justify-center p-8">
                  {product.image_url && (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="eager"
                      decoding="async"
                      className="max-w-full max-h-[520px] w-auto h-auto object-contain"
                    />
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="rounded-2xl overflow-hidden">
                <Tabs defaultValue="description" className="w-full">
                  <TabsList className="w-full justify-start bg-transparent border-b border-border/10 rounded-none h-auto p-0 gap-0">
                    <TabsTrigger 
                      value="description" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground px-6 py-3.5 text-sm font-medium text-muted-foreground"
                    >
                      Descrição
                    </TabsTrigger>
                    {product.instructions && (
                      <TabsTrigger 
                        value="instructions" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground px-6 py-3.5 text-sm font-medium text-muted-foreground"
                      >
                        Instruções
                      </TabsTrigger>
                    )}
                    {product.terms_conditions && (
                      <TabsTrigger 
                        value="terms" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground px-6 py-3.5 text-sm font-medium text-muted-foreground"
                      >
                        Termos
                      </TabsTrigger>
                    )}
                  </TabsList>
                  
                  <TabsContent value="description" className="pt-6 mt-0">
                    <div className="text-sm text-muted-foreground leading-relaxed space-y-4">
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
                  
                  <TabsContent value="instructions" className="pt-6 mt-0">
                    {product.instructions ? (
                      <div 
                        className="prose prose-invert prose-sm max-w-none text-muted-foreground" 
                        dangerouslySetInnerHTML={{ __html: sanitizedInstructions }} 
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Instruções não disponíveis.</p>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="terms" className="pt-6 mt-0">
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
              <div className="sticky top-28 space-y-6">
                {/* Main card */}
                <div className="rounded-2xl border border-border/10 bg-card p-6 space-y-6">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mb-3">Produto Digital</p>
                    <h1 className="text-2xl font-bold leading-tight tracking-tight">{product.name}</h1>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">{productStats.reviewCount.toLocaleString('pt-BR')} avaliações</span>
                    <span className="text-xs text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground">+{productStats.sold.toLocaleString('pt-BR')} vendidos</span>
                  </div>

                  {/* Preço */}
                  <div className="space-y-1">
                    {product.old_price && product.old_price > product.price && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground line-through">
                          R$ {(product.old_price * quantity).toFixed(2).replace('.', ',')}
                        </span>
                        <span className="text-[11px] font-bold bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">
                          -{product.discount || Math.round((1 - product.price / product.old_price) * 100)}%
                        </span>
                      </div>
                    )}
                    <p className="text-3xl font-extrabold tracking-tight">R$&nbsp;{totalPrice}</p>
                  </div>

                  {/* Quantidade */}
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">Qtd.</span>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={decreaseQuantity} 
                        disabled={quantity <= 1}
                        className="h-9 w-9 rounded-lg border-border/20"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <input 
                        id="product-quantity"
                        name="quantity"
                        type="number" 
                        readOnly 
                        value={quantity}
                        autoComplete="off"
                        aria-label="Quantidade do produto"
                        className="w-12 h-9 text-center text-sm font-bold bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={increaseQuantity} 
                        className="h-9 w-9 rounded-lg border-border/20"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* CTAs */}
                  <div className="space-y-2.5">
                    <Button 
                      onClick={handleBuyNow} 
                      className="w-full h-13 text-[15px] font-bold bg-foreground hover:bg-foreground/90 text-background rounded-xl"
                    >
                      Comprar agora
                    </Button>
                    <Button 
                      onClick={handleAddToCart}
                      variant="outline"
                      className="w-full h-11 text-sm font-medium rounded-xl border-border/20 hover:bg-muted/50"
                    >
                      Adicionar ao carrinho
                    </Button>
                  </div>
                </div>

                {/* Trust signals */}
                <div className="rounded-2xl border border-border/10 bg-card p-5 space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green-400">✓</span>
                    <span className="text-muted-foreground">Entrega automática e instantânea</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green-400">✓</span>
                    <span className="text-muted-foreground">Ativável apenas no Brasil</span>
                  </div>
                  <div className="border-t border-border/10 pt-3 mt-3">
                    <p className="text-xs text-muted-foreground/70 font-medium mb-2.5">Meios de pagamento</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <img src={pixLogo} alt="PIX" className="w-4 h-4 opacity-70" loading="lazy" />
                        <span className="text-xs">PIX</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 opacity-70"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                        <span className="text-xs">Cartão</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Descrição/Instruções/Termos Mobile — Accordion style */}
            <div className="lg:hidden space-y-2">
              {/* Descrição */}
              <div className="border-b border-border/10">
                <button
                  onClick={() => setMobileSection(mobileSection === 'description' ? null : 'description')}
                  className="w-full flex items-center justify-between py-3.5"
                >
                  <span className="text-sm font-semibold">Descrição</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${mobileSection === 'description' ? 'rotate-180' : ''}`} />
                </button>
                {mobileSection === 'description' && (
                  <div className="pb-4">
                    <div className="description-content text-xs text-muted-foreground leading-relaxed">
                      {product.rich_description ? (
                        <div 
                          className="prose prose-invert prose-xs max-w-none [&_p]:text-xs [&_p]:mb-2 [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs" 
                          dangerouslySetInnerHTML={{ __html: sanitizedDescription }} 
                        />
                      ) : product.description ? (
                        <p className="whitespace-pre-line">{product.description}</p>
                      ) : (
                        <p>Sem descrição disponível.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Instruções */}
              {product.instructions && (
                <div className="border-b border-border/10">
                  <button
                    onClick={() => setMobileSection(mobileSection === 'instructions' ? null : 'instructions')}
                    className="w-full flex items-center justify-between py-3.5"
                  >
                    <span className="text-sm font-semibold">Instruções de Uso</span>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${mobileSection === 'instructions' ? 'rotate-180' : ''}`} />
                  </button>
                  {mobileSection === 'instructions' && (
                    <div className="pb-4">
                      <div 
                        className="prose prose-invert prose-xs max-w-none text-muted-foreground [&_p]:text-xs [&_p]:mb-2 [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs" 
                        dangerouslySetInnerHTML={{ __html: sanitizedInstructions }} 
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Termos */}
              {product.terms_conditions && (
                <div className="border-b border-border/10">
                  <button
                    onClick={() => setMobileSection(mobileSection === 'terms' ? null : 'terms')}
                    className="w-full flex items-center justify-between py-3.5"
                  >
                    <span className="text-sm font-semibold">Termos e Condições</span>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${mobileSection === 'terms' ? 'rotate-180' : ''}`} />
                  </button>
                  {mobileSection === 'terms' && (
                    <div className="pb-4">
                      <div 
                        className="prose prose-invert prose-xs max-w-none text-muted-foreground [&_p]:text-xs [&_p]:mb-2 [&_li]:text-xs [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs" 
                        dangerouslySetInnerHTML={{ __html: sanitizedTerms }} 
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Reviews - Lazy loaded */}
          {reviews.length > 0 && (
            <Suspense fallback={<div className="h-48 mt-6 animate-pulse bg-muted/10 rounded-2xl" />}>
              <ReviewsCarousel reviews={reviews} />
            </Suspense>
          )}

          {/* Produtos Relacionados */}
          <Suspense fallback={<div className="h-48 mt-6 animate-pulse bg-muted/10 rounded-2xl" />}>
            <RelatedProducts category={product.category} currentProductId={product.id} />
          </Suspense>
        </div>
      </main>

      {/* Sticky CTA Mobile */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40 bg-background/95 backdrop-blur-xl border-t border-border/10 pb-6">
        <div className="px-4 py-3 safe-area-inset-bottom flex items-center justify-between gap-4">
          {/* Preço */}
          <div className="flex flex-col min-w-0">
            {product.old_price && product.old_price > product.price && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground line-through">
                  R${(product.old_price * quantity).toFixed(2).replace('.', ',')}
                </span>
                <span className="text-[10px] font-bold bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded-full">
                  -{product.discount || Math.round((1 - product.price / product.old_price) * 100)}%
                </span>
              </div>
            )}
            <span className="text-xl font-extrabold whitespace-nowrap">R$&nbsp;{totalPrice}</span>
          </div>
          {/* Botão Comprar */}
          <Button 
            onClick={handleBuyNow} 
            className="h-12 px-6 text-[15px] font-bold bg-foreground hover:bg-foreground/90 text-background rounded-xl active:scale-[0.97] transition-transform shrink-0"
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
