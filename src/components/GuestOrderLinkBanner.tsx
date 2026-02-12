import { useGuestOrderLinking } from "@/hooks/useGuestOrderLink";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { CheckCircle2, X } from "lucide-react";
import { Link } from "react-router-dom";

export function GuestOrderLinkBanner() {
  const { user } = useAuth();
  const { linkedCount, linkedHashes, dismiss } = useGuestOrderLinking(user?.uid, user?.email || undefined);

  if (!user || linkedCount === 0) return null;

  return (
    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mx-4 md:mx-0 mb-4">
      <div className="flex items-start gap-3">
        <div className="bg-green-500/20 p-2 rounded-full shrink-0">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground">
            ✅ {linkedCount} pedido(s) vinculado(s) à sua conta
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Seus pedidos como convidado foram encontrados e vinculados automaticamente.{" "}
            {linkedHashes.length > 0 && (
              <Link to={`/order/${linkedHashes[0]}`} className="text-primary hover:underline">
                Ver pedido →
              </Link>
            )}
          </p>
        </div>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
