import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { invokeFunction } from "@/lib/apiHelper";
import { Copy, Check, CheckCircle2, Package, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import vLogo from "@/assets/v-logo-red.png";

interface OrderItemData {
  product_name: string;
  product_image: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_code: string | null;
}

interface GuestOrderData {
  id: string;
  hash: string;
  order_id: string;
  email: string;
  customer_name: string | null;
  customer_phone: string | null;
  order_data: {
    items: OrderItemData[];
    total_amount: number;
    payment_method?: string;
    created_at?: string;
  };
  linked: boolean;
  created_at: string;
  expires_at: string;
}




export default function OrderDelivery() {
  const { hash } = useParams<{ hash: string }>();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [order, setOrder] = useState<GuestOrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<OrderItemData[] | null>(null);
  const orderIdParam = searchParams.get("order_id");

  // Fetch guest order + items via Vercel function (orders table is deny-all to anon)
  useEffect(() => {
    if (!hash) { setNotFound(true); setLoading(false); return; }

    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentDelay = 5000; // start at 5s
    let prevItemsJson = ''; // track changes to avoid unnecessary re-renders
    const pollStartTime = Date.now();
    const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 min max polling

    const fetchGuestOrder = async (): Promise<'ok' | 'done' | 'error'> => {
      try {
        const res = await invokeFunction('guest-order', {
          method: 'GET',
          queryParams: { hash },
        });

        if (res.status === 429) return 'error'; // rate limited
        if (res.status >= 500) return 'error'; // server error

        // Only mark notFound on definitive 404/410, not network errors
        if (res.status === 404 || res.status === 410) {
          if (!cancelled) setNotFound(true);
          return 'done';
        }

        if (!res.ok) return 'error'; // other client errors — retry

        const data = await res.json();

        if (!cancelled) {
          const newItemsJson = JSON.stringify(data.items || []);

          setOrder({
            id: hash,
            hash: hash,
            order_id: data.order_id,
            email: data.email,
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            order_data: {
              items: data.items || [],
              total_amount: data.total_amount || 0,
              payment_method: data.payment_method || 'pix',
              created_at: data.created_at,
            },
            linked: data.linked,
            created_at: data.created_at || new Date().toISOString(),
            expires_at: data.expires_at || new Date().toISOString(),
          } as GuestOrderData);

          // Only update liveItems if data actually changed
          if (newItemsJson !== prevItemsJson) {
            prevItemsJson = newItemsJson;
            if (data.items && data.items.length > 0) {
              setLiveItems(data.items);
            }
          }

          // Check if all items have delivery codes → stop polling
          const allDelivered = (data.items || []).length > 0 &&
            (data.items as OrderItemData[]).every((i: OrderItemData) => !!i.delivery_code);
          if (allDelivered) return 'done';

          // Safety: stop polling after 10 minutes
          if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) return 'done';
        }
        return 'ok';
      } catch (err) {
        if (import.meta.env.DEV) console.error("Error fetching guest order:", err);
        // Network error → don't mark notFound, just retry with backoff
        return 'error';
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // ✅ Fix #5a: Polling with backoff on errors
    const schedulePoll = (result: 'ok' | 'done' | 'error') => {
      if (cancelled || result === 'done') return;

      if (result === 'error') {
        // Backoff: double delay, cap at 30s
        currentDelay = Math.min(currentDelay * 2, 30_000);
      } else {
        // Reset to normal interval on success
        currentDelay = 5000;
      }

      pollTimeout = setTimeout(async () => {
        if (cancelled) return;
        const nextResult = await fetchGuestOrder();
        schedulePoll(nextResult);
      }, currentDelay);
    };

    // Initial fetch
    fetchGuestOrder().then((result) => {
      if (!cancelled) schedulePoll(result);
    });

    return () => {
      cancelled = true;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [hash]);

  const copyCode = async (code: string, index: number) => {
    const text = code.trim();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedCode(text);
      toast({ title: "Copiado!", description: `Código #${index + 1} copiado!` });
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast({
        title: "Não foi possível copiar",
        description: "Selecione o código manualmente.",
        variant: "destructive",
      });
    }
  };

  const copyAllCodes = async (codes: string[]) => {
    const text = codes.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast({ title: "Copiado!", description: "Todos os códigos copiados!" });
    } catch {
      toast({
        title: "Não foi possível copiar",
        description: "Copie os códigos um a um.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando seu pedido...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Pedido não encontrado</h1>
          <p className="text-sm text-muted-foreground">
            Este link pode ter expirado ou ser inválido. Se você fez uma compra, verifique o e-mail usado no checkout.
          </p>
          <Link to="/">
            <Button className="mt-4">Voltar à Loja</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const orderData = order.order_data;
  const items = liveItems || orderData.items || [];
  const hasAnyCodes = items.some(i => i.delivery_code);
  const effectiveOrderId = orderIdParam || order.order_id;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Meu pedido — VALNIX</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/">
            <img src={vLogo} alt="Valnix" className="h-8" />
          </Link>
          <Badge variant="outline" className="text-success border-success/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Pagamento Confirmado
          </Badge>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10 space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-success" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Pedido Confirmado! 🎉
          </h1>
          <p className="text-muted-foreground text-sm">
            Olá, <span className="text-foreground font-medium">{order.customer_name || "Cliente"}</span>! 
            Seu pedido #{order.order_id.slice(0, 8)} foi confirmado.
          </p>
        </div>

        {/* Order email reference */}

        {/* Products & Delivery Codes */}
        <Card className="bg-card border-border">
          <CardContent className="p-5 md:p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              {hasAnyCodes ? "Seus Códigos de Entrega" : "Itens do Pedido"}
            </h2>

            <div className="space-y-4">
              {items.map((item, itemIndex) => {
                const codes = item.delivery_code ? item.delivery_code.split(",").map(c => c.trim()) : [];

                return (
                  <div key={itemIndex} className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center gap-4 p-4 bg-secondary/30">
                      {item.product_image && (
                        <img
                          src={item.product_image}
                          alt={item.product_name}
                          className="w-14 h-14 object-contain bg-muted rounded-lg"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-foreground truncate">{item.product_name}</h3>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          {item.quantity}x R$ {item.unit_price.toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                      <p className="font-bold text-primary shrink-0">
                        R$ {item.total_price.toFixed(2).replace(".", ",")}
                      </p>
                    </div>

                    {codes.length > 0 ? (
                      <div className="border-t border-border bg-success/5 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-success flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {codes.length} código(s) entregue(s)
                          </p>
                          {codes.length > 1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-success/30 text-success hover:bg-success/10"
                              onClick={() => copyAllCodes(codes)}
                            >
                              <Copy className="w-3 h-3 mr-1" /> Copiar Todos
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {codes.map((code, codeIndex) => (
                            <div
                              key={codeIndex}
                              className="flex items-center justify-between gap-2 bg-secondary/30 p-3 rounded-lg border border-border"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">#{codeIndex + 1}</span>
                                <code className="text-sm font-mono text-primary font-bold break-all select-all">
                                  {code}
                                </code>
                              </div>
                              <Button
                                size="sm"
                                className="shrink-0 h-9 px-3 bg-primary hover:bg-primary/90"
                                onClick={() => copyCode(code, codeIndex)}
                              >
                                {copiedCode === code.trim() ? (
                                  <Check className="w-4 h-4" />
                                ) : (
                                  <>
                                    <Copy className="w-4 h-4 mr-1" />
                                    <span className="text-xs">Copiar</span>
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-border bg-orange-500/5 p-4" data-delivery-pending>
                        <div className="flex items-center gap-3">
                          <div className="bg-orange-500/15 p-2 rounded-full shrink-0">
                            <Package className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-orange-500">Processando entrega</p>
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              Estamos preparando seus códigos. Eles aparecerão aqui automaticamente em alguns segundos.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Resumo</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Pedido</span>
                <span className="text-foreground font-mono">#{order.order_id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">Total</span>
                <span className="text-primary font-bold text-lg">
                  R$ {orderData.total_amount?.toFixed(2).replace(".", ",") || "0,00"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/60">E-mail</span>
                <span className="text-muted-foreground truncate max-w-[200px]">{order.email}</span>
              </div>
              {orderData.created_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Data</span>
                  <span className="text-muted-foreground">
                    {new Date(orderData.created_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CTA: Create account */}
        {/* CTA: Back to store */}

        {/* Back to store */}
        <div className="text-center pb-8">
          <Link to="/">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
              ← Voltar à Loja
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
