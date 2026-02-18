import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import vIcon from "@/assets/v-icon.png";
import { invokeFunction } from "@/lib/apiHelper";
import { useIsMobile } from "@/hooks/use-mobile";

import { trackPurchaseEvent } from "@/lib/analytics";
import { sendPurchaseFromClient } from "@/lib/metaCapi";

interface PixPaymentProps {
  qrCodeText: string;
  amount: number;
  transactionId: string;
  orderId: string;
  guestHash?: string;
  customerEmail?: string;
  customerName?: string;
  customerId?: string;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
  onPaymentConfirmed?: () => void;
}

export function PixPayment({ 
  qrCodeText, 
  amount, 
  transactionId, 
  orderId, 
  guestHash,
  customerEmail,
  customerName,
  customerId,
  productNames,
  productIds,
  quantities,
  prices,
  onPaymentConfirmed 
}: PixPaymentProps) {
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
    
    // Clear InitiateCheckout flag on confirmed payment
    try { sessionStorage.removeItem('valnix_ic_fired'); } catch {}
    
    // Track Purchase event for PIX payments
    trackPurchaseEvent(customerId || null, amount, orderId, productNames?.join(', '));
    
    // Send Purchase to Meta CAPI
    sendPurchaseFromClient({
      orderId,
      value: amount,
      userId: customerId,
      email: customerEmail,
      name: customerName,
      productNames,
      productIds,
      quantities,
      prices,
    });
    
    onPaymentConfirmed?.();
    
    // Toast removed — visual confirmation on screen is sufficient
    
    // Use the server-side generated guestHash for redirect
    setTimeout(() => {
      if (guestHash) {
        navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${guestHash}`);
      } else {
        navigate(`/entrega-prioritaria?order_id=${orderId}`);
      }
    }, 3000);
  };

  // Track expiry via ref so polling effect doesn't re-run every second
  const expiredRef = useRef(false);
  useEffect(() => { expiredRef.current = timeLeft === 0; }, [timeLeft]);

  // Poll FlowPay for payment status
  useEffect(() => {
    if (paymentConfirmed || !transactionId) return;

    const pollInterval = setInterval(async () => {
      if (expiredRef.current) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const response = await invokeFunction('flowpay-pix', {
          method: 'GET',
          queryParams: { action: 'status', chargeId: transactionId, orderId },
        });
        const data = await response.json();
        
        if (data.success && data.status === 'COMPLETED') {
          if (import.meta.env.DEV) console.log('✅ Payment confirmed via polling!');
          clearInterval(pollInterval);
          handlePaymentSuccess();
        }
      } catch (error) {
        console.warn('⚠️ Status poll error:', error);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [paymentConfirmed, transactionId]);

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
  const logoSize = isMobile ? 28 : 36;

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Payment Confirmed */}
      {paymentConfirmed && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 text-center space-y-2">
          <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
          <h2 className="text-xl font-bold text-green-500">Pagamento Confirmado!</h2>
          <p className="text-sm text-muted-foreground">
            Seu pagamento foi aprovado. Redirecionando em instantes...
          </p>
        </div>
      )}
      
      {/* Header */}
      <div className="text-center">
        <h2 className="text-lg md:text-2xl font-bold text-foreground mb-1">Pagamento via PIX</h2>
        <p className="text-xl md:text-3xl font-bold text-primary">
          R$ {(amount || 0).toFixed(2).replace('.', ',')}
        </p>
      </div>

      {/* Timer */}
      <div className={`p-3 rounded-xl border transition-all ${
        isExpired 
          ? 'bg-red-500/10 border-red-500/20' 
          : isExpiring 
            ? 'bg-yellow-500/10 border-yellow-500/20 animate-pulse' 
            : 'bg-muted/50 border-border/10'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isExpired ? (
              <AlertCircle className="w-4 h-4 text-red-500" />
            ) : (
              <Clock className={`w-4 h-4 ${isExpiring ? 'text-yellow-500' : 'text-primary'}`} />
            )}
            <span className="font-medium text-sm text-muted-foreground">
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
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
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
            className="w-full mt-3 rounded-xl"
            size="sm"
          >
            Gerar Novo QR Code
          </Button>
        )}
      </div>

      {/* QR Code */}
      <div className={`flex justify-center transition-opacity ${isExpired ? 'opacity-30' : ''}`}>
        <div className="relative bg-white p-5 rounded-2xl shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
          <QRCodeSVG
            value={qrCodeText}
            size={qrSize}
            level="H"
            includeMargin={false}
            fgColor="#1a1a1a"
            bgColor="#FFFFFF"
            imageSettings={{
              src: vIcon,
              height: logoSize,
              width: logoSize,
              excavate: true,
            }}
          />
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary rounded-br-2xl" />
        </div>
      </div>

      {/* Copy Code */}
      <div className={`space-y-3 transition-opacity ${isExpired ? 'opacity-30' : ''}`}>
        <p className="text-sm font-medium text-muted-foreground">PIX Copia e Cola:</p>
        <div className="p-3 bg-muted/50 rounded-xl text-xs break-all font-mono max-h-20 overflow-y-auto border border-border/10 text-muted-foreground">
          {qrCodeText}
        </div>
        <Button
          size="lg"
          className={`w-full h-13 font-semibold rounded-xl transition-all duration-150 active:scale-[0.98] ${
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
      <div className="bg-muted/50 rounded-xl p-4 border border-border/10">
        <p className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
          📱 Como pagar:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground">
          <li>Abra o app do seu banco</li>
          <li>Escolha pagar via PIX</li>
          <li>Escaneie o QR Code ou cole o código</li>
          <li>Confirme o pagamento de <strong className="text-primary">R$ {(amount || 0).toFixed(2).replace('.', ',')}</strong></li>
        </ol>
      </div>

      {/* Transaction ID */}
      <div className="text-center text-xs text-muted-foreground/60 bg-muted/30 p-2 rounded-xl">
        <p className="font-medium mb-0.5">ID da Transação</p>
        <p className="font-mono break-all">{transactionId}</p>
      </div>
    </div>
  );
}
