import { useState, useEffect, memo } from "react";
import { X, ShieldAlert } from "lucide-react";
import { Button } from "./ui/button";

/**
 * Detects if an ad blocker is blocking Firestore connections.
 * Shows a non-intrusive banner asking users to whitelist the site.
 */
const AdBlockDetectorComponent = () => {
  const [isBlocked, setIsBlocked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already dismissed this session
    try {
      if (sessionStorage.getItem("valnix_adblock_dismissed")) {
        setDismissed(true);
        return;
      }
    } catch {}

    // Test if Firestore is reachable by making a lightweight HEAD request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch("https://firestore.googleapis.com/", {
      method: "HEAD",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        // no-cors always resolves with opaque response — this means NOT blocked
        setIsBlocked(false);
      })
      .catch(() => {
        // If fetch fails completely, likely blocked by extension
        setIsBlocked(true);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
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
