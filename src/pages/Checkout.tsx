import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";

import { Loader2 } from "lucide-react";
const PixPayment = lazy(() => import("@/components/checkout/PixPayment").then(m => ({ default: m.PixPayment })));
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { MobileStickyCheckout } from "@/components/checkout/MobileStickyCheckout";
import { PaymentMethodSelector } from "@/components/checkout/PaymentMethodSelector";
import { PersonalInfoForm, formatCPF, isValidCPF, isValidEmail, getEmailTLDError, formatPhone, isValidPhone } from "@/components/checkout/PersonalInfoForm";
import { invokeFunction } from "@/lib/apiHelper";
import { trackInitiateCheckoutEvent } from "@/lib/analytics";
import { sendInitiateCheckout } from "@/lib/metaCapi";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

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
  const { items, totalPrice, finalPrice, clearCart, removeItem, updateQuantity } = useCart();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "card">("pix");
  const [formData, setFormData] = useState<FormData>(() => {
    try {
      const saved = sessionStorage.getItem('valnix_checkout_form');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { name: "", document: "", email: "", phone: "" };
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const guestId = useMemo(() => {
    const stored = sessionStorage.getItem('valnix_guest_id');
    if (stored) return stored;
    const id = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('valnix_guest_id', id);
    return id;
  }, []);

  const utmParams = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('valnix_utm_params');
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch {}
    return {} as Record<string, string>;
  }, []);

  const effectiveUserId = guestId || 'guest';

  // Preload PixPayment chunk as soon as checkout mounts (before user submits)
  useEffect(() => {
    const timer = setTimeout(() => import("@/components/checkout/PixPayment"), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (items.length === 0 && !paymentData) {
      navigate("/");
    }
  }, [items.length, paymentData, navigate]);

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
    phone: isValidPhone(formData.phone),
    phoneError: (() => {
      const digits = formData.phone.replace(/\D/g, '');
      if (digits.length === 0) return 'Telefone é obrigatório';
      if (digits.length < 10) return 'Telefone incompleto';
      return undefined;
    })(),
  }), [formData]);

  // ── InitiateCheckout: fires ONCE after name AND email are both validated ──
  // This ensures maximum PII coverage (email, first_name, last_name always present).
  const icFiredRef = useRef(false);
  useEffect(() => {
    if (icFiredRef.current) return;
    if (items.length === 0) return;

    let alreadyFired = false;
    try { alreadyFired = sessionStorage.getItem('valnix_ic_fired') === '1'; } catch {}
    if (alreadyFired) { icFiredRef.current = true; return; }

    // Wait until name AND email are BOTH valid — maximizes match quality
    if (!validation.name || !validation.email) return;

    const hasPhone = formData.phone.replace(/\D/g, '').length >= 10;

    icFiredRef.current = true;
    try { sessionStorage.setItem('valnix_ic_fired', '1'); } catch {}

    trackInitiateCheckoutEvent(effectiveUserId, finalPrice);
    sendInitiateCheckout({
      userId: effectiveUserId,
      userEmail: formData.email.trim(),
      userPhone: hasPhone ? formData.phone : undefined,
      userName: formData.name.trim(),
      value: finalPrice,
      productNames: items.map(i => i.name),
      productIds: items.map(i => i.id),
      quantities: items.map(i => i.quantity),
      prices: items.map(i => i.price),
    });
  }, [items, finalPrice, effectiveUserId, validation.name, validation.email, formData.phone, formData.email, formData.name]);

  useEffect(() => {
    if (items.length === 0) {
      try { sessionStorage.removeItem('valnix_ic_fired'); } catch {}
      icFiredRef.current = false;
    }
  }, [items.length]);

  const isFormValid = validation.name && validation.document && validation.email && validation.phone;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleInputChange = useCallback((field: keyof FormData, value: string) => {
    let formattedValue = value;
    if (field === 'document') {
      formattedValue = formatCPF(value);
    } else if (field === 'phone') {
      formattedValue = formatPhone(value);
    }
    setFormData(prev => {
      const updated = { ...prev, [field]: formattedValue };
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try { sessionStorage.setItem('valnix_checkout_form', JSON.stringify(updated)); } catch {}
      }, 500);
      return updated;
    });
  }, []);

  const handleBlur = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmittingRef.current || loading) return;
    isSubmittingRef.current = true;
    
    setTouched({ name: true, document: true, email: true, phone: true });
    
    if (!isFormValid) {
      const errors: string[] = [];
      if (!validation.name) errors.push(validation.nameError || 'Nome inválido');
      if (!validation.email) errors.push(validation.emailError || 'E-mail inválido');
      if (!validation.document) errors.push(validation.documentError || 'CPF inválido');
      if (!validation.phone) errors.push(validation.phoneError || 'Telefone inválido');
      
      toast({
        title: "Verifique os campos",
        description: errors[0] || "Preencha todos os campos corretamente.",
        variant: "destructive",
      });
      isSubmittingRef.current = false;
      return;
    }
    
    setLoading(true);
    
    try {
      const orderAmount = finalPrice;
      
      if (orderAmount < 1) {
        toast({ title: "Valor insuficiente", description: "O valor mínimo para finalizar um pedido é R$ 1,00", variant: "destructive" });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      // ─── CARD PAYMENT ────────────────────────────────────────────────
      if (paymentMethod === "card") {
        const cpfDigits = formData.document.replace(/\D/g, '');
        const cardToken = null;
        const orderItemsData = items.map(item => ({
          product_id: item.id, product_name: item.name, product_image: item.image,
          quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity,
          delivery_type: item.delivery_type || 'manual',
        }));

        const { orderId, guestHash: _cardHash } = await createOrderServerSide({
          user_id: effectiveUserId,
          customer_name: formData.name,
          customer_email: formData.email || "",
          customer_phone: formData.phone || "",
          total_amount: orderAmount,
          notes: "Cartão",
          payment_method: "card",
          fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
          event_source_url: window.location.href,
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
              name: formData.name, email: formData.email || undefined,
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
          customerName: formData.name, customerEmail: formData.email || "",
          customerPhone: formData.phone || "", userId: effectiveUserId,
          productNames: items.map(i => i.name),
          productIds: items.map(i => i.id),
          quantities: items.map(i => i.quantity),
          prices: items.map(i => i.price),
          amount: orderAmount,
          eventSourceUrl: window.location.href,
        }));

        try { sessionStorage.removeItem('valnix_ic_fired'); } catch {}
        clearCart();
        window.open(cardData.paymentUrl, '_blank');
        navigate(`/card-callback?order_id=${orderId}&payment_id=${cardData.paymentId}`);
        return;
      }

      // ─── PIX PAYMENT ─────────────────────────────────────────────────
      const cpfDigits = formData.document.replace(/\D/g, '');
      const firebaseIdToken = null;
      const orderItemsData = items.map(item => ({
        product_id: item.id, product_name: item.name, product_image: item.image,
        quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity,
        delivery_type: item.delivery_type || 'manual',
      }));

      const { orderId, guestHash: pixGuestHash } = await createOrderServerSide({
        user_id: effectiveUserId,
        customer_name: formData.name,
        customer_email: formData.email || "",
        customer_phone: formData.phone || "",
        total_amount: orderAmount,
        notes: null,
        payment_method: "pix",
        fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
        event_source_url: window.location.href,
        utm_source: utmParams.utm_source || null, utm_medium: utmParams.utm_medium || null,
        utm_campaign: utmParams.utm_campaign || null, utm_content: utmParams.utm_content || null,
        utm_term: utmParams.utm_term || null,
      }, orderItemsData, firebaseIdToken);

      const pixResponse = await invokeFunction('flowpay-pix', {
        method: 'POST',
        queryParams: { action: 'create' },
        headers: {},
        body: {
          amount: Math.round(orderAmount * 100), orderId,
          description: `Pedido ${orderId.substring(0, 8)}`,
          customer: {
            name: formData.name, email: formData.email || undefined,
            phone: formData.phone || undefined, taxId: cpfDigits,
          },
        },
      });

      const contentType = pixResponse.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const textResponse = await pixResponse.text();
        if (import.meta.env.DEV) console.error('Gateway returned non-JSON:', textResponse.substring(0, 200));
        throw new Error('Erro no gateway de pagamento. Tente novamente.');
      }

      let pixData;
      try { pixData = await pixResponse.json(); } catch (parseError) {
        if (import.meta.env.DEV) console.error('Failed to parse PIX response:', parseError);
        throw new Error('Resposta inválida do gateway. Tente novamente.');
      }

      if (!pixResponse.ok || !pixData.success) {
        throw new Error(pixData.error || 'Erro ao gerar cobrança PIX');
      }

      startTransition(() => {
        setPaymentData({
          qrCodeText: pixData.brCode, transactionId: pixData.chargeId,
          amount: orderAmount, orderId, guestHash: pixGuestHash,
        });
      });

    } catch (error: unknown) {
      if (import.meta.env.DEV) console.error("❌ Checkout error:", error);
      const errorMessage = error instanceof Error ? error.message : "Tente novamente mais tarde.";
      toast({ title: "Erro ao criar pedido", description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  }, [loading, isFormValid, formData, items, finalPrice, toast, paymentMethod, clearCart, navigate, effectiveUserId]);

  // ─── PIX PAYMENT SCREEN ────────────────────────────────────────────────
  if (paymentData) {
    return (
      <div className="min-h-screen bg-background">
        <div className="hidden sm:block">
          <CheckoutHeader currentStep={2} />
        </div>
        <main className="max-w-xl mx-auto px-4 py-8">
          <div className="bg-secondary/50 rounded-2xl border border-border/10 p-6">
            <Suspense fallback={
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            }>
              <PixPayment
                qrCodeText={paymentData.qrCodeText}
                transactionId={paymentData.transactionId}
                amount={paymentData.amount}
                orderId={paymentData.orderId}
                guestHash={paymentData.guestHash || undefined}
                customerEmail={formData.email || undefined}
                customerName={formData.name || undefined}
                customerPhone={formData.phone || undefined}
                customerId={effectiveUserId}
                productNames={items.map(item => item.name)}
                productIds={items.map(item => item.id)}
                quantities={items.map(item => item.quantity)}
                prices={items.map(item => item.price)}
                onPaymentConfirmed={clearCart}
              />
            </Suspense>
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

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-6 lg:py-10 pb-40 lg:pb-10">
        <MobileStickyCheckout
          items={items}
          finalPrice={finalPrice}
          loading={loading}
          paymentMethod={paymentMethod}
          onSubmit={handleSubmit}
          onRemoveItem={removeItem}
          onUpdateQuantity={updateQuantity}
        />

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column */}
          <div className="flex-1 space-y-3 sm:space-y-5 mx-auto w-full max-w-lg lg:max-w-none">
            <PaymentMethodSelector
              paymentMethod={paymentMethod}
              onMethodChange={setPaymentMethod}
              finalPrice={finalPrice}
            />

            <PersonalInfoForm
              formData={formData}
              touched={touched}
              onInputChange={handleInputChange}
              onBlur={handleBlur}
            />
          </div>

          {/* Right Column - Sidebar */}
          <OrderSummary
            items={items}
            totalPrice={totalPrice}
            finalPrice={finalPrice}
            onRemoveItem={removeItem}
            onUpdateQuantity={updateQuantity}
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
