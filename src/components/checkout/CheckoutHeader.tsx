import { Link } from "react-router-dom";
import { Check, Lock } from "lucide-react";
import vLogo from "@/assets/v-logo-red.png";

interface CheckoutHeaderProps {
  currentStep?: 1 | 2 | 3;
}

export function CheckoutHeader({ currentStep = 1 }: CheckoutHeaderProps) {
  return (
    <header className="border-b border-border/10 backdrop-blur-xl bg-background/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <Link to="/">
          <img src={vLogo} alt="Valnix" className="h-9 md:h-10" />
        </Link>
        
        {/* Steps - Desktop */}
        <div className="hidden md:flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
              currentStep >= 1 ? 'bg-primary' : 'border border-border/20'
            }`}>
              {currentStep > 1 ? (
                <Check className="w-3 h-3 text-primary-foreground" />
              ) : (
                <span className="text-[11px] font-semibold text-primary-foreground">1</span>
              )}
            </div>
            <span className={`text-sm ${currentStep >= 1 ? 'text-foreground' : 'text-muted-foreground'}`}>Dados</span>
          </div>
          <div className="w-10 h-[1px] bg-border/20" />
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
              currentStep >= 2 ? 'bg-primary' : 'border-2 border-primary'
            }`}>
              {currentStep > 2 ? (
                <Check className="w-3 h-3 text-primary-foreground" />
              ) : (
                <span className={`text-[11px] font-semibold ${currentStep >= 2 ? 'text-primary-foreground' : 'text-primary'}`}>2</span>
              )}
            </div>
            <span className={`text-sm ${currentStep >= 2 ? 'text-foreground' : 'text-foreground'}`}>Pagamento</span>
          </div>
          <div className="w-10 h-[1px] bg-border/20" />
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
              currentStep >= 3 ? 'bg-primary' : 'border border-border/20'
            }`}>
              {currentStep > 3 ? (
                <Check className="w-3 h-3 text-primary-foreground" />
              ) : (
                <span className={`text-[11px] ${currentStep >= 3 ? 'text-primary-foreground' : 'text-muted-foreground'}`}>3</span>
              )}
            </div>
            <span className={`text-sm ${currentStep >= 3 ? 'text-foreground' : 'text-muted-foreground'}`}>Entrega</span>
          </div>
        </div>

        {/* Security Badge */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Pagamento seguro</span>
          <span className="hidden lg:inline">SSL de 256 bits garantido</span>
        </div>
      </div>
    </header>
  );
}
