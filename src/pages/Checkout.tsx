import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { createOrder, createOrderItems } from "@/hooks/firebase";
import { Loader2, Zap, Lock, Check, AlertCircle, Wallet } from "lucide-react";
import { PixPayment } from "@/components/checkout/PixPayment";
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import pixLogo from "@/assets/pix-logo.png";
import { trackPurchase } from "@/lib/utmify";
import { supabase } from "@/integrations/supabase/client";


interface FormData {
  name: string;
  document: string;
  phone: string;
  cep: string;
  birthDate: string;
  estado: string;
  cidade: string;
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

// Phone mask helper
const formatPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

// CEP mask helper
const formatCEP = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

// Birth date mask helper (DD/MM/AAAA)
const formatBirthDate = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

// Full CPF validation with check digits (algoritmo oficial)
const isValidCPF = (cpf: string): boolean => {
  const digits = cpf.replace(/\D/g, '');
  
  // Must have 11 digits
  if (digits.length !== 11) return false;
  
  // Reject known invalid patterns (all same digit)
  if (/^(\d)\1{10}$/.test(digits)) return false;
  
  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;
  
  // Validate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;
  
  return true;
};

// Validate phone has 10-11 digits and valid DDD
const isValidPhone = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) return false;
  
  // Valid Brazilian DDDs
  const validDDDs = [
    '11','12','13','14','15','16','17','18','19', // SP
    '21','22','24', // RJ
    '27','28', // ES
    '31','32','33','34','35','37','38', // MG
    '41','42','43','44','45','46', // PR
    '47','48','49', // SC
    '51','53','54','55', // RS
    '61', // DF
    '62','64', // GO
    '63', // TO
    '65','66', // MT
    '67', // MS
    '68', // AC
    '69', // RO
    '71','73','74','75','77', // BA
    '79', // SE
    '81','87', // PE
    '82', // AL
    '83', // PB
    '84', // RN
    '85','88', // CE
    '86','89', // PI
    '91','93','94', // PA
    '92','97', // AM
    '95', // RR
    '96', // AP
    '98','99', // MA
  ];
  
  const ddd = digits.substring(0, 2);
  return validDDDs.includes(ddd);
};

// Validate birth date is valid and person is 13+ years old
const isValidBirthDate = (dateStr: string): { valid: boolean; error?: string } => {
  const digits = dateStr.replace(/\D/g, '');
  if (digits.length !== 8) return { valid: false, error: 'Data incompleta' };
  
  const day = parseInt(digits.slice(0, 2));
  const month = parseInt(digits.slice(2, 4));
  const year = parseInt(digits.slice(4, 8));
  
  // Basic validation
  if (month < 1 || month > 12) return { valid: false, error: 'Mês inválido' };
  if (day < 1 || day > 31) return { valid: false, error: 'Dia inválido' };
  
  // Check valid day for month
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return { valid: false, error: 'Data inválida' };
  
  // Check year range (between 1920 and current year)
  const currentYear = new Date().getFullYear();
  if (year < 1920 || year > currentYear) return { valid: false, error: 'Ano inválido' };
  
  // Check if person is at least 13 years old
  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  if (age < 13) return { valid: false, error: 'Idade mínima: 13 anos' };
  if (age > 120) return { valid: false, error: 'Data inválida' };
  
  return { valid: true };
};

