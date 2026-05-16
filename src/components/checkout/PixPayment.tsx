import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import vIcon from "@/assets/v-icon.png";
import { invokeFunction } from "@/lib/apiHelper";
import { useIsMobile } from "@/hooks/use-mobile";


interface PixPaymentProps {
  qrCodeText: string;
  amount: number;
  transactionId: string;
  orderId: string;
  guestHash?: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
  /** Segundos até expirar (resposta do gateway); padrão 15 min se omitido */
  pixExpiresInSeconds?: number;
  onPaymentConfirmed?: () => void;
}

function clampPixCountdownSeconds(sec: number | undefined): number {
  const fallback = 15 * 60;
  if (sec == null || !Number.isFinite(sec)) return fallback;
  return Math.min(Math.max(60, Math.floor(sec)), 24 * 60 * 60);
}

export function PixPayment({ 
  qrCodeText, 
  amount, 
  transactionId, 
  orderId, 
  guestHash,
  customerEmail,
  customerName,
  customerPhone,
  customerId,
  productNames,
  productIds,
  quantities,
  prices,
  pixExpiresInSeconds,
  onPaymentConfirmed 
}: PixPaymentProps) {
  const totalSeconds = useMemo(() => clampPixCountdownSeconds(pixExpiresInSeconds), [pixExpiresInSeconds]);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => clampPixCountdownSeconds(pixExpiresInSeconds));
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Use ref for handlePaymentSuccess to avoid stale closure in polling effect
  const paymentSuccessRef = useRef<() => void>(() => {});
  /** Set synchronously so the countdown cannot show "expired" toast after approval. */
  const paymentConfirmedRef = useRef(false);

  // Callback de confirmação de pagamento
  const handlePaymentSuccess = useCallback(async () => {
    if (paymentConfirmed) return;
    paymentConfirmedRef.current = true;
    setPaymentConfirmed(true);
    
    // Clear InitiateCheckout flag on confirmed payment
    try { sessionStorage.removeItem('valnix_ic_fired'); } catch {}
    
    // Track Purchase event for PIX payments
    import("@/lib/analytics").then(({ trackPurchaseEvent }) => {
      trackPurchaseEvent(customerId || null, amount, orderId, productNames?.join(', '));
    }).catch(() => {});
    
    // Send Purchase to Meta CAPI
    import("@/lib/metaCapi").then(({ sendPurchaseFromClient }) => {
      sendPurchaseFromClient({
        orderId,
        value: amount,
        userId: customerId,
        email: customerEmail,
        phone: customerPhone,
        name: customerName,
        productNames,
        productIds,
        quantities,
        prices,
      });
    }).catch(() => {});
    
    onPaymentConfirmed?.();
    
    // Use the server-side generated guestHash for redirect
    setTimeout(() => {
      if (guestHash) {
        navigate(`/entrega-prioritaria?order_id=${orderId}&hash=${guestHash}`);
      } else {
        navigate(`/entrega-prioritaria?order_id=${orderId}`);
      }
    }, 1500);
  }, [paymentConfirmed, amount, orderId, guestHash, customerEmail, customerName, customerPhone, customerId, productNames, productIds, quantities, prices, onPaymentConfirmed, navigate]);

  // Keep ref in sync so polling always calls latest version
  paymentSuccessRef.current = handlePaymentSuccess;

  useEffect(() => {
    setTimeLeft(totalSeconds);
  }, [totalSeconds]);

  // Track expiry via ref so polling effect doesn't re-run every second
  const expiredRef = useRef(false);
  useEffect(() => { expiredRef.current = timeLeft === 0; }, [timeLeft]);

  // Poll FlowPay for payment status
  useEffect(() => {
    if (paymentConfirmed || !transactionId) return;

    let polls = 0;
    const pollInterval = setInterval(async () => {
      polls++;
      if (polls > 360 || expiredRef.current) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const response = await invokeFunction('dice-pix', {
          method: 'GET',
          queryParams: { action: 'status', chargeId: transactionId, orderId },
        });
        const data = await response.json();
        
        if (data.success && data.status === 'COMPLETED') {
          if (import.meta.env.DEV) console.log('✅ Payment confirmed via polling!');
          clearInterval(pollInterval);
          paymentSuccessRef.current();
        }
      } catch (error) {
        if (import.meta.env.DEV) console.warn('⚠️ Status poll error:', error);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [paymentConfirmed, transactionId, orderId]);

  useEffect(() => {
    if (paymentConfirmed) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (!paymentConfirmedRef.current) {
            toast({
              title: "QR Code Expirado",
              description: "O código PIX expirou. Recarregue a página para gerar um novo.",
              variant: "destructive",
            });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [toast, totalSeconds, paymentConfirmed]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercentage = totalSeconds > 0 ? (timeLeft / totalSeconds) * 100 : 0;
  const isExpiring = timeLeft < 60;
  const isExpired = timeLeft === 0;

  const handleCopy = async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(qrCodeText);
      } else {
        // Fallback for iOS Safari and older browsers
        const textarea = document.createElement('textarea');
        textarea.value = qrCodeText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        // iOS Safari requires setSelectionRange
        textarea.setSelectionRange(0, textarea.value.length);
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Last resort fallback
      try {
        const textarea = document.createElement('textarea');
        textarea.value = qrCodeText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast({
          title: "Erro ao copiar",
          description: "Toque e segure o código acima para copiar manualmente.",
          variant: "destructive",
        });
      }
    }
  };

  const qrSize = isMobile ? 220 : 280;
  const logoSize = isMobile ? 28 : 36;

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Payment Confirmed */}
      {paymentConfirmed && (
        <div className="bg-success/10 border border-success/20 rounded-2xl p-4 text-center space-y-2">
          <CheckCircle className="w-10 h-10 text-success mx-auto" />
          <h2 className="text-xl font-bold text-success">Pagamento Confirmado!</h2>
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
      <div className={`p-3 rounded-xl border transition-colors ${
        isExpired 
          ? 'bg-destructive/10 border-destructive/20' 
          : isExpiring 
            ? 'bg-accent/10 border-accent/20' 
            : 'bg-muted/50 border-border/10'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isExpired ? (
              <AlertCircle className="w-4 h-4 text-destructive" />
            ) : (
              <Clock className={`w-4 h-4 ${isExpiring ? 'text-destructive' : 'text-primary'}`} />
            )}
            <span className="font-medium text-sm text-muted-foreground">
              {isExpired ? 'QR Code Expirado' : 'Tempo restante'}
            </span>
          </div>
          <span className={`text-xl font-bold font-mono ${
            isExpired 
              ? 'text-destructive' 
              : isExpiring 
                ? 'text-destructive' 
                : 'text-primary'
          }`}>
            {formatTime(timeLeft)}
          </span>
        </div>
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              isExpired 
                ? 'bg-destructive' 
                : isExpiring 
                  ? 'bg-destructive' 
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
          className={`w-full h-12 font-semibold rounded-xl transition-colors duration-150 active:scale-[0.98] ${
            copied 
              ? 'bg-success hover:bg-success/90' 
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
