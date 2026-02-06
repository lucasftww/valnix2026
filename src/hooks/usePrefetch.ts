import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Páginas para fazer prefetch baseado na página atual
const prefetchMap: Record<string, string[]> = {
  '/': ['/valorant', '/roblox', '/cart'],
  '/valorant': ['/cart', '/checkout', '/product'],
  '/roblox': ['/cart', '/checkout', '/product'],
  '/cart': ['/checkout', '/auth'],
  '/product': ['/cart', '/checkout'],
  '/checkout': ['/my-orders'],
  '/auth': ['/'],
};

export const usePrefetch = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Aguardar o carregamento inicial antes de fazer prefetch
    const timeoutId = setTimeout(() => {
      const currentPath = location.pathname;
      const pagesToPrefetch = prefetchMap[currentPath] || [];

      pagesToPrefetch.forEach((path) => {
        // Criar link invisível para prefetch
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = path;
        link.as = 'document';
        document.head.appendChild(link);

        // Prefetch de dados com React Query (preparar cache)
        // Apenas adiciona o link, não faz requisições desnecessárias
      });
    }, 2000); // Prefetch após 2s da navegação

    return () => {
      clearTimeout(timeoutId);
    };
  }, [location.pathname]);

  // Função para prefetch manual sob demanda
  const prefetchRoute = (path: string) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = path;
    link.as = 'document';
    document.head.appendChild(link);
  };

  return { prefetchRoute };
};

// Hook para prefetch de imagens críticas
export const usePrefetchImages = (images: string[]) => {
  useEffect(() => {
    images.forEach((src) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = src;
      link.as = 'image';
      document.head.appendChild(link);
    });
  }, [images]);
};
