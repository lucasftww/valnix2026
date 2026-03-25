import { memo } from "react";
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

    </div>
  );
});
