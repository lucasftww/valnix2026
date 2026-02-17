import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE: No static Firebase imports!
// Firestore is only needed for coupon validation (applyCoupon),
// which is loaded dynamically when the user applies a coupon.
// ═══════════════════════════════════════════════════════════════════

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  delivery_type?: string;
}

interface AppliedCoupon {
  code: string;
  id: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
}

interface CartContextType {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  finalPrice: number;
  discount: number;
  couponCode: string | null;
  appliedCoupon: AppliedCoupon | null;
  addItem: (item: Omit<CartItem, "quantity"> & { [key: string]: any }) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => void;
}

const CART_STORAGE_KEY = "valnix_cart_items";
const COUPON_STORAGE_KEY = "valnix_cart_coupon";

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => loadFromStorage(CART_STORAGE_KEY, []));
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(() => loadFromStorage(COUPON_STORAGE_KEY, null));

  // Persist cart to localStorage
  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  useEffect(() => {
    try {
      if (appliedCoupon) {
        localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(appliedCoupon));
      } else {
        localStorage.removeItem(COUPON_STORAGE_KEY);
      }
    } catch {}
  }, [appliedCoupon]);

  const totalItems = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const totalPrice = useMemo(() => items.reduce((sum, item) => sum + item.price * item.quantity, 0), [items]);

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.discount_type === "percentage") {
      return Math.min(totalPrice * (appliedCoupon.discount_value / 100), totalPrice);
    }
    return Math.min(Number(appliedCoupon.discount_value), totalPrice);
  }, [appliedCoupon, totalPrice]);

  const finalPrice = useMemo(() => Math.max(0, totalPrice - discount), [totalPrice, discount]);

  const addItem = useCallback((newItem: Omit<CartItem, "quantity">) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === newItem.id);
      if (existing) {
        return prev.map((item) =>
          item.id === newItem.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      // Prefetch checkout chunk on first item added
      if (prev.length === 0) {
        import("@/App").then(m => m.prefetchCheckout?.()).catch(() => {});
      }
      return [...prev, { ...newItem, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity < 1) return;
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setAppliedCoupon(null);
  }, []);

  const applyCoupon = useCallback(async (code: string) => {
    try {
      // Lazy-load Firebase only when user applies a coupon
      const [config, fs] = await Promise.all([
        import("@/integrations/firebase/config"),
        import("firebase/firestore"),
      ]);

      const couponsRef = fs.collection(config.db, "coupons");
      const q = fs.query(couponsRef, fs.where("code", "==", code.toUpperCase()));

      // Inline resilient fetch with timeout
      await config.appCheckReady;
      const firestorePromise = fs.getDocsFromServer(q);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 5000)
      );
      firestorePromise.catch(() => {});
      timeout.catch(() => {});

      const snapshot = await Promise.race([firestorePromise, timeout]);

      if (snapshot.empty) {
        toast.error("Cupom não encontrado");
        return;
      }

      const couponDoc = snapshot.docs[0];
      const coupon = couponDoc.data();

      if (!coupon.is_active) {
        toast.error("Este cupom está inativo");
        return;
      }

      if (coupon.expires_at) {
        const expiresDate = new Date(coupon.expires_at);
        if (expiresDate < new Date()) {
          toast.error("Este cupom expirou");
          return;
        }
      }

      if (coupon.max_uses && (coupon.current_uses || 0) >= coupon.max_uses) {
        toast.error("Este cupom atingiu o limite de usos");
        return;
      }

      const currentTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (coupon.min_purchase_amount && currentTotal < coupon.min_purchase_amount) {
        toast.error(`Compra mínima de R$ ${Number(coupon.min_purchase_amount).toFixed(2)} para este cupom`);
        return;
      }

      let discountAmount: number;
      if (coupon.discount_type === "percentage") {
        discountAmount = currentTotal * (coupon.discount_value / 100);
      } else {
        discountAmount = Number(coupon.discount_value);
      }
      discountAmount = Math.min(discountAmount, currentTotal);

      setAppliedCoupon({
        code: coupon.code,
        id: couponDoc.id,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
      });

      toast.success(`Cupom ${coupon.code} aplicado! -R$ ${discountAmount.toFixed(2)}`);
    } catch (error) {
      console.error("Error applying coupon:", error);
      toast.error("Erro ao validar cupom");
    }
  }, [items]);

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null);
  }, []);

  return (
    <CartContext.Provider
      value={{
        items,
        totalItems,
        totalPrice,
        finalPrice,
        discount,
        couponCode: appliedCoupon?.code || null,
        appliedCoupon,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        applyCoupon,
        removeCoupon,
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
