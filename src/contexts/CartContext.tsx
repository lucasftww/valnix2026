import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { db } from "@/integrations/firebase/config";
import { collection, query, where, getDocs } from "firebase/firestore";
import { toast } from "sonner";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
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

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);

  const totalItems = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const totalPrice = useMemo(() => items.reduce((sum, item) => sum + item.price * item.quantity, 0), [items]);

  // Recalculate discount when cart total changes (e.g. quantity updated after coupon applied)
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
      const couponsRef = collection(db, "coupons");
      const q = query(couponsRef, where("code", "==", code.toUpperCase()));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast.error("Cupom não encontrado");
        return;
      }

      const couponDoc = snapshot.docs[0];
      const coupon = couponDoc.data();

      // Validate active
      if (!coupon.is_active) {
        toast.error("Este cupom está inativo");
        return;
      }

      // Validate expiration
      if (coupon.expires_at) {
        const expiresDate = new Date(coupon.expires_at);
        if (expiresDate < new Date()) {
          toast.error("Este cupom expirou");
          return;
        }
      }

      // Validate max uses
      if (coupon.max_uses && (coupon.current_uses || 0) >= coupon.max_uses) {
        toast.error("Este cupom atingiu o limite de usos");
        return;
      }

      // Validate min purchase
      const currentTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (coupon.min_purchase_amount && currentTotal < coupon.min_purchase_amount) {
        toast.error(`Compra mínima de R$ ${Number(coupon.min_purchase_amount).toFixed(2)} para este cupom`);
        return;
      }

      // Calculate discount
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
