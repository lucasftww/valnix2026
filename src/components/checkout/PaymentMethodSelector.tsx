import { memo, useState } from "react";
import { CreditCard, ChevronDown } from "lucide-react";
import pixLogo from "@/assets/pix-logo.png";

interface PaymentMethodSelectorProps {
  paymentMethod: "pix" | "card";
  onMethodChange: (method: "pix" | "card") => void;
  finalPrice: number;
}

export const PaymentMethodSelector = memo(function PaymentMethodSelector({
  paymentMethod,
  onMethodChange,
  finalPrice,
}: PaymentMethodSelectorProps) {
  const [showCard, setShowCard] = useState(false);

  return (
    <div className="bg-secondary/50 rounded-2xl border border-border/10 p-4 sm:p-6 lg:p-4 mx-auto w-full max-w-lg lg:max-w-none shadow-lg shadow-black/5">
      <h2 className="text-[15px] lg:text-[13px] font-semibold text-foreground mb-4 lg:mb-3">Pagamento</h2>

      {/* PIX - always selected */}
      <div
        className="flex items-center gap-3 lg:gap-2.5 p-3 sm:p-4 lg:p-2.5 rounded-xl border border-border/5 bg-background cursor-default"
        onClick={() => onMethodChange("pix")}
      >
        <div className="w-5 lg:w-4 h-5 lg:h-4 rounded-full border-2 border-border/50 flex items-center justify-center shrink-0">
          {paymentMethod === "pix" && <div className="w-2.5 lg:w-2 h-2.5 lg:h-2 rounded-full bg-foreground" />}
        </div>
        <img src={pixLogo} alt="PIX" className="w-7 lg:w-6 h-7 lg:h-6 object-contain shrink-0" />
        <p className="text-[14px] lg:text-[13px] font-medium text-foreground">PIX</p>
      </div>

      {/* Card - collapsible, minimal */}
      <button
        type="button"
        onClick={() => {
          setShowCard(!showCard);
          if (!showCard) onMethodChange("card");
          else onMethodChange("pix");
        }}
        className="flex items-center gap-3 lg:gap-2.5 w-full p-3 lg:p-3 mt-2 lg:mt-1.5 rounded-xl border border-border/10 bg-background hover:border-border/20 transition-all text-left"
      >
        <div className="w-5 lg:w-4 h-5 lg:h-4 rounded-full border-2 border-border/30 flex items-center justify-center shrink-0">
          {paymentMethod === "card" && <div className="w-2.5 lg:w-2 h-2.5 lg:h-2 rounded-full bg-foreground" />}
        </div>
        <CreditCard className="w-4 lg:w-3.5 h-4 lg:h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[13px] lg:text-[12px] text-muted-foreground flex-1">Cartão</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showCard ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
});
