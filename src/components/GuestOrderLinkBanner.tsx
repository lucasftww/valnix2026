import { useState } from "react";
import { useGuestOrderLinking } from "@/hooks/useGuestOrderLink";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { Button } from "@/components/ui/button";
import { X, Package, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

export function GuestOrderLinkBanner() {
  const { user } = useAuth();
  const { pendingOrders, linkOrders, dismissLinking } = useGuestOrderLinking(user?.uid, user?.email || undefined);
  const { toast } = useToast();
  const [linking, setLinking] = useState(false);

  if (!user || pendingOrders.length === 0) return null;

  const handleLink = async () => {
    setLinking(true);
    const success = await linkOrders();
    setLinking(false);
    if (success) {
      toast({
        title: "Pedidos vinculados! 🎉",
        description: `${pendingOrders.length} pedido(s) foram vinculados à sua conta.`,
      });
    }
  };

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mx-4 md:mx-0 mb-4">
      <div className="flex items-start gap-3">
        <div className="bg-primary/20 p-2 rounded-full shrink-0">
          <Package className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground">
            {pendingOrders.length} pedido(s) como convidado encontrado(s)
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Vincule à sua conta para acompanhar em "Meus Pedidos".
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleLink} disabled={linking} className="h-8 text-xs">
              {linking ? "Vinculando..." : "Vincular Pedidos"}
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissLinking} className="h-8 text-xs text-muted-foreground">
              Depois
            </Button>
          </div>
        </div>
        <button onClick={dismissLinking} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
