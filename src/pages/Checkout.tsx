import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useCart, CartItem } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/firebase/config";
import { doc, getDoc, updateDoc, increment, collection, getDocs, query, where } from "firebase/firestore";
import { createOrder, createOrderItems, updateOrderStatus } from "@/hooks/firebase";
import { Loader2, Zap, Lock, Check, AlertCircle, Wallet, CreditCard, ChevronUp } from "lucide-react";
import { PixPayment } from "@/components/checkout/PixPayment";
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { MobileStickyCheckout } from "@/components/checkout/MobileStickyCheckout";
import pixLogo from "@/assets/pix-logo.png";
import { invokeFunction, invokeFunctionFireAndForget } from "@/lib/apiHelper";
import { trackInitiateCheckoutEvent, trackPurchaseEvent } from "@/lib/analytics";
import { sendInitiateCheckout } from "@/lib/metaCapi";
import { saveGuestOrder } from "@/lib/guestOrders";

// Read Facebook cookies for CAPI match quality
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

interface FormData {
  name: string;
  document: string;
  email: string;
  phone: string;
}

interface PaymentData {
  qrCodeText: string;
  transactionId: string;
  amount: number;
  orderId: string;
}

// CPF mask helper
const formatCPF = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

// Full CPF validation with check digits
const isValidCPF = (cpf: string): boolean => {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;
  
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;
  
  return true;
};

