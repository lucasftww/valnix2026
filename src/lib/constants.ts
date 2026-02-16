// Constantes centralizadas para evitar magic strings e facilitar manutenção

export const QUERY_KEYS = {
  // Produtos
  PRODUCTS: 'products',
  BEST_SELLING: 'best-selling-products',
  PRODUCT: 'product',
  CATEGORY_PRODUCTS: 'category-products',
  
  // Categorias
  CATEGORIES: 'categories',
  CATEGORY: 'category',
  SIDEBAR_CATEGORIES: 'sidebar-categories',
  FOOTER_CATEGORIES: 'footer-categories',
  HOME_CATEGORIES: 'home-categories',
  
  // Reviews
  REVIEWS: 'reviews',
  PRODUCT_REVIEWS: 'product_reviews',
  
  // Outros
  BANNERS: 'banners',
  ORDERS: 'orders',
  USER_ORDERS: 'user-orders',
  COUPONS: 'coupons',
  PROFILES: 'profiles',
} as const;

export const CACHE_TIMES = {
  // Cache muito agressivo para dados que mudam pouco (categorias, banners)
  STATIC: {
    staleTime: 60 * 60 * 1000, // 1 hora - dados quase nunca mudam
    gcTime: 2 * 60 * 60 * 1000, // 2 horas
  },
  // Cache agressivo para produtos (raramente mudam durante sessão)
  AGGRESSIVE: {
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,    // 1 hora
  },
  // Cache moderado para dados que mudam ocasionalmente  
  MODERATE: {
    staleTime: 15 * 60 * 1000, // 15 min
    gcTime: 30 * 60 * 1000,    // 30 min
  },
  // Cache curto para dados mais dinâmicos
  SHORT: {
    staleTime: 5 * 60 * 1000,  // 5 min
    gcTime: 10 * 60 * 1000,    // 10 min
  },
} as const;

export const ROUTES = {
  HOME: '/',
  AUTH: '/auth',
  CART: '/cart',
  CHECKOUT: '/checkout',
  MY_ORDERS: '/my-orders',
  ADMIN: '/admin',
  ABOUT: '/about',
  TERMS: '/terms',
  SEIZED: '/seized',
  PRODUCT: (id: string) => `/product/${id}`,
  CATEGORY: (slug: string) => `/${slug}`,
} as const;

// Configurações de UI
export const UI_CONFIG = {
  PRODUCTS_PER_PAGE: 12,
  FEATURED_PRODUCTS_LIMIT: 12,
  SKELETON_COUNT: 6,
  ANIMATION_DURATION: 300,
  TOAST_DURATION: 5000,
} as const;

// Formatadores
export const formatPrice = (value: number): string => {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
};
