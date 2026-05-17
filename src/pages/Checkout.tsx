import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";

import { Loader2 } from "lucide-react";
import { PixPayment } from "@/components/checkout/PixPayment";
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { MobileStickyCheckout } from "@/components/checkout/MobileStickyCheckout";

import { PersonalInfoForm, formatCPF, isValidCPF, isValidEmail, getEmailTLDError, formatPhone, isValidPhone } from "@/components/checkout/PersonalInfoForm";
import { invokeFunction } from "@/lib/apiHelper";

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

function extractPixExpirationSeconds(data: Record<string, unknown>): number | undefined {
  const keys = ["expiresIn", "expirationInSeconds", "expires_in", "expirationSeconds", "ttlSeconds", "expires_in_seconds"] as const;
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 60) {
      return Math.min(Math.floor(v), 24 * 60 * 60);
    }
  }
  return undefined;
}

/** Gateway responses vary; accept common aliases for EMV / copia-e-cola. */
function extractPixBrCode(data: Record<string, unknown>): string | undefined {
  const keys = ["brCode", "qrCode", "pix_code", "emvqrcps", "copyPaste", "copy_paste", "payload"] as const;
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length >= 15) return v.trim();
  }
  return undefined;
}

function extractPixChargeId(data: Record<string, unknown>): string | undefined {
  for (const key of ["chargeId", "id", "transactionId", "charge_id", "txId"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

interface PaymentData {
  qrCodeText: string;
  transactionId: string;
  amount: number;
  orderId: string;
  guestHash?: string | null;
  /** Segundos até expirar o PIX (gateway); UI usa fallback se ausente */
  pixExpiresInSeconds?: number;
}

export default function Checkout() {
  const { items, totalPrice, finalPrice, clearCart, removeItem, updateQuantity } = useCart();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<"idle" | "creating" | "generating">("idle");
  const isSubmittingRef = useRef(false);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const paymentMethod = "pix";
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
    // Fallback: localStorage (persists across tab closes / in-app browser switches)
    try {
      const stored = localStorage.getItem('valnix_utm_params');
      if (stored) return JSON.parse(stored) as Record<string, string>;
    } catch {}
    return {} as Record<string, string>;
  }, []);

  const effectiveUserId = guestId || 'guest';

  // PixPayment is now eagerly imported — no preload needed

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

    const phoneDigits = formData.phone.replace(/\D/g, '');
    const nationalDigits =
      phoneDigits.startsWith("55") && phoneDigits.length > 11 ? phoneDigits.slice(2) : phoneDigits;
    const hasPhone = nationalDigits.length >= 10;
    const phoneE164 = hasPhone ? `55${nationalDigits}` : undefined;

    icFiredRef.current = true;
    try { sessionStorage.setItem('valnix_ic_fired', '1'); } catch {}

    import("@/lib/analytics").then(({ trackInitiateCheckoutEvent }) => {
      trackInitiateCheckoutEvent(effectiveUserId, finalPrice);
    }).catch(() => {});

    import("@/lib/metaCapi").then(({ sendInitiateCheckout }) => {
      sendInitiateCheckout({
        userId: effectiveUserId,
        userEmail: formData.email.trim(),
        userPhone: phoneE164,
        userName: formData.name.trim(),
        value: finalPrice,
        productNames: items.map(i => i.name),
        productIds: items.map(i => i.id),
        quantities: items.map(i => i.quantity),
        prices: items.map(i => i.price),
      });
    }).catch(() => {});
  }, [items, finalPrice, effectiveUserId, validation.name, validation.email, formData.phone, formData.email, formData.name]);

  useEffect(() => {
    if (items.length === 0) {
      try { sessionStorage.removeItem('valnix_ic_fired'); } catch {}
      icFiredRef.current = false;
    }
  }, [items.length]);

  const isFormValid = validation.name && validation.document && validation.email && validation.phone;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    
    // Show loading state IMMEDIATELY — yield to browser to paint before heavy work
    setLoading(true);
    setLoadingStage("creating");
    await new Promise(r => setTimeout(r, 0));
    
    try {
      const orderAmount = finalPrice;
      
      if (orderAmount < 1) {
        toast({ title: "Valor insuficiente", description: "O valor mínimo para finalizar um pedido é R$ 1,00", variant: "destructive" });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      // ─── PIX PAYMENT ─────────────────────────────────────────────────
      setLoadingStage("creating");
      const cpfDigits = formData.document.replace(/\D/g, '');
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
        customer_document: cpfDigits,
        total_amount: orderAmount,
        notes: null,
        payment_method: "pix",
        fbc: getCookie('_fbc'), fbp: getCookie('_fbp'),
        event_source_url: window.location.href,
        utm_source: utmParams.utm_source || null, utm_medium: utmParams.utm_medium || null,
        utm_campaign: utmParams.utm_campaign || null, utm_content: utmParams.utm_content || null,
        utm_term: utmParams.utm_term || null,
      }, orderItemsData, null);

      setLoadingStage("generating");
      const pixResponse = await invokeFunction('dice-pix', {
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
        const rawError = pixData.error || '';
        const isGatewayError = rawError.includes('ADQUIRENTES_FAILURE') || rawError.includes('LOTTOPAY') || rawError.includes('Gateway') || pixResponse.status >= 500;
        throw new Error(isGatewayError 
          ? 'O gateway de pagamento está temporariamente indisponível. Tente novamente em alguns segundos.' 
          : rawError || 'Erro ao gerar cobrança PIX');
      }

      const raw = pixData as Record<string, unknown>;
      const brCode = extractPixBrCode(raw);
      const chargeId = extractPixChargeId(raw);
      if (!brCode || !chargeId) {
        throw new Error("Resposta do gateway incompleta (código PIX ou ID da cobrança). Tente novamente.");
      }

      startTransition(() => {
        setPaymentData({
          qrCodeText: brCode,
          transactionId: chargeId,
          amount: orderAmount,
          orderId,
          guestHash: pixGuestHash,
          pixExpiresInSeconds: extractPixExpirationSeconds(raw),
        });
      });

    } catch (error: unknown) {
      if (import.meta.env.DEV) console.error("❌ Checkout error:", error);
      const errorMessage = error instanceof Error ? error.message : "Tente novamente mais tarde.";
      toast({ title: "Erro ao criar pedido", description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingStage("idle");
      isSubmittingRef.current = false;
    }
  }, [loading, isFormValid, validation, formData, items, finalPrice, toast, effectiveUserId, utmParams]);

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
                pixExpiresInSeconds={paymentData.pixExpiresInSeconds}
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
          </div>
        </main>
      </div>
    );
  }

  // ─── CHECKOUT FORM ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Finalizar compra — VALNIX</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="hidden sm:block">
        <CheckoutHeader currentStep={1} />
      </div>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-6 lg:py-10 pb-40 lg:pb-10">
        <MobileStickyCheckout
          items={items}
          finalPrice={finalPrice}
          loading={loading}
          loadingStage={loadingStage}
          paymentMethod={paymentMethod}
          isFormValid={isFormValid}
          onSubmit={handleSubmit}
          onRemoveItem={removeItem}
          onUpdateQuantity={updateQuantity}
        />

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column */}
          <div className="flex-1 space-y-3 sm:space-y-5 mx-auto w-full max-w-lg lg:max-w-none">


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
