import { useState, useEffect, memo } from "react";
import { X, ShieldAlert } from "lucide-react";
import { Button } from "./ui/button";

/**
 * Detects if an ad blocker is blocking Firestore connections.
 * Uses passive detection via Firestore error events instead of active fetch.
 */
const AdBlockDetectorComponent = () => {
  const [isBlocked, setIsBlocked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("valnix_adblock_dismissed")) {
        setDismissed(true);
        return;
      }
    } catch {}

    // Passive detection: poll the global flag set by Firestore hooks
    // Uses short interval (500ms) for responsive detection, stops after 15s
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      if ((window as any).__valnix_firestore_blocked) {
        setIsBlocked(true);
        if (timer) clearTimeout(timer);
        if (stop) clearTimeout(stop);
        return;
      }
      timer = setTimeout(check, 500);
    };

    check(); // immediate first check
    stop = setTimeout(() => {
      if (timer) clearTimeout(timer);
    }, 15000);

    return () => {
      if (timer) clearTimeout(timer);
      if (stop) clearTimeout(stop);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("valnix_adblock_dismissed", "1");
    } catch {}
  };

  if (!isBlocked || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-card border border-border/20 rounded-2xl shadow-2xl shadow-black/30 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Ad blocker detectado
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Seu bloqueador de anúncios pode impedir o carregamento dos produtos. 
              Adicione <strong className="text-foreground">valnix.com.br</strong> à lista 
              de permissões para uma experiência completa.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="h-8 w-8 rounded-full hover:bg-secondary flex-shrink-0 -mt-1 -mr-1"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export const AdBlockDetector = memo(AdBlockDetectorComponent);