export default function Checkout() {
  const { items, totalPrice, finalPrice, discount, appliedCoupon, clearCart, applyCoupon, removeCoupon, removeItem, updateQuantity } = useCart();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "balance">("pix");
  const [formData, setFormData] = useState<FormData>({
    name: "",
    document: "",
    phone: "",
    cep: "",
    birthDate: "",
    estado: "",
    cidade: "",
  });
  const [loadingCep, setLoadingCep] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Auth check and redirect
  useEffect(() => {
    if (authLoading) return;
    setInitializing(false);
    
    if (!user) {
      navigate("/auth?redirect=/checkout");
      return;
    }
    
    // Redirect if cart is empty and not showing payment
    if (items.length === 0 && !paymentData) {
      navigate("/");
    }
  }, [user, authLoading, items.length, paymentData, navigate]);


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
          setFormData(prev => ({
            ...prev,
            name: user.displayName || profileData?.full_name || "",
            phone: profileData?.phone ? formatPhone(profileData.phone) : "",
          }));
          setUserBalance(profileData?.balance || 0);
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      }
    };
    
    loadProfile();
    
    return () => { mounted = false; };
  }, [user]);

  // Validate CEP (8 digits required)
  const isValidCEP = (cep: string): boolean => {
    const digits = cep.replace(/\D/g, '');
    return digits.length === 8;
  };

  // Form validation with detailed feedback
  const validation = useMemo(() => {
    const birthDateValidation = isValidBirthDate(formData.birthDate);
    const cepDigits = formData.cep.replace(/\D/g, '');
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
      phone: isValidPhone(formData.phone),
      phoneError: formData.phone.replace(/\D/g, '').length >= 10 && !isValidPhone(formData.phone)
        ? 'DDD inválido'
        : formData.phone.replace(/\D/g, '').length < 10
          ? 'Telefone incompleto'
          : undefined,
      cep: cepDigits.length === 8,
      cepError: cepDigits.length > 0 && cepDigits.length < 8
        ? 'CEP incompleto (8 dígitos)'
        : cepDigits.length === 0
          ? 'CEP obrigatório'
          : undefined,
      birthDate: birthDateValidation.valid,
      birthDateError: birthDateValidation.error,
    };
  }, [formData]);

  const isFormValid = validation.name && validation.document && validation.phone && validation.cep;

  // Cache de CEPs já consultados (persiste durante a sessão)
  const [cepCache] = useState<Map<string, { uf: string; localidade: string }>>(new Map());
  const cepLookupRef = React.useRef<string | null>(null);

  // CEP lookup function - otimizada com cache e prevenção de duplicatas
  const lookupCEP = useCallback(async (cep: string) => {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    
    // Previne chamadas duplicadas para o mesmo CEP
    if (cepLookupRef.current === digits) return;
    cepLookupRef.current = digits;
    
    // Verifica cache primeiro (instantâneo)
    const cached = cepCache.get(digits);
    if (cached) {
      setFormData(prev => ({
        ...prev,
        estado: cached.uf,
        cidade: cached.localidade,
      }));
      return;
    }
    
    setLoadingCep(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout de 5s
      
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (!data.erro && data.uf) {
        // Salva no cache
        cepCache.set(digits, { uf: data.uf, localidade: data.localidade || "" });
        
        setFormData(prev => ({
          ...prev,
          estado: data.uf || "",
          cidade: data.localidade || "",
        }));
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error("Error fetching CEP:", error);
      }
    } finally {
      setLoadingCep(false);
    }
  }, [cepCache]);

  const handleInputChange = useCallback((field: keyof FormData, value: string) => {
    let formattedValue = value;
    
    if (field === 'document') {
      formattedValue = formatCPF(value);
    } else if (field === 'phone') {
      formattedValue = formatPhone(value);
    } else if (field === 'cep') {
      formattedValue = formatCEP(value);
      // Limpa estado/cidade se CEP mudou (menos de 8 dígitos)
      const digits = value.replace(/\D/g, '');
      if (digits.length < 8) {
        setFormData(prev => ({ ...prev, cep: formattedValue, estado: "", cidade: "" }));
        cepLookupRef.current = null;
        return;
      }
      // Auto lookup quando CEP completo
      if (digits.length === 8) {
        lookupCEP(value);
      }
    } else if (field === 'birthDate') {
      formattedValue = formatBirthDate(value);
    }
    
    setFormData(prev => ({ ...prev, [field]: formattedValue }));
  }, [lookupCEP]);

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
    if (!user || loading) return;
    
    // Mark all fields as touched to show validation
    setTouched({ name: true, document: true, phone: true, cep: true, birthDate: true });
    
    if (!isFormValid) {
      // Build specific error message
      const errors: string[] = [];
      if (!validation.name) errors.push(validation.nameError || 'Nome inválido');
      if (!validation.document) errors.push(validation.documentError || 'CPF inválido');
      if (!validation.phone) errors.push(validation.phoneError || 'Telefone inválido');
      if (!validation.cep) errors.push(validation.cepError || 'CEP inválido');
      
      toast({
        title: "Verifique os campos",
        description: errors[0] || "Preencha todos os campos corretamente.",
        variant: "destructive",
      });
      
      // Focus first invalid field
      const firstInvalidField = !validation.name ? 'name' : !validation.document ? 'document' : !validation.phone ? 'phone' : 'cep';
      document.querySelector<HTMLInputElement>(`input[placeholder*="${
        firstInvalidField === 'name' ? 'NOME' : 
        firstInvalidField === 'document' ? '000.000' : 
        firstInvalidField === 'phone' ? '(00)' :
        '00000'
      }"]`)?.focus();
      
      return;
    }
    
    setLoading(true);
    
    try {
      const orderAmount = finalPrice;
      
      if (orderAmount < 1) {
        toast({
          title: "Valor insuficiente",
          description: "O valor mínimo para finalizar um pedido é R$ 1,00",
          variant: "destructive",
        });
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
          return;
        }

        // Create order with paid status
        const orderId = await createOrder({
          user_id: user.uid,
          customer_name: formData.name,
          customer_email: user.email || "",
          customer_phone: formData.phone,
          total_amount: orderAmount,
          notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)}) | Pago com saldo` : "Pago com saldo",
          status: "processing",
          payment_status: "paid",
          payment_method: "balance",
        });

        // Fetch product delivery info for auto-delivery processing
        const productIds = items.map(i => i.id);
        const productsDeliveryInfo: Record<string, { delivery_type: string; auto_delivery_codes: string[] | null }> = {};
        
        for (const productId of productIds) {
          try {
            const productRef = doc(db, "products", productId);
            const productSnap = await getDoc(productRef);
            if (productSnap.exists()) {
              const data = productSnap.data();
              productsDeliveryInfo[productId] = {
                delivery_type: data.delivery_type || 'manual',
                auto_delivery_codes: data.auto_delivery_codes || null,
              };
            }
          } catch (err) {
            console.error(`Error fetching product ${productId}:`, err);
          }
        }

        // Create order items with delivery info for auto-processing
        const orderItemsData = items.map(item => {
          const deliveryInfo = productsDeliveryInfo[item.id] || { delivery_type: 'manual', auto_delivery_codes: null };
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

        // Process with auto-delivery enabled since payment is already confirmed
        await createOrderItems(orderItemsData, true);

        // Deduct balance from user profile
        const profileRef = doc(db, "profiles", user.uid);
        await updateDoc(profileRef, {
          balance: increment(-orderAmount)
        });

        // Send Purchase event to UTMify (waits for SDK with fallback)
        await trackPurchase(orderId, orderAmount, user.email || undefined);

        // Register Purchase in analytics_events (Supabase)
        try {
          await supabase.from('analytics_events').insert({
            event_name: 'Purchase',
            event_time: new Date().toISOString(),
            user_id: user.uid,
            value: orderAmount,
            currency: 'BRL',
            order_id: orderId,
            page_url: window.location.href,
            content_name: items.map(i => i.name).join(', '),
          });
        } catch (e) {
          console.warn('⚠️ Analytics event failed:', e);
        }

        clearCart();

        toast({
          title: "Pagamento confirmado!",
          description: `Pedido #${orderId.substring(0, 8)} pago com saldo. R$ ${orderAmount.toFixed(2)} debitados.`,
        });

        navigate("/my-orders");
        return;
      }

      // PIX payment flow
      // Create order in Firebase
      const orderId = await createOrder({
        user_id: user.uid,
        customer_name: formData.name,
        customer_email: user.email || "",
        customer_phone: formData.phone,
        total_amount: orderAmount,
        notes: appliedCoupon ? `Cupom: ${appliedCoupon.code} (-R$ ${discount.toFixed(2)})` : null,
        status: "pending",
        payment_status: "pending",
      });

      // Create order items
      const orderItemsData = items.map(item => ({
        order_id: orderId,
        product_id: item.id,
        product_name: item.name,
        product_image: item.image,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
      }));

      await createOrderItems(orderItemsData);

      // FlowPay PIX payment
      const amountInCents = Math.round(orderAmount * 100);
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const cpfDigits = formData.document.replace(/\D/g, '');

      const pixResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            amount: amountInCents,
            orderId,
            description: `Pedido #${orderId.substring(0, 8)}`,
            customer: {
              name: formData.name,
              email: user.email || undefined,
              phone: phoneDigits,
              taxId: cpfDigits,
            },
          }),
        }
      );

      const pixData = await pixResponse.json();

      if (!pixResponse.ok || !pixData.success) {
        throw new Error(pixData.error || 'Erro ao gerar cobrança PIX');
      }

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
    }
  }, [user, loading, isFormValid, formData, items, finalPrice, discount, appliedCoupon, toast, paymentMethod, userBalance, clearCart, navigate]);

  // Loading state
  if (initializing || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d0d]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  // Payment screen
  if (paymentData) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] utmify-checkout">
        <CheckoutHeader currentStep={2} />

        <main className="max-w-xl mx-auto px-4 py-8">
          <div className="bg-[#111] rounded-lg border border-[#1f1f1f] p-6">
            <PixPayment
              qrCodeText={paymentData.qrCodeText}
              transactionId={paymentData.transactionId}
              amount={paymentData.amount}
              orderId={paymentData.orderId}
              customerEmail={user.email || undefined}
              customerName={formData.name || undefined}
              customerPhone={formData.phone || undefined}
              customerZipCode={formData.cep ? formData.cep.replace(/\D/g, '') : undefined}
              customerId={user.uid}
              productNames={items.map(item => item.name)}
              productIds={items.map(item => item.id)}
              onPaymentConfirmed={clearCart}
            />
          </div>
        </main>
      </div>
    );
  }

  // Helper for input styling with validation icons
  const getInputClassName = (field: 'name' | 'document' | 'phone' | 'birthDate', baseClass: string) => {
    if (!touched[field] && field !== 'birthDate') return baseClass;
    
    // For birthDate, check if it has enough characters
    if (field === 'birthDate') {
      if (formData.birthDate.replace(/\D/g, '').length < 8) return baseClass;
      return validation.birthDate 
        ? `${baseClass} border-green-500/50 pr-10` 
        : `${baseClass} border-red-500/50 pr-10`;
    }
    
    return validation[field] 
      ? `${baseClass} border-green-500/50 pr-10` 
      : `${baseClass} border-red-500/50 pr-10`;
  };
  
  // Validation icon component
  const ValidationIcon = ({ isValid, show }: { isValid: boolean; show: boolean }) => {
    if (!show) return null;
    return isValid ? (
      <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
    ) : (
      <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
    );
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] utmify-checkout">
      <CheckoutHeader currentStep={1} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:py-10">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column */}
          <div className="flex-1 space-y-5">
            {/* Payment Method Card */}
            <div className="bg-[#111] rounded-lg border border-[#1f1f1f] p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold text-white mb-5">Pagamento</h2>
              
              <RadioGroup 
                value={paymentMethod} 
                onValueChange={(value) => setPaymentMethod(value as "pix" | "balance")}
                className="space-y-3"
              >
                {/* PIX Option */}
                <div 
                  className={`relative flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    paymentMethod === "pix" 
                      ? "border-primary bg-primary/5" 
                      : "border-[#222] bg-[#0d0d0d] hover:border-[#333]"
                  }`}
                  onClick={() => setPaymentMethod("pix")}
                >
                  <RadioGroupItem value="pix" id="pix" className="shrink-0" />
                  <Label htmlFor="pix" className="flex items-center gap-3 cursor-pointer flex-1">
                    <img src={pixLogo} alt="PIX" className="w-8 h-8 object-contain" />
                    <div>
                      <p className="text-[14px] font-medium text-white">PIX</p>
                      <p className="text-[12px] text-[#888]">Pagamento instantâneo</p>
                    </div>
                  </Label>
                </div>

                {/* Balance Option - Only show if user has balance */}
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
                        <p className="text-[12px] text-[#888]">
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
              {/* Header with title and badges */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-[15px] font-semibold text-white">Informações Pessoais</h2>
                  <div className="flex items-center gap-1.5 text-[#666] text-[12px]">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Dados protegidos</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-cyan-400 text-[13px] font-medium">
                  <Zap className="w-4 h-4" />
                  <span>Entrega imediata</span>
                </div>
              </div>

              {/* Row 1: Name + CPF */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {/* Name */}
                <div>
                  <label className="block text-[13px] text-[#888] mb-2">
                    Nome completo <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Input
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
                    <p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
                      {validation.nameError || 'Nome inválido'}
                    </p>
                  )}
                </div>
                
                {/* CPF */}
                <div>
                  <label className="block text-[13px] text-[#888] mb-2">
                    CPF <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Input
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
                    <p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
                      {validation.documentError || 'CPF inválido'}
                    </p>
                  )}
                </div>
              </div>

              {/* Row 2: Birth Date + WhatsApp */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {/* Birth Date */}
                <div>
                <label className="block text-[13px] text-[#888] mb-2">
                    Data de nascimento
                  </label>
                  <div className="relative">
                    <Input
                      value={formData.birthDate}
                      onChange={(e) => handleInputChange('birthDate', e.target.value)}
                      onBlur={() => handleBlur('birthDate')}
                      placeholder="DD/MM/AAAA"
                      inputMode="numeric"
                      autoComplete="bday"
                      className={getInputClassName('birthDate', "h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px]")}
                    />
                    <ValidationIcon 
                      isValid={validation.birthDate} 
                      show={formData.birthDate.replace(/\D/g, '').length === 8} 
                    />
                  </div>
                  {formData.birthDate.replace(/\D/g, '').length === 8 && !validation.birthDate && (
                    <p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
                      {validation.birthDateError || 'Data inválida'}
                    </p>
                  )}
                </div>
                
                {/* WhatsApp */}
                <div>
                  <label className="block text-[13px] text-[#888] mb-2">
                    WhatsApp <span className="text-red-500">*</span>
                  </label>
                  <div className="flex relative">
                    <div className="flex items-center justify-center px-3 h-12 bg-[#0a0a0a] border border-r-0 border-[#1a1a1a] rounded-l-lg text-[#555] text-[12px] whitespace-nowrap font-medium">
                      BR +55
                    </div>
                    <div className="relative flex-1">
                      <Input
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        onBlur={() => handleBlur('phone')}
                        placeholder="(00) 00000-0000"
                        inputMode="tel"
                        autoComplete="tel"
                        className={getInputClassName('phone', "h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-l-none rounded-r-lg text-[14px] w-full")}
                      />
                      <ValidationIcon isValid={validation.phone} show={touched.phone || false} />
                    </div>
                  </div>
                  {touched.phone && !validation.phone && (
                    <p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
                      {validation.phoneError || 'Telefone inválido'}
                    </p>
                  )}
                </div>
              </div>

              {/* Row 3: CEP */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {/* CEP */}
                <div>
                  <label className="flex items-center gap-2 text-[13px] text-[#888] mb-2">
                    CEP 
                    <span className="text-[10px] px-1.5 py-0.5 bg-[#1a1a1a] text-[#666] rounded">Busca automática</span>
                  </label>
                  <div className="relative">
                    <Input
                      value={formData.cep}
                      onChange={(e) => handleInputChange('cep', e.target.value)}
                      placeholder="00000-000"
                      inputMode="numeric"
                      className="h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#444] rounded-lg text-[14px]"
                    />
                    {loadingCep && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#555]" />
                    )}
                  </div>
                </div>
              </div>

              {/* Row 4: Estado + Cidade */}
              <div className="grid grid-cols-2 gap-4">
                {/* Estado */}
                <div>
                  <label className="block text-[13px] text-[#888] mb-2">
                    Estado
                  </label>
                  <Input
                    value={formData.estado}
                    readOnly
                    placeholder="—"
                    className="h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#333] rounded-lg text-[14px] cursor-default"
                  />
                </div>
                
                {/* Cidade */}
                <div>
                  <label className="block text-[13px] text-[#888] mb-2">
                    Cidade
                  </label>
                  <Input
                    value={formData.cidade}
                    readOnly
                    placeholder="Preenchido pelo CEP"
                    className="h-12 bg-[#0a0a0a] border-[#1a1a1a] text-white placeholder:text-[#333] rounded-lg text-[14px] cursor-default"
                  />
                </div>
              </div>

              {/* Mobile Submit Button - More prominent */}
              <div className="lg:hidden mt-6">
                <Button 
                  onClick={handleSubmit}
                  disabled={loading || finalPrice < 1}
                  className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-base shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : paymentMethod === "balance" ? (
                    "Pagar com Saldo →"
                  ) : (
                    "Pagar com PIX →"
                  )}
                </Button>
              </div>
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
