import { useState, useEffect, useRef, useCallback, memo, KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./ui/input";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { collection, getDocs, limit, query as fsQuery } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  category: string;
  is_active?: boolean;
}

// Singleton para cache do catálogo (persiste entre remontagens)
let catalogCache: Product[] | null = null;

const SearchBarComponent = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number>();

  const loadCatalog = useCallback(async (): Promise<Product[]> => {
    if (catalogCache) return catalogCache;

    const q = fsQuery(collection(db, "products"), limit(500));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return {
        id: docSnap.id,
        name: String(data?.name ?? ""),
        price: Number(data?.price ?? 0),
        image_url: String(data?.image_url ?? ""),
        category: String(data?.category ?? ""),
        is_active: data?.is_active as boolean | undefined,
      } as Product;
    });

    catalogCache = items;
    return items;
  }, []);

  const searchProducts = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    setIsLoading(true);
    try {
      const items = await loadCatalog();
      const q = searchQuery.trim().toLowerCase();

      const filtered = items
        .filter((p) => p?.is_active !== false)
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 5);

      setResults(filtered);
      setIsOpen(true);
      setSelectedIndex(-1);
    } catch (error) {
      console.error("Erro ao buscar produtos:", error);
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadCatalog]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      searchProducts(query);
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, searchProducts]);

  const handleSelect = useCallback((productId: string) => {
    navigate(`/product/${productId}`);
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(-1);
  }, [navigate]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && results[selectedIndex]) {
        handleSelect(results[selectedIndex].id);
      } else if (results.length > 0) {
        handleSelect(results[0].id);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSelectedIndex(-1);
    }
  }, [selectedIndex, results, handleSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleClear = useCallback(() => {
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(-1);
  }, []);

  const handleFocus = useCallback(() => {
    if (query.length >= 2) setIsOpen(true);
  }, [query.length]);

  const handleCloseDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <div className="relative flex-1 max-w-xl">
      <div className="relative">
        <Input
          ref={inputRef}
          id="search"
          name="search"
          type="search"
          placeholder="O que está buscando?"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className="w-full pl-4 pr-12 h-11 md:h-10 bg-muted/50 border border-border/20 rounded-full text-sm text-foreground placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary/50 focus:border-primary/30 focus:bg-muted/70 transition-all"
          aria-label="Buscar produtos"
          aria-autocomplete="list"
          aria-controls="search-results"
          aria-expanded={isOpen && results.length > 0}
        />
        {query ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 p-0 hover:bg-secondary rounded-full"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={handleCloseDropdown}
          />
          <div className="absolute top-full left-0 right-0 mt-2 bg-background border border-border rounded-xl shadow-2xl z-50 overflow-hidden" id="search-results" role="listbox" aria-label="Resultados da busca">
            {results.map((product, index) => (
              <button
                key={product.id}
                onClick={() => handleSelect(product.id)}
                className={`w-full flex items-center gap-3 p-3 hover:bg-secondary/80 active:scale-[0.99] transition-all text-left ${
                  index === selectedIndex ? 'bg-secondary/80' : ''
                }`}
                aria-label={`Ver produto ${product.name}`}
              >
                <img
                  src={product.image_url}
                  alt=""
                  className="w-14 h-14 object-cover rounded-lg border border-border"
                  loading="lazy"
                  decoding="async"
                  width={56}
                  height={56}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{product.category}</p>
                </div>
                <span className="text-base font-bold text-primary whitespace-nowrap">
                  R$ {product.price.toFixed(2)}
                </span>
              </button>
            ))}
            {isLoading && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Buscando...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const SearchBar = memo(SearchBarComponent);
