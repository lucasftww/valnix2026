import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCart, CartItem } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/firebase/config";
import { doc, getDoc, updateDoc, increment, collection, getDocs, query, where } from "firebase/firestore";

import { Loader2 } from "lucide-react";
import { PixPayment } from "@/components/checkout/PixPayment";
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { MobileStickyCheckout } from "@/components/checkout/MobileStickyCheckout";
import { PaymentMethodSelector } from "@/components/checkout/PaymentMethodSelector";
import { PersonalInfoForm, formatCPF, isValidCPF, isValidEmail, getEmailTLDError } from "@/components/checkout/PersonalInfoForm";
import { MobileCoupon } from "@/components/checkout/MobileCoupon";
import { invokeFunction, invokeFunctionFireAndForget } from "@/lib/apiHelper";
import { trackInitiateCheckoutEvent, trackPurchaseEvent } from "@/lib/analytics";
import { sendInitiateCheckout, sendPurchaseFromClient, clearCheckoutSessionId } from "@/lib/metaCapi";

// Read Facebook cookies for CAPI match quality
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Helper: create order + items via server-side edge function
async function createOrderServerSide(
  orderData: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  authToken?: string | null,
): Promise<{ orderId: string; guestHash: string | null }> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  
  const response = await invokeFunction('create-order', {
    method: 'POST',
    headers,
    body: { order: orderData, items },
  });
  
  const result = await response.json();
  if (!response.ok || !result.success || !result.orderId) {
    throw new Error(result.error || 'Erro ao criar pedido');
  }
  return { orderId: result.orderId as string, guestHash: result.guestHash as string | null };
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
  guestHash?: string | null;
}

