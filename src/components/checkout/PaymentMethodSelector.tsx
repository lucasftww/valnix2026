import { memo } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { CreditCard, Wallet } from "lucide-react";
import pixLogo from "@/assets/pix-logo.png";

interface PaymentMethodSelectorProps {
  paymentMethod: "pix" | "balance" | "card";
  onMethodChange: (method: "pix" | "balance" | "card") => void;
  userBalance: number;
  finalPrice: number;
}

export const PaymentMethodSelector = memo(function PaymentMethodSelector({
  paymentMethod,
  onMethodChange,
  userBalance,
  finalPrice,
}: PaymentMethodSelectorProps) {
  return (
    <div className="bg-secondary/50 backdrop-blur-xl rounded-2xl border border-border/10 p-4 sm:p-6">
      <h2 className="text-[15px] font-semibold text-foreground mb-4 md:mb-5">Pagamento</h2>

      <RadioGroup
        value={paymentMethod}
        onValueChange={(value) => onMethodChange(value as "pix" | "balance" | "card")}
        className="space-y-2"
      >
        {/* PIX Option */}
        <div
          className={`flex items-center gap-3 p-3 sm:p-4 rounded-xl border cursor-pointer transition-all ${
            paymentMethod === "pix"
              ? "border-primary/40 bg-primary/5"
              : "border-border/10 bg-background hover:border-border/20"
          }`}
          onClick={() => onMethodChange("pix")}
        >
          <RadioGroupItem value="pix" id="pix" className="shrink-0" />
          <Label htmlFor="pix" className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
            <img src={pixLogo} alt="PIX" className="w-7 h-7 object-contain shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] sm:text-[14px] font-medium text-foreground">PIX</p>
            </div>
          </Label>
        </div>

        {/* Card Option */}
        <div
          className={`flex items-center gap-3 p-3 sm:p-4 rounded-xl border cursor-pointer transition-all ${
            paymentMethod === "card"
              ? "border-blue-500/40 bg-blue-500/5"
              : "border-border/10 bg-background hover:border-border/20"
          }`}
          onClick={() => onMethodChange("card")}
        >
          <RadioGroupItem value="card" id="card" className="shrink-0" />
          <Label htmlFor="card" className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <CreditCard className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[13px] sm:text-[14px] font-medium text-foreground whitespace-nowrap">
                  Crédito ou débito
                </p>
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
            className={`relative flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
              paymentMethod === "balance"
                ? "border-primary/40 bg-primary/5"
                : "border-border/10 bg-background hover:border-border/20"
            } ${userBalance < finalPrice ? "opacity-60" : ""}`}
            onClick={() => userBalance >= finalPrice && onMethodChange("balance")}
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
                  <p className="text-[14px] font-medium text-foreground">Saldo da conta</p>
                  <span className="text-[12px] font-semibold text-green-500">
                    R$ {userBalance.toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {userBalance >= finalPrice ? "Pagamento imediato" : "Saldo insuficiente"}
                </p>
              </div>
            </Label>
          </div>
        )}
      </RadioGroup>

      {/* Payment info - hidden on mobile for cleaner look */}
      <div className="hidden md:block bg-muted/50 rounded-xl p-4 border border-border/10 mt-4">
        {paymentMethod === "pix" ? (
          <>
            <h3 className="text-[14px] font-semibold text-foreground mb-2">Pagamento com Pix</h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Ao confirmar o pedido, você receberá um QR Code para realizar o pagamento. Utilize o
              aplicativo do seu banco para escanear o QR Code ou copie o código.
            </p>
          </>
        ) : paymentMethod === "card" ? (
          <>
            <h3 className="text-[14px] font-semibold text-foreground mb-2">Pagamento com Cartão</h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Ao finalizar a compra, você será redirecionado para um site seguro para inserir os
              dados do seu cartão e completar o pagamento.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-[14px] font-semibold text-foreground mb-2">Pagamento com Saldo</h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              O valor será debitado imediatamente do seu saldo. Saldo após compra:{" "}
              <span className="text-green-500 font-medium">
                R$ {(userBalance - finalPrice).toFixed(2)}
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
});
