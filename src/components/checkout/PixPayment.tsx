import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import vIcon from "@/assets/v-icon.png";
import { useIsMobile } from "@/hooks/use-mobile";
import { db, auth } from "@/integrations/firebase/config";
import { doc, updateDoc, getDoc, collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { saveGuestOrder, updateGuestOrderDelivery } from "@/lib/guestOrders";


interface PixPaymentProps {
  qrCodeText: string;
  amount: number;
  transactionId: string;
  orderId: string;
  customerEmail?: string;
  customerName?: string;
  customerId?: string;
  productNames?: string[];
  productIds?: string[];
  onPaymentConfirmed?: () => void;
}

export function PixPayment({ 
  qrCodeText, 
  amount, 
  transactionId, 
  orderId, 
  customerEmail,
  customerName,
  customerId,
  productNames,
  productIds,
  onPaymentConfirmed 
}: PixPaymentProps) {
  console.log("🔵 PixPayment rendering with:", { qrCodeText: qrCodeText?.substring(0, 30) + "...", amount, transactionId, orderId });
  
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();


  // Callback de confirmação de pagamento
  const handlePaymentSuccess = async () => {
    if (paymentConfirmed) return;
    setPaymentConfirmed(true);
    
    // 1. Update order status in Firestore (client-side has Firebase Auth)
    try {
      const orderRef = doc(db, "orders", orderId);
      await updateDoc(orderRef, {
        payment_status: 'paid',
        status: 'processing',
        updated_at: Timestamp.now(),
      });
      console.log(`✅ Order ${orderId} marked as paid in Firestore`);
    } catch (error) {
      console.error('❌ Failed to update order in Firestore:', error);
    }

    // 2. Process auto-delivery for eligible products
    try {
      const itemsRef = collection(db, "order_items");
      const q = query(itemsRef, where('order_id', '==', orderId));
      const itemsSnapshot = await getDocs(q);
      
      let allDelivered = true;
      
      for (const itemDoc of itemsSnapshot.docs) {
        const itemData = itemDoc.data();
        
        // Skip if already has delivery code
        if (itemData.delivery_code) continue;
        
        const productId = itemData.product_id;
        if (!productId) { allDelivered = false; continue; }
        
        const productRef = doc(db, "products", productId);
        const productSnap = await getDoc(productRef);
        if (!productSnap.exists()) { allDelivered = false; continue; }
        
        const productData = productSnap.data();
        const deliveryType = productData.delivery_type || 'manual';
        const qty = itemData.quantity || 1;
        
        if (deliveryType === 'auto_fake') {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          const codes: string[] = [];
          for (let i = 0; i < qty; i++) {
            let code = '';
            for (let j = 0; j < 16; j++) {
              code += chars.charAt(Math.floor(Math.random() * chars.length));
              if ((j + 1) % 4 === 0 && j < 15) code += '-';
            }
            codes.push(code);
          }
          await updateDoc(doc(db, "order_items", itemDoc.id), { delivery_code: codes.join(',') });
          console.log(`✅ Auto-generated ${codes.length} code(s) for item ${itemDoc.id}`);
        } else if (deliveryType === 'auto_real' && productData.auto_delivery_codes?.length > 0) {
          const needed = Math.min(qty, productData.auto_delivery_codes.length);
          const codes = productData.auto_delivery_codes.slice(0, needed);
          await updateDoc(doc(db, "order_items", itemDoc.id), { delivery_code: codes.join(',') });
          // Remove used codes from product
          const remaining = productData.auto_delivery_codes.slice(needed);
          await updateDoc(productRef, { auto_delivery_codes: remaining });
          console.log(`✅ Assigned ${codes.length} real code(s) for item ${itemDoc.id}`);
        } else {
          allDelivered = false;
        }
      }
      
      if (allDelivered && itemsSnapshot.size > 0) {
        await updateDoc(doc(db, "orders", orderId), { status: 'completed', updated_at: Timestamp.now() });
        console.log(`✅ Order ${orderId} auto-completed`);
      }
    } catch (error) {
      console.warn('⚠️ Auto-delivery processing failed:', error);
    }


    // Purchase tracking (analytics, Meta CAPI, UTMify) is handled
    // exclusively by the FlowPay webhook to avoid duplicates and
    // ensure only truly approved payments are tracked.

    // Save guest order for /order/:hash access
    let orderHash: string | null = null;
    try {
      // Collect order items with delivery codes
      const itemsRef2 = collection(db, "order_items");
      const q2 = query(itemsRef2, where('order_id', '==', orderId));
      const itemsSnap = await getDocs(q2);
      const orderItems = itemsSnap.docs.map(d => {
        const data = d.data();
        return {
          product_name: data.product_name || '',
          product_image: data.product_image || null,
          quantity: data.quantity || 1,
          unit_price: data.unit_price || 0,
          total_price: data.total_price || 0,
          delivery_code: data.delivery_code || null,
        };
      });

      orderHash = await saveGuestOrder({
        orderId,
        email: customerEmail || '',
        customerName: customerName || undefined,
        guestSessionId: customerId?.startsWith('guest_') ? customerId : null,
        items: orderItems,
        totalAmount: amount,
        paymentMethod: 'pix',
      });
      console.log(`✅ Guest order saved, hash: ${orderHash}`);
    } catch (err) {
      console.warn('⚠️ Failed to save guest order:', err);
    }
    
    onPaymentConfirmed?.();
    
    toast({
      title: "Pagamento Confirmado! 🎉",
      description: "Seu pagamento foi aprovado. Redirecionando...",
    });
    
    setTimeout(() => {
      // Redirect to order delivery page first, then upsell is accessible from there
      if (orderHash) {
        navigate(`/order/${orderHash}?upsell=1&order_id=${orderId}`);
      } else {
        navigate(`/painel-pagar?order_id=${orderId}`);
      }
    }, 3000);
  };

  // Poll FlowPay for payment status
  useEffect(() => {
    if (paymentConfirmed || timeLeft === 0 || !transactionId) return;

    const pollInterval = setInterval(async () => {
      try {
        // Get fresh Firebase ID token for each poll (optional for guests)
        const currentUser = auth.currentUser;
        const idToken = currentUser ? await currentUser.getIdToken() : null;

        const headers: Record<string, string> = {};
        if (idToken) {
          headers['Authorization'] = `Bearer ${idToken}`;
        }

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flowpay-pix?action=status&chargeId=${transactionId}`,
          { headers },
        );
        const data = await response.json();
        
        if (data.success && data.status === 'COMPLETED') {
          console.log('✅ Payment confirmed via polling!');
          clearInterval(pollInterval);
          handlePaymentSuccess();
        }
      } catch (error) {
        console.warn('⚠️ Status poll error:', error);
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [paymentConfirmed, timeLeft, transactionId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          toast({
            title: "QR Code Expirado",
            description: "O código PIX expirou. Recarregue a página para gerar um novo.",
            variant: "destructive",
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [toast]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercentage = (timeLeft / (15 * 60)) * 100;
  const isExpiring = timeLeft < 180;
  const isExpired = timeLeft === 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(qrCodeText);
      setCopied(true);
      toast({
        title: "Copiado!",
        description: "Código PIX copiado para a área de transferência",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Erro ao copiar",
        description: "Não foi possível copiar o código",
        variant: "destructive",
      });
    }
  };

  const qrSize = isMobile ? 220 : 280;
  const logoSize = isMobile ? 40 : 50;

  return (
    <div className="space-y-4">
      {/* Payment Confirmed */}
      {paymentConfirmed && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <h2 className="text-xl font-bold text-green-500">Pagamento Confirmado!</h2>
          <p className="text-sm text-gray-400">
            Seu pagamento foi aprovado. Redirecionando em instantes...
          </p>
        </div>
      )}
      
      {/* Header */}
      <div className="text-center">
        <h2 className="text-xl md:text-2xl font-bold text-white mb-1">Pagamento via PIX</h2>
        <p className="text-2xl md:text-3xl font-bold text-primary">
          R$ {(amount || 0).toFixed(2).replace('.', ',')}
        </p>
      </div>

      {/* Timer */}
      <div className={`p-3 rounded-xl border transition-all ${
        isExpired 
          ? 'bg-red-500/10 border-red-500/30' 
          : isExpiring 
            ? 'bg-yellow-500/10 border-yellow-500/30 animate-pulse' 
            : 'bg-[#2a2a2a] border-[#3a3a3a]'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isExpired ? (
              <AlertCircle className="w-4 h-4 text-red-500" />
            ) : (
              <Clock className={`w-4 h-4 ${isExpiring ? 'text-yellow-500' : 'text-primary'}`} />
            )}
            <span className="font-medium text-sm text-gray-300">
              {isExpired ? 'QR Code Expirado' : 'Tempo restante'}
            </span>
          </div>
          <span className={`text-xl font-bold font-mono ${
            isExpired 
              ? 'text-red-500' 
              : isExpiring 
                ? 'text-yellow-500' 
                : 'text-primary'
          }`}>
            {formatTime(timeLeft)}
          </span>
        </div>
        <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ease-linear ${
              isExpired 
                ? 'bg-red-500' 
                : isExpiring 
                  ? 'bg-yellow-500' 
                  : 'bg-primary'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        {isExpired && (
          <Button 
            onClick={() => window.location.reload()} 
            variant="destructive" 
            className="w-full mt-3"
            size="sm"
          >
            Gerar Novo QR Code
          </Button>
        )}
      </div>

      {/* QR Code */}
      <div className={`flex justify-center transition-opacity ${isExpired ? 'opacity-30' : ''}`}>
        <div className="bg-white p-4 rounded-xl shadow-lg relative">
          <QRCodeSVG
            value={qrCodeText}
            size={qrSize}
            level="H"
            includeMargin={false}
            fgColor="#000000"
            bgColor="#FFFFFF"
            imageSettings={{
              src: vIcon,
              height: logoSize,
              width: logoSize,
              excavate: true,
            }}
          />
        </div>
      </div>

      {/* Copy Code */}
      <div className={`space-y-3 transition-opacity ${isExpired ? 'opacity-30' : ''}`}>
        <p className="text-sm font-medium text-gray-300">PIX Copia e Cola:</p>
        <div className="p-3 bg-[#2a2a2a] rounded-xl text-xs break-all font-mono max-h-20 overflow-y-auto border border-[#3a3a3a] text-gray-400">
          {qrCodeText}
        </div>
        <Button
          size="lg"
          className={`w-full h-12 font-semibold rounded-xl ${
            copied 
              ? 'bg-green-600 hover:bg-green-700' 
              : 'bg-primary hover:bg-primary/90'
          }`}
          onClick={handleCopy}
          disabled={isExpired}
        >
          {copied ? (
            <>
              <Check className="w-5 h-5 mr-2" />
              Código Copiado!
            </>
          ) : (
            <>
              <Copy className="w-5 h-5 mr-2" />
              Copiar Código PIX
            </>
          )}
        </Button>
      </div>

      {/* Instructions */}
      <div className="bg-[#2a2a2a] rounded-xl p-4 border border-[#3a3a3a]">
        <p className="font-semibold text-sm text-gray-300 mb-3 flex items-center gap-2">
          📱 Como pagar:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-xs text-gray-400">
          <li>Abra o app do seu banco</li>
          <li>Escolha pagar via PIX</li>
          <li>Escaneie o QR Code ou cole o código</li>
          <li>Confirme o pagamento de <strong className="text-primary">R$ {(amount || 0).toFixed(2).replace('.', ',')}</strong></li>
        </ol>
      </div>

      {/* Transaction ID */}
      <div className="text-center text-xs text-gray-500 bg-[#2a2a2a]/50 p-2 rounded-lg">
        <p className="font-medium mb-0.5">ID da Transação</p>
        <p className="font-mono break-all">{transactionId}</p>
      </div>
    </div>
  );
}