export default function Checkout() {
  const { items, totalPrice, finalPrice, discount, appliedCoupon, clearCart, applyCoupon, removeCoupon, removeItem, updateQuantity } = useCart();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false); // Sync lock to prevent double-submit
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "balance" | "card">("pix");
  const [formData, setFormData] = useState<FormData>(() => {
    try {
      const saved = sessionStorage.getItem('valnix_checkout_form');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { name: "", document: "", email: "", phone: "" };
  });
  const [couponCode, setCouponCode] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Generate a stable guest ID for non-logged users
  const guestId = useMemo(() => {
    if (user) return null;
    const stored = sessionStorage.getItem('valnix_guest_id');
    if (stored) return stored;
    const id = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('valnix_guest_id', id);
    return id;
  }, [user]);

  // Read UTM params from sessionStorage (set by index.html script)
  const utmParams = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('valnix_utm_params');
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch {}
    return {} as Record<string, string>;
  }, []);

  const effectiveUserId = user?.uid || guestId || 'guest';

  // Redirect if cart is empty (and not on payment screen)
  useEffect(() => {
    if (items.length === 0 && !paymentData) {
      navigate("/");
    }
  }, [items.length, paymentData, navigate]);

  // Track InitiateCheckout once on mount (analytics only, CAPI sent on submit)
  useEffect(() => {
    if (items.length > 0) {
      trackInitiateCheckoutEvent(effectiveUserId, finalPrice);
    }
  }, []); // fire once on mount

  // Load user profile
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    
    const loadProfile = async () => {
      try {
        const profileRef = doc(db, "profiles", user.uid);
        const profileSnap = await getDoc(profileRef);
        const profileData = profileSnap.exists() ? profileSnap.data() : null;

        if (mounted) {
          setFormData(prev => {
            const updated = {
              ...prev,
              name: prev.name || user.displayName || profileData?.full_name || "",
              email: prev.email || user.email || profileData?.email || "",
              phone: prev.phone || profileData?.phone || "",
            };
            try { sessionStorage.setItem('valnix_checkout_form', JSON.stringify(updated)); } catch {}
            return updated;
          });
          setUserBalance(profileData?.balance || 0);
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      }
    };
    
    loadProfile();
    return () => { mounted = false; };
  }, [user]);

  // Save checkout data to user profile (except nickname)
  const saveCheckoutDataToProfile = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const profileRef = doc(db, "profiles", user.uid);
      const updates: Record<string, string | null> = {};
      if (formData.name.trim()) updates.full_name = formData.name.trim();
      if (formData.phone.trim()) updates.phone = formData.phone.trim();
      if (Object.keys(updates).length > 0) {
        await updateDoc(profileRef, updates);
      }
    } catch (err) {
      console.warn('⚠️ Failed to save profile data:', err);
    }
  }, [user?.uid, formData.name, formData.phone]);

  const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const validation = useMemo(() => {
    return {
      name: formData.name.trim().length >= 3 && formData.name.trim().split(' ').length >= 2,
      nameError: formData.name.trim().length < 3 
        ? 'Nome deve ter pelo menos 3 caracteres' 
        : formData.name.trim().split(' ').length < 2 
          ? 'Digite nome e sobrenome' 
          : undefined,
      document: isValidCPF(formData.document),
      documentError: formData.document.replace(/\D/g, '').length === 11 && !isValidCPF(formData.document)
        ? 'CPF inválido (verifique os dígitos)'
        : formData.document.replace(/\D/g, '').length < 11
          ? 'CPF incompleto'
          : undefined,
      email: isValidEmail(formData.email),
      emailError: formData.email.trim().length > 0 && !isValidEmail(formData.email)
        ? 'E-mail inválido'
        : formData.email.trim().length === 0
          ? 'E-mail é obrigatório'
          : undefined,
    };
  }, [formData]);

  const isFormValid = validation.name && validation.document && validation.email;
  

  const handleInputChange = useCallback((field: keyof FormData, value: string) => {
    let formattedValue = value;
    if (field === 'document') {
      formattedValue = formatCPF(value);
    }
    setFormData(prev => {
      const updated = { ...prev, [field]: formattedValue };
      try { sessionStorage.setItem('valnix_checkout_form', JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  }, []);

  const handleApplyCoupon = useCallback(async () => {
    if (!couponCode.trim()) return;
    setApplyingCoupon(true);
    await applyCoupon(couponCode);
    setApplyingCoupon(false);
  }, [couponCode, applyCoupon]);

  const handleSubmit = useCallback(async () => {
    // Synchronous lock — prevents race condition from rapid clicks
    if (isSubmittingRef.current || loading) return;
    isSubmittingRef.current = true;
    
    setTouched({ name: true, document: true, email: true });
    
    if (!isFormValid) {
      const errors: string[] = [];
      if (!validation.name) errors.push(validation.nameError || 'Nome inválido');
      if (!validation.email) errors.push(validation.emailError || 'E-mail inválido');
      if (!validation.document) errors.push(validation.documentError || 'CPF inválido');
      
      toast({
        title: "Verifique os campos",
        description: errors[0] || "Preencha todos os campos corretamente.",
        variant: "destructive",
      });
      isSubmittingRef.current = false;
      return;
    }
    
    setLoading(true);

    // Send InitiateCheckout to Meta CAPI (with enriched user data from form)
    sendInitiateCheckout({
      userId: effectiveUserId,
      email: formData.email || user?.email || undefined,
      phone: formData.phone || undefined,
      name: formData.name,
      value: finalPrice,
      productNames: items.map(i => i.name),
    });
    
    try {
      const orderAmount = finalPrice;
      
      if (orderAmount < 1) {
        toast({
          title: "Valor insuficiente",
          description: "O valor mínimo para finalizar um pedido é R$ 1,00",
          variant: "destructive",
        });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      // Handle balance payment
      if (paymentMethod === "balance") {
        if (userBalance < orderAmount) {
          toast({
            title: "Saldo insuficiente",
            description: `Seu saldo (R$ ${userBalance.toFixed(2)}) é menor que o valor do pedido.`,
            variant: "destructive",
          });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const orderId = await createOrder({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || user?.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)}) | Pago com saldo` : "Pago com saldo",
          status: "processing",
          payment_status: "paid",
          payment_method: "balance",
          fbc: getCookie('_fbc'),
          fbp: getCookie('_fbp'),
          utm_source: utmParams.utm_source || null,
          utm_medium: utmParams.utm_medium || null,
          utm_campaign: utmParams.utm_campaign || null,
          utm_content: utmParams.utm_content || null,
          utm_term: utmParams.utm_term || null,
        });

        // Balance: delivery is handled server-side via process-delivery (single-writer)
        // No client-side code consumption — just create items without delivery codes
        const orderItemsData = items.map(item => ({
          order_id: orderId,
          product_id: item.id,
          product_name: item.name,
          product_image: item.image,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.price * item.quantity,
          delivery_type: item.delivery_type || 'manual',
          auto_delivery_codes: null as string[] | null,
        }));

        await createOrderItems(orderItemsData, false); // Never process delivery client-side

        // 🔒 Call server-side process-delivery for auto-delivery (single-writer)
        try {
          const idToken = user ? await user.getIdToken() : null;
          const deliveryRes = await invokeFunction('process-delivery', {
            method: 'POST',
            headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {},
            body: { orderId },
          });
          const deliveryResult = await deliveryRes.json();
          console.log(`📦 Balance process-delivery for ${orderId}:`, deliveryResult);
        } catch (deliveryErr) {
          console.warn('⚠️ Balance process-delivery failed (will retry via admin):', deliveryErr);
        }

        if (user) {
          const profileRef = doc(db, "profiles", user.uid);
          await updateDoc(profileRef, {
            balance: increment(-orderAmount)
          });
        }

        trackPurchaseEvent(effectiveUserId, orderAmount, orderId, items.map(i => i.name).join(', '));

        // Send Purchase to Meta CAPI (server-side via edge function)
        try {
          const nameParts = formData.name.split(' ');
          invokeFunctionFireAndForget('meta-capi', {
            event_name: 'Purchase',
            event_id: `purchase_${orderId}_${Date.now()}`,
            order_id: orderId,
            value: orderAmount,
            currency: 'BRL',
            content_name: items.map(i => i.name).join(', '),
            email: formData.email || user?.email,
            phone: formData.phone || undefined,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(' ') || undefined,
            external_id: effectiveUserId,
            fbc: getCookie('_fbc') || undefined,
            fbp: getCookie('_fbp') || undefined,
          }).then(() => {
            console.log('📡 Meta CAPI Purchase sent (balance payment)');
          });
        } catch (e) { console.warn('⚠️ Meta CAPI balance error:', e); }

        // Send Purchase to UTMify (server-side via edge function)
        try {
          invokeFunctionFireAndForget('utmify-event', {
            order_id: orderId,
            event_type: 'Purchase',
            value: orderAmount,
            customer_name: formData.name,
            customer_email: formData.email || user?.email,
            customer_phone: formData.phone || undefined,
            product_name: items.map(i => i.name).join(', '),
            utm_source: utmParams.utm_source || undefined,
            utm_medium: utmParams.utm_medium || undefined,
            utm_campaign: utmParams.utm_campaign || undefined,
            utm_content: utmParams.utm_content || undefined,
            utm_term: utmParams.utm_term || undefined,
          }).then(() => {
            console.log('📡 UTMify Purchase sent (balance payment)');
          });
        } catch (e) { console.warn('⚠️ UTMify balance error:', e); }

        // Increment coupon usage only on successful order
        if (appliedCoupon) {
          updateDoc(doc(db, "coupons", appliedCoupon.id), {
            current_uses: increment(1),
          }).catch(err => console.warn('⚠️ Failed to increment coupon usage:', err));
        }

        saveCheckoutDataToProfile();
        clearCart();

        // Save guest order for /order/:hash access
        let orderHash: string | null = null;
        try {
          orderHash = await saveGuestOrder({
            orderId,
            email: formData.email || user?.email || "",
            customerName: formData.name,
            customerPhone: formData.phone || undefined,
            guestSessionId: guestId,
            items: orderItemsData.map(i => ({
              product_name: i.product_name,
              product_image: i.product_image || null,
              quantity: i.quantity,
              unit_price: i.unit_price,
              total_price: i.total_price,
              delivery_code: null, // will be updated after auto-delivery
            })),
            totalAmount: orderAmount,
            paymentMethod: "balance",
          });
        } catch (err) {
          console.warn("⚠️ Failed to save guest order:", err);
        }

        toast({
          title: "Pagamento confirmado!",
          description: `Pedido #${orderId.substring(0, 8)} pago com saldo. R$ ${orderAmount.toFixed(2)} debitados.`,
        });
        
        if (orderHash) {
          navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${orderHash}`);
        } else {
          navigate(`/entrega-prioritaria?order_id=${orderId}`);
        }
        return;
      }

      // CARD payment flow — create order, then redirect to FlowPay checkout
      if (paymentMethod === "card") {
        const cpfDigits = formData.document.replace(/\D/g, '');

        const orderId = await createOrder({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || user?.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)}) | Cartão` : "Cartão",
          status: "pending",
          payment_status: "pending",
          payment_method: "card",
          fbc: getCookie('_fbc'),
          fbp: getCookie('_fbp'),
          utm_source: utmParams.utm_source || null,
          utm_medium: utmParams.utm_medium || null,
          utm_campaign: utmParams.utm_campaign || null,
          utm_content: utmParams.utm_content || null,
          utm_term: utmParams.utm_term || null,
        });

        // Card: delivery is handled server-side (webhook/auto-verify), no need to fetch codes client-side
        const productsDeliveryInfo: Record<string, { delivery_type: string; auto_delivery_codes: string[] | null }> = {};
        for (const item of items) {
          productsDeliveryInfo[item.id] = { delivery_type: item.delivery_type || 'manual', auto_delivery_codes: null };
        }

        // Create order items with delivery info
        const orderItemsData = items.map(item => {
          const deliveryInfo = productsDeliveryInfo[item.id] || { delivery_type: item.delivery_type || 'manual', auto_delivery_codes: null };
          return {
            order_id: orderId,
            product_id: item.id,
            product_name: item.name,
            product_image: item.image,
            quantity: item.quantity,
            unit_price: item.price,
            total_price: item.price * item.quantity,
            delivery_type: deliveryInfo.delivery_type,
            auto_delivery_codes: deliveryInfo.auto_delivery_codes,
          };
        });
        createOrderItems(orderItemsData, false).catch(err => console.warn('⚠️ Order items failed:', err));

        // Create card charge via edge function
        const cardResponse = await invokeFunction('flowpay-card', {
          method: 'POST',
          queryParams: { action: 'create' },
          body: {
            amount: Math.round(orderAmount * 100),
            orderId,
            description: `Pedido ${orderId.substring(0, 8)}`,
            customer: {
              name: formData.name,
              email: formData.email || user?.email || undefined,
              phone: formData.phone || undefined,
              taxId: cpfDigits,
            },
          },
        });

        const cardData = await cardResponse.json();

        if (!cardResponse.ok || !cardData.success) {
          throw new Error(cardData.error || 'Erro ao criar cobrança de cartão');
        }

        // Store card payment info for callback
        sessionStorage.setItem('valnix_card_payment', JSON.stringify({
          orderId,
          paymentId: cardData.paymentId,
          couponId: appliedCoupon?.id || null, // Will be used to ensure coupon is saved to order on callback if not already
          couponCode: appliedCoupon?.code || null,
          discountAmount: discount || 0,
          customerName: formData.name,
          customerEmail: formData.email || user?.email || "",
          customerPhone: formData.phone || "",
          userId: effectiveUserId,
          productNames: items.map(i => i.name),
        }));

        // Save flowpay_charge_id and coupon info on the order for admin verification & webhook processing
        try {
          const orderRef = doc(db, "orders", orderId);
          await updateDoc(orderRef, { 
            flowpay_charge_id: cardData.paymentId,
            coupon_id: appliedCoupon?.id || null,
            coupon_code: appliedCoupon?.code || null,
          });
        } catch (err) {
          console.warn('⚠️ Failed to save flowpay_charge_id/coupon:', err);
        }

        // NOTE: Coupon increment is handled by CardPaymentCallback after payment confirmation.

        saveCheckoutDataToProfile();
        clearCart();

        // Open FlowPay checkout in new tab and navigate to callback page
        window.open(cardData.paymentUrl, '_blank');
        navigate(`/card-callback?order_id=${orderId}&payment_id=${cardData.paymentId}`);
        return;
      }

      // PIX payment flow — parallelize order creation + token fetch
      const cpfDigits = formData.document.replace(/\D/g, '');
      const tokenPromise = user ? user.getIdToken() : Promise.resolve(null);

      const [orderId, firebaseIdToken] = await Promise.all([
        createOrder({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || user?.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)})` : null,
          status: "pending",
          payment_status: "pending",
          payment_method: "pix",
          fbc: getCookie('_fbc'),
          fbp: getCookie('_fbp'),
          utm_source: utmParams.utm_source || null,
          utm_medium: utmParams.utm_medium || null,
          utm_campaign: utmParams.utm_campaign || null,
          utm_content: utmParams.utm_content || null,
          utm_term: utmParams.utm_term || null,
        }),
        tokenPromise,
      ]);

      // Update order with coupon info if applied
      if (appliedCoupon) {
        const orderRef = doc(db, "orders", orderId);
        await updateDoc(orderRef, { 
          coupon_id: appliedCoupon.id,
          coupon_code: appliedCoupon.code,
        });
      }

      const orderItemsData = items.map(item => ({
        order_id: orderId,
        product_id: item.id,
        product_name: item.name,
        product_image: item.image,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
      }));

      const pixHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (firebaseIdToken) {
        pixHeaders['Authorization'] = `Bearer ${firebaseIdToken}`;
      }

      // Fire PIX + order items in parallel
      const pixPromise = invokeFunction('flowpay-pix', {
        method: 'POST',
        queryParams: { action: 'create' },
        headers: firebaseIdToken ? { 'Authorization': `Bearer ${firebaseIdToken}` } : {},
        body: {
          amount: Math.round(orderAmount * 100),
          orderId,
          description: `Pedido ${orderId.substring(0, 8)}`,
          customer: {
            name: formData.name,
            email: formData.email || user?.email || undefined,
            phone: formData.phone || undefined,
            taxId: cpfDigits,
          },
        },
      });

      // Fire order items creation in parallel (don't await before PIX)
      const itemsPromise = createOrderItems(orderItemsData).catch(err => {
        console.warn('⚠️ Order items creation failed (non-blocking):', err);
      });

      // Await PIX response (critical path)
      const pixResponse = await pixPromise;

      // Defensive response parsing
      const contentType = pixResponse.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const textResponse = await pixResponse.text();
        console.error('Gateway returned non-JSON:', textResponse.substring(0, 200));
        throw new Error('Erro no gateway de pagamento. Tente novamente.');
      }

      let pixData;
      try {
        pixData = await pixResponse.json();
      } catch (parseError) {
        console.error('Failed to parse PIX response:', parseError);
        throw new Error('Resposta inválida do gateway. Tente novamente.');
      }

      if (!pixResponse.ok || !pixData.success) {
        throw new Error(pixData.error || 'Erro ao gerar cobrança PIX');
      }

      // Ensure order items are saved before showing payment screen
      await itemsPromise;

      // NOTE: Coupon usage is NOT incremented here because PIX payment hasn't been confirmed yet.
      // The PixPayment component handles coupon increment after payment confirmation via polling.

      saveCheckoutDataToProfile();

      setPaymentData({
        qrCodeText: pixData.brCode,
        transactionId: pixData.chargeId,
        amount: orderAmount,
        orderId,
      });

    } catch (error: unknown) {
      console.error("Error creating order:", error);
      const errorMessage = error instanceof Error ? error.message : "Tente novamente mais tarde.";
      toast({
        title: "Erro ao criar pedido",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  }, [loading, isFormValid, formData, items, finalPrice, discount, appliedCoupon, toast, paymentMethod, userBalance, clearCart, navigate, user, effectiveUserId]);

  // Payment screen
  if (paymentData) {
    return (
      <div className="min-h-screen bg-[#0d0d0d]">
        <CheckoutHeader currentStep={2} />
        <main className="max-w-xl mx-auto px-4 py-8">
          <div className="bg-[#111] rounded-lg border border-[#1f1f1f] p-6">
            <PixPayment
              qrCodeText={paymentData.qrCodeText}
              transactionId={paymentData.transactionId}
              amount={paymentData.amount}
              orderId={paymentData.orderId}
              customerEmail={formData.email || user?.email || undefined}
              customerName={formData.name || undefined}
              customerId={effectiveUserId}
              productNames={items.map(item => item.name)}
              productIds={items.map(item => item.id)}
              // Coupon usage is now handled server-side via webhook or client-side polling fallback in PixPayment
              couponId={appliedCoupon?.id || undefined} 
              onPaymentConfirmed={clearCart}
            />
          </div>
        </main>
      </div>
    );
  }

  // Validation icon component
  const ValidationIcon = ({ isValid, show }: { isValid: boolean; show: boolean }) => {
    if (!show) return null;
    return isValid ? (
      <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
    ) : (
      <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
    );
  };

  const getInputClassName = (field: 'name' | 'document' | 'email', baseClass: string) => {
    if (!touched[field]) return baseClass;
    return validation[field] 
      ? `${baseClass} border-green-500/50 pr-10` 
      : `${baseClass} border-red-500/50 pr-10`;
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      <CheckoutHeader currentStep={1} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:py-10 pb-36 lg:pb-10">
        {/* Mobile: Sticky bottom bar with summary dropdown */}
        <MobileStickyCheckout
          items={items}
          finalPrice={finalPrice}
          loading={loading}
          paymentMethod={paymentMethod}
          onSubmit={handleSubmit}
        />

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column */}
          <div className="flex-1 space-y-5">
            {/* Payment Method Card */}
            <div className="bg-[#111] rounded-lg border border-[#1f1f1f] p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold text-white mb-5">Pagamento</h2>
              
              <RadioGroup 
                value={paymentMethod} 
                onValueChange={(value) => setPaymentMethod(value as "pix" | "balance" | "card")}
                className="space-y-2.5"
              >
                {/* PIX Option */}
                <div 
                  className={`flex items-center gap-3 p-3 sm:p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    paymentMethod === "pix" 
                      ? "border-primary bg-primary/5" 
                      : "border-[#222] bg-[#0d0d0d] hover:border-[#333]"
                  }`}
                  onClick={() => setPaymentMethod("pix")}
                >
                  <RadioGroupItem value="pix" id="pix" className="shrink-0" />
                  <Label htmlFor="pix" className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                    <img src={pixLogo} alt="PIX" className="w-7 h-7 object-contain shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] sm:text-[14px] font-medium text-white">PIX</p>
                    </div>
                  </Label>
                </div>

                {/* Card Option */}
                <div 
                  className={`flex items-center gap-3 p-3 sm:p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    paymentMethod === "card" 
                      ? "border-blue-500 bg-blue-500/5" 
                      : "border-[#222] bg-[#0d0d0d] hover:border-[#333]"
                  }`}
                  onClick={() => setPaymentMethod("card")}
                >
                  <RadioGroupItem value="card" id="card" className="shrink-0" />
                  <Label htmlFor="card" className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                    <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                      <CreditCard className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] sm:text-[14px] font-medium text-white whitespace-nowrap">Crédito ou débito</p>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <div className="h-[16px] w-[24px] rounded-sm bg-[#1a1f71] flex items-center justify-center">
                            <span className="text-[5px] font-bold text-white italic">VISA</span>
                          </div>
                          <div className="h-[16px] w-[24px] rounded-sm bg-[#0a0a0a] border border-[#333] flex items-center justify-center">
                            <div className="flex">
                              <div className="w-[6px] h-[6px] rounded-full bg-[#eb001b] -mr-[2px]" />
                              <div className="w-[6px] h-[6px] rounded-full bg-[#f79e1b] opacity-80" />
                            </div>
                          </div>
                          <div className="h-[16px] w-[24px] rounded-sm bg-[#006fcf] flex items-center justify-center">
                            <span className="text-[5px] font-bold text-white">AMEX</span>
                          </div>
                        </div>
                      </div>
                      
                    </div>
                  </Label>
                </div>

                {/* Balance Option */}
                {userBalance > 0 && (
                  <div 
                    className={`relative flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      paymentMethod === "balance" 
                        ? "border-primary bg-primary/5" 
                        : "border-[#222] bg-[#0d0d0d] hover:border-[#333]"
                    } ${userBalance < finalPrice ? "opacity-60" : ""}`}
                    onClick={() => userBalance >= finalPrice && setPaymentMethod("balance")}
                  >
                    <RadioGroupItem 
                      value="balance" 
                      id="balance" 
                      className="shrink-0"
                      disabled={userBalance < finalPrice}
                    />
                    <Label htmlFor="balance" className="flex items-center gap-3 cursor-pointer flex-1">
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-green-500" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-medium text-white">Saldo da conta</p>
                          <span className="text-[12px] font-semibold text-green-500">
                            R$ {userBalance.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#888] mt-1.5">
                          {userBalance >= finalPrice 
                            ? "Pagamento imediato" 
                            : "Saldo insuficiente"}
                        </p>
                      </div>
                    </Label>
                  </div>
                )}
              </RadioGroup>

              {/* Payment info */}
              <div className="bg-[#161616] rounded-lg p-4 border border-[#222] mt-5">
                {paymentMethod === "pix" ? (
                  <>
                    <h3 className="text-[14px] font-semibold text-white mb-2">Pagamento com Pix</h3>
                    <p className="text-[13px] text-[#888] leading-relaxed">
                      Ao confirmar o pedido, você receberá um QR Code para realizar o pagamento. 
                      Utilize o aplicativo do seu banco para escanear o QR Code ou copie o código.
                    </p>
                  </>
                ) : paymentMethod === "card" ? (
                  <>
                    <h3 className="text-[14px] font-semibold text-white mb-2">Pagamento com Cartão</h3>
                    <p className="text-[13px] text-[#888] leading-relaxed">
                      Ao finalizar a compra, você será redirecionado para um site seguro para inserir os dados do seu cartão e completar o pagamento.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-[14px] font-semibold text-white mb-2">Pagamento com Saldo</h3>
                    <p className="text-[13px] text-[#888] leading-relaxed">
                      O valor será debitado imediatamente do seu saldo. 
                      Saldo após compra: <span className="text-green-500 font-medium">R$ {(userBalance - finalPrice).toFixed(2)}</span>
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Personal Info Card */}
            <div className="bg-[#111] rounded-lg border border-[#1f1f1f] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-[15px] font-semibold text-white">Informações do comprador</h2>
              </div>

              <div className="space-y-4">
                {/* Name + CPF */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div>
                    <label htmlFor="checkout-name" className="block text-[13px] text-[#888] mb-2">
                      Nome completo <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Input
                        id="checkout-name"
                        name="name"
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        onBlur={() => handleBlur('name')}
                        placeholder="NOME SOBRENOME"
                        autoComplete="name"
                        className={getInputClassName('name', "h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px] uppercase")}
                      />
                      <ValidationIcon isValid={validation.name} show={touched.name || false} />
                    </div>
                    {touched.name && !validation.name && (
                      <p className="text-red-400 text-[11px] mt-1.5">{validation.nameError || 'Nome inválido'}</p>
                    )}
                  </div>
                  
                  {/* CPF */}
                  <div>
                    <label htmlFor="checkout-cpf" className="block text-[13px] text-[#888] mb-2">
                      CPF <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Input
                        id="checkout-cpf"
                        name="cpf"
                        value={formData.document}
                        onChange={(e) => handleInputChange('document', e.target.value)}
                        onBlur={() => handleBlur('document')}
                        placeholder="000.000.000-00"
                        inputMode="numeric"
                        autoComplete="off"
                        className={getInputClassName('document', "h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px]")}
                      />
                      <ValidationIcon isValid={validation.document} show={touched.document || false} />
                    </div>
                    {touched.document && !validation.document && (
                      <p className="text-red-400 text-[11px] mt-1.5">{validation.documentError || 'CPF inválido'}</p>
                    )}
                  </div>
                </div>

                {/* Email + Phone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Email */}
                  <div>
                    <label htmlFor="checkout-email" className="block text-[13px] text-[#888] mb-2">
                      E-mail <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Input
                        id="checkout-email"
                        name="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        onBlur={() => handleBlur('email')}
                        placeholder="seuemail@exemplo.com"
                        type="email"
                        autoComplete="email"
                        className={getInputClassName('email', "h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px]")}
                      />
                      <ValidationIcon isValid={validation.email} show={touched.email || false} />
                    </div>
                    {touched.email && !validation.email && (
                      <p className="text-red-400 text-[11px] mt-1.5">{validation.emailError || 'E-mail inválido'}</p>
                    )}
                  </div>

                  {/* Phone (optional) */}
                  <div>
                    <label htmlFor="checkout-phone" className="block text-[13px] text-[#888] mb-2">
                      Telefone
                    </label>
                    <Input
                      id="checkout-phone"
                      name="phone"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      placeholder="(DDD) 99999-9999"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      className="h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px]"
                    />
                  </div>
                </div>

                {/* Security microcopy */}
                <p className="text-[12px] text-[#555] flex items-center gap-1.5 mt-1">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  Seus dados são seguros e usados apenas para processar seu pedido.
                </p>
              </div>

            </div>

            {/* Mobile Coupon - minimal */}
            <div className="lg:hidden bg-[#111] rounded-lg border border-[#1f1f1f] p-4">
              <div className="flex gap-2">
                <Input
                  id="mobile-coupon-code"
                  name="mobile-coupon"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Código do cupom"
                  disabled={!!appliedCoupon}
                  className="h-10 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#555] rounded-lg text-[13px] flex-1"
                />
                {appliedCoupon ? (
                  <Button
                    variant="outline"
                    onClick={removeCoupon}
                    className="h-10 border-[#333] text-[#888] hover:bg-[#1a1a1a] rounded-lg px-4 text-[13px]"
                  >
                    Remover
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={handleApplyCoupon}
                    disabled={applyingCoupon || !couponCode.trim()}
                    className="h-10 border-[#333] text-[#aaa] hover:bg-[#1a1a1a] rounded-lg px-4 text-[13px]"
                  >
                    {applyingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
                  </Button>
                )}
              </div>
              {appliedCoupon && (
                <p className="text-green-500 text-[12px] mt-2">
                  Cupom {appliedCoupon.code} aplicado! -R$ {discount.toFixed(2).replace('.', ',')}
                </p>
              )}
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <OrderSummary
            items={items}
            totalPrice={totalPrice}
            finalPrice={finalPrice}
            discount={discount}
            appliedCoupon={appliedCoupon}
            couponCode={couponCode}
            onCouponChange={setCouponCode}
            onApplyCoupon={handleApplyCoupon}
            onRemoveCoupon={removeCoupon}
            onRemoveItem={removeItem}
            onUpdateQuantity={updateQuantity}
            applyingCoupon={applyingCoupon}
            loading={loading}
            isFormValid={isFormValid}
            onSubmit={handleSubmit}
            paymentMethod={paymentMethod}
          />
        </div>
      </main>
    </div>
  );
}
