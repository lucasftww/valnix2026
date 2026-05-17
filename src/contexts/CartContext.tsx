import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

// Cart persistence: localStorage with a 7-day TTL so the cart survives tab
// closes (sessionStorage was killing returning-visitor conversions). Old
// payloads are discarded silently.
const CART_STORAGE_KEY = 'valnix_cart_v2';
const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedCart {
  items: CartItem[];
  savedAt: number;
}

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCart | CartItem[];
    // Legacy: bare array (no envelope)
    if (Array.isArray(parsed)) return sanitize(parsed);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      if (Date.now() - (parsed.savedAt || 0) > CART_TTL_MS) {
        localStorage.removeItem(CART_STORAGE_KEY);
        return [];
      }
      return sanitize(parsed.items);
    }
  } catch {}
  return [];
}

function sanitize(items: unknown[]): CartItem[] {
  const out: CartItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Partial<CartItem>;
    if (typeof it.id !== 'string' || !it.id) continue;
    if (typeof it.name !== 'string' || !it.name) continue;
    const price = Number(it.price);
    const quantity = Math.floor(Number(it.quantity));
    if (!Number.isFinite(price) || price < 0) continue;
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    out.push({
      id: it.id,
      name: it.name,
      price,
      quantity: Math.min(quantity, 999),
      image: typeof it.image === 'string' ? it.image : '',
      category: typeof it.category === 'string' ? it.category : undefined,
      delivery_type: typeof it.delivery_type === 'string' ? it.delivery_type : undefined,
    });
  }
  return out;
}

function saveCart(items: CartItem[]) {
  try {
    if (items.length === 0) {
      localStorage.removeItem(CART_STORAGE_KEY);
    } else {
      const payload: PersistedCart = { items, savedAt: Date.now() };
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {}
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  category?: string;
  delivery_type?: string;
}

interface CartContextType {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  finalPrice: number;
  addItem: (item: Omit<CartItem, "quantity"> & { [key: string]: any }) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(loadCart);

  // Persist cart on every change (localStorage, 7-day TTL).
  useEffect(() => { saveCart(items); }, [items]);

  const totalItems = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    [items],
  );
  const totalPrice = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0),
    [items],
  );
  const finalPrice = totalPrice;

  const addItem = useCallback((newItem: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === newItem.id);
      if (existing) {
        return prev.map((item) =>
          item.id === newItem.id ? { ...item, quantity: Math.min(item.quantity + 1, 999) } : item,
        );
      }
      if (prev.length === 0) {
        // Lightweight: imports prefetchRoutes (a few bytes) which warms the
        // Checkout chunk. Previously did `import("@/App")` — circular.
        import("@/lib/prefetchRoutes").then((m) => m.prefetchCheckout()).catch(() => {});
      }
      return [...prev, { ...newItem, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    // 0 → remove (was a confusing no-op; many callers expect this).
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setItems((prev) => prev.filter((item) => item.id !== id));
      return;
    }
    const clamped = Math.min(Math.floor(quantity), 999);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: clamped } : item)),
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <CartContext.Provider
      value={{
        items,
        totalItems,
        totalPrice,
        finalPrice,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};