export default function Checkout() {
  const { items, totalPrice, finalPrice, discount, appliedCoupon, clearCart, applyCoupon, removeCoupon, removeItem, updateQuantity } = useCart();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
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

  // Read UTM params from sessionStorage
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

  // Track InitiateCheckout once when items are ready (not blind mount)
  // NO form PII here — user hasn't typed yet. Only auth-known data.
  const initiateCheckoutFiredRef = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !initiateCheckoutFiredRef.current) {
      initiateCheckoutFiredRef.current = true;
      trackInitiateCheckoutEvent(effectiveUserId, finalPrice);
      sendInitiateCheckout({
        userId: effectiveUserId,
        userEmail: user?.email || undefined,
        value: finalPrice,
        productNames: items.map(i => i.name),
        productIds: items.map(i => i.id),
        quantities: items.map(i => i.quantity),
        prices: items.map(i => i.price),
      });
    }
  }, [items.length, finalPrice, effectiveUserId, user?.email]); // deps: wait for items + auth hydration

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

  // Save checkout data to user profile
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

  const validation = useMemo(() => ({
    name: formData.name.trim().length >= 3 && formData.name.trim().split(' ').length >= 2,
    nameError: formData.name.trim().length < 3 ? 'Nome deve ter pelo menos 3 caracteres' : formData.name.trim().split(' ').length < 2 ? 'Digite nome e sobrenome' : undefined,
    document: isValidCPF(formData.document),
    documentError: formData.document.replace(/\D/g, '').length === 11 && !isValidCPF(formData.document) ? 'CPF inválido' : formData.document.replace(/\D/g, '').length < 11 ? 'CPF incompleto' : undefined,
    email: isValidEmail(formData.email) && !getEmailTLDError(formData.email),
    emailError: (() => {
      if (formData.email.trim().length === 0) return 'E-mail é obrigatório';
      if (!isValidEmail(formData.email)) return 'E-mail inválido';
      const tldErr = getEmailTLDError(formData.email);
      if (tldErr) return tldErr;
      return undefined;
    })(),
  }), [formData]);

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

  // ─── SUBMIT HANDLER ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
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

    // InitiateCheckout already fired on mount — no duplicate here
    
    try {
      const orderAmount = finalPrice;
      
      if (orderAmount < 1) {
        toast({ title: "Valor insuficiente", description: "O valor mínimo para finalizar um pedido é R$ 1,00", variant: "destructive" });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      // ─── BALANCE PAYMENT ─────────────────────────────────────────────
      if (paymentMethod === "balance") {
        if (userBalance < orderAmount) {
          toast({ title: "Saldo insuficiente", description: `Seu saldo (R$ ${userBalance.toFixed(2)}) é menor que o valor do pedido.`, variant: "destructive" });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const balanceToken = user ? await user.getIdToken() : null;
        const orderItemsData = items.map(item => ({
          product_id: item.id, product_name: item.name, product_image: item.image,
          quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity,
          delivery_type: item.delivery_type || 'manual',
        }));

        const { orderId, guestHash } = await createOrderServerSide({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || user?.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)}) | Saldo` : "Saldo",
          payment_method: "balance",
          coupon_id: appliedCoupon?.id || null,
          coupon_code: appliedCoupon?.code || null,
          fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
          utm_source: utmParams.utm_source || null, utm_medium: utmParams.utm_medium || null,
          utm_campaign: utmParams.utm_campaign || null, utm_content: utmParams.utm_content || null,
          utm_term: utmParams.utm_term || null,
        }, orderItemsData, balanceToken);

        const idToken = user ? await user.getIdToken() : null;
        if (!idToken) {
          toast({ title: "Erro de autenticação", description: "Faça login novamente para pagar com saldo.", variant: "destructive" });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const balanceRes = await invokeFunction('checkout-balance', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}` },
          body: { orderId },
        });
        const balanceResult = await balanceRes.json();

        if (!balanceRes.ok || !balanceResult.success) {
          toast({ title: "Erro no pagamento", description: balanceResult.error || "Falha ao processar pagamento com saldo.", variant: "destructive" });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        setUserBalance(balanceResult.remainingBalance ?? 0);

        // Send Purchase to Meta CAPI (balance payments)
        sendPurchaseFromClient({
          orderId,
          value: orderAmount,
          userId: effectiveUserId,
          email: formData.email || user?.email || undefined,
          name: formData.name,
          productNames: items.map(i => i.name),
          productIds: items.map(i => i.id),
          quantities: items.map(i => i.quantity),
          prices: items.map(i => i.price),
        });

        saveCheckoutDataToProfile();
        clearCart();

        if (guestHash) {
          navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${guestHash}`);
        } else {
          navigate(`/entrega-prioritaria?order_id=${orderId}`);
        }
        return;
      }

      // ─── CARD PAYMENT ────────────────────────────────────────────────
      if (paymentMethod === "card") {
        const cpfDigits = formData.document.replace(/\D/g, '');
        const cardToken = user ? await user.getIdToken() : null;
        const orderItemsData = items.map(item => ({
          product_id: item.id, product_name: item.name, product_image: item.image,
          quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity,
          delivery_type: item.delivery_type || 'manual',
        }));

        const { orderId, guestHash: _cardHash } = await createOrderServerSide({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || user?.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)}) | Cartão` : "Cartão",
          payment_method: "card",
          coupon_id: appliedCoupon?.id || null,
          coupon_code: appliedCoupon?.code || null,
          fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
          utm_source: utmParams.utm_source || null, utm_medium: utmParams.utm_medium || null,
          utm_campaign: utmParams.utm_campaign || null, utm_content: utmParams.utm_content || null,
          utm_term: utmParams.utm_term || null,
        }, orderItemsData, cardToken);

        const cardResponse = await invokeFunction('flowpay-card', {
          method: 'POST',
          queryParams: { action: 'create' },
          body: {
            amount: Math.round(orderAmount * 100), orderId,
            description: `Pedido ${orderId.substring(0, 8)}`,
            customer: {
              name: formData.name, email: formData.email || user?.email || undefined,
              phone: formData.phone || undefined, taxId: cpfDigits,
            },
          },
        });
        const cardData = await cardResponse.json();
        if (!cardResponse.ok || !cardData.success) {
          throw new Error(cardData.error || 'Erro ao criar cobrança de cartão');
        }

        const deliveryToken = cardData.deliveryToken || null;
        sessionStorage.setItem('valnix_card_payment', JSON.stringify({
          orderId, paymentId: cardData.paymentId, deliveryToken, guestHash: _cardHash,
          customerName: formData.name, customerEmail: formData.email || user?.email || "",
          customerPhone: formData.phone || "", userId: effectiveUserId,
          productNames: items.map(i => i.name),
          productIds: items.map(i => i.id),
          quantities: items.map(i => i.quantity),
          prices: items.map(i => i.price),
          amount: orderAmount,
        }));

        saveCheckoutDataToProfile();
        clearCart();
        window.open(cardData.paymentUrl, '_blank');
        navigate(`/card-callback?order_id=${orderId}&payment_id=${cardData.paymentId}`);
        return;
      }

      // ─── PIX PAYMENT ─────────────────────────────────────────────────
      const cpfDigits = formData.document.replace(/\D/g, '');
      const firebaseIdToken = user ? await user.getIdToken() : null;
      const orderItemsData = items.map(item => ({
        product_id: item.id, product_name: item.name, product_image: item.image,
        quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity,
        delivery_type: item.delivery_type || 'manual',
      }));

      const { orderId, guestHash: pixGuestHash } = await createOrderServerSide({
        user_id: effectiveUserId,
        customer_name: formData.name,
        customer_email: formData.email || user?.email || "",
        customer_phone: formData.phone || "",
        total_amount: orderAmount,
        notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)})` : null,
        payment_method: "pix",
        coupon_id: appliedCoupon?.id || null,
        coupon_code: appliedCoupon?.code || null,
        fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
        utm_source: utmParams.utm_source || null, utm_medium: utmParams.utm_medium || null,
        utm_campaign: utmParams.utm_campaign || null, utm_content: utmParams.utm_content || null,
        utm_term: utmParams.utm_term || null,
      }, orderItemsData, firebaseIdToken);

      const pixResponse = await invokeFunction('flowpay-pix', {
        method: 'POST',
        queryParams: { action: 'create' },
        headers: firebaseIdToken ? { 'Authorization': `Bearer ${firebaseIdToken}` } : {},
        body: {
          amount: Math.round(orderAmount * 100), orderId,
          description: `Pedido ${orderId.substring(0, 8)}`,
          customer: {
            name: formData.name, email: formData.email || user?.email || undefined,
            phone: formData.phone || undefined, taxId: cpfDigits,
          },
        },
      });

      const contentType = pixResponse.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const textResponse = await pixResponse.text();
        console.error('Gateway returned non-JSON:', textResponse.substring(0, 200));
        throw new Error('Erro no gateway de pagamento. Tente novamente.');
      }

      let pixData;
      try { pixData = await pixResponse.json(); } catch (parseError) {
        console.error('Failed to parse PIX response:', parseError);
        throw new Error('Resposta inválida do gateway. Tente novamente.');
      }

      if (!pixResponse.ok || !pixData.success) {
        throw new Error(pixData.error || 'Erro ao gerar cobrança PIX');
      }

      saveCheckoutDataToProfile();
      setPaymentData({
        qrCodeText: pixData.brCode, transactionId: pixData.chargeId,
        amount: orderAmount, orderId, guestHash: pixGuestHash,
      });

    } catch (error: unknown) {
      console.error("❌ Checkout error:", error);
      const errorMessage = error instanceof Error ? error.message : "Tente novamente mais tarde.";
      toast({ title: "Erro ao criar pedido", description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  }, [loading, isFormValid, formData, items, finalPrice, discount, appliedCoupon, toast, paymentMethod, userBalance, clearCart, navigate, user, effectiveUserId]);

  // ─── PIX PAYMENT SCREEN ────────────────────────────────────────────────
  if (paymentData) {
    return (
      <div className="min-h-screen bg-background">
        <div className="hidden sm:block">
          <CheckoutHeader currentStep={2} />
        </div>
        <main className="max-w-xl mx-auto px-4 py-8">
          <div className="bg-secondary/50 rounded-2xl border border-border/10 p-6">
            <PixPayment
              qrCodeText={paymentData.qrCodeText}
              transactionId={paymentData.transactionId}
              amount={paymentData.amount}
              orderId={paymentData.orderId}
              guestHash={paymentData.guestHash || undefined}
              customerEmail={formData.email || user?.email || undefined}
              customerName={formData.name || undefined}
              customerId={effectiveUserId}
              productNames={items.map(item => item.name)}
              productIds={items.map(item => item.id)}
              quantities={items.map(item => item.quantity)}
              prices={items.map(item => item.price)}
              couponId={appliedCoupon?.id || undefined}
              onPaymentConfirmed={clearCart}
            />
          </div>
        </main>
      </div>
    );
  }

  // ─── CHECKOUT FORM ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="hidden sm:block">
        <CheckoutHeader currentStep={1} />
      </div>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 lg:py-10 pb-36 lg:pb-10">
        <MobileStickyCheckout
          items={items}
          finalPrice={finalPrice}
          loading={loading}
          paymentMethod={paymentMethod}
          onSubmit={handleSubmit}
          onRemoveItem={removeItem}
        />

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column */}
          <div className="flex-1 space-y-3 sm:space-y-5 mx-auto w-full max-w-lg lg:max-w-none">
            <PaymentMethodSelector
              paymentMethod={paymentMethod}
              onMethodChange={setPaymentMethod}
              userBalance={userBalance}
              finalPrice={finalPrice}
            />

            <PersonalInfoForm
              formData={formData}
              touched={touched}
              onInputChange={handleInputChange}
              onBlur={handleBlur}
            />

            <MobileCoupon
              couponCode={couponCode}
              onCouponChange={setCouponCode}
              onApplyCoupon={handleApplyCoupon}
              onRemoveCoupon={removeCoupon}
              appliedCoupon={appliedCoupon}
              applyingCoupon={applyingCoupon}
              discount={discount}
            />
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
