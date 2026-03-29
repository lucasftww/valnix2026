import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/apiHelper";
import { requireAdminToken } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Database, Play, Pause, RotateCcw, CheckCircle2, AlertCircle, Loader2, ShoppingBag, Zap } from "lucide-react";
import { generateEventId } from "@/lib/eventId";

export const AdminMigration = () => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [testEventCode, setTestEventCode] = useState("");
  const [processedCount, setProcessedCount] = useState(0);
  const [eventType, setEventType] = useState<'Purchase' | 'InitiateCheckout'>('Purchase');

  // Fetch orders for migration
  const { data: allOrders = [], isLoading } = useQuery({
    queryKey: ['admin-migration-orders'],
    queryFn: async () => {
      const token = requireAdminToken();
      const res = await invokeFunction("admin-data", {
        method: "GET",
        queryParams: { resource: "orders" },
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      return Array.isArray(data.orders) ? data.orders : [];
    }
  });

  const filteredOrders = allOrders.filter((o: any) => 
    eventType === 'Purchase' ? o.payment_status === 'paid' : true
  );

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 50));
  };

  const startMigration = async () => {
    if (filteredOrders.length === 0) {
      toast({ title: "Nenhum pedido", description: `Não há pedidos para ${eventType}.`, variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setProcessedCount(0);
    setProgress(0);
    setLogs([]);
    addLog(`🚀 Iniciando migração de ${filteredOrders.length} eventos de ${eventType}...`);

    const token = requireAdminToken();
    
    // 📦 STEP 1: Batch fetch all items to avoid N+1 requests
    addLog("📦 Carregando detalhes dos pedidos em lote...");
    const itemsMap = new Map<string, any[]>();
    const orderIds = filteredOrders.map((o: any) => o.id);
    const CHUNK_SIZE = 100;

    for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
      const chunk = orderIds.slice(i, i + CHUNK_SIZE);
      try {
        const res = await invokeFunction("admin-data", {
          method: "GET",
          queryParams: { resource: "batch-items", orderIds: chunk.join(',') },
          headers: { "x-admin-token": token },
        });
        const data = await res.json();
        if (data.batch) {
          Object.entries(data.batch).forEach(([orderId, items]) => {
            itemsMap.set(orderId, items as any[]);
          });
        }
        addLog(`📦 Carregado lote ${Math.floor(i / CHUNK_SIZE) + 1}...`);
      } catch (err) {
        addLog(`⚠️ Falha ao carregar lote de itens ${i}-${i + CHUNK_SIZE}`);
      }
    }

    addLog("🚀 Enviando para o meta-relay...");

    for (let i = 0; i < filteredOrders.length; i++) {
      if (!isProcessing && i > 0) break;

      const order = filteredOrders[i];
      try {
        const items = itemsMap.get(order.id) || [];

        const eventId = generateEventId(eventType, order.id);
        const nameParts = (order.customer_name || '').split(' ');
        const unixTimestamp = Math.floor(new Date(order.created_at).getTime() / 1000);

        const payload = {
          event_name: eventType,
          event_id: eventId,
          order_id: order.id,
          event_time: unixTimestamp,
          value: order.total_amount,
          currency: 'BRL',
          content_name: items.map((it: any) => it.product_name).join(', ') || `Pedido #${order.id.slice(0, 8)}`,
          content_ids: items.map((it: any) => it.product_id || it.id).filter(Boolean),
          email: order.customer_email || undefined,
          phone: order.customer_phone || undefined,
          first_name: nameParts[0] || undefined,
          last_name: nameParts.slice(1).join(' ') || undefined,
          external_id: order.user_id || undefined,
          test_event_code: testEventCode || undefined,
        };

        const capiRes = await invokeFunction('capi-replay', {
          method: 'POST',
          headers: { 'x-admin-token': token },
          body: { ...payload, resource: 'relay' },
        });

        if (capiRes.ok) {
          addLog(`✅ ${eventType} #${order.id.slice(0, 8)} enviado.`);
        } else {
          const errData = await capiRes.json().catch(() => ({}));
          addLog(`❌ Erro no ${eventType} #${order.id.slice(0, 8)}: ${errData.error || capiRes.statusText}`);
        }
      } catch (err) {
        addLog(`❌ Falha crítica no ${eventType} #${order.id.slice(0, 8)}`);
      }

      const nextCount = i + 1;
      setProcessedCount(nextCount);
      setProgress((nextCount / filteredOrders.length) * 100);

      const delay = eventType === 'InitiateCheckout' ? 100 : 250;
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    setIsProcessing(false);
    toast({ title: "Migração Concluída", description: `${filteredOrders.length} eventos processados.` });
    addLog("🏁 Processo de migração finalizado.");
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Database className="w-5 h-5" />
              <CardTitle>Histórico Meta CAPI</CardTitle>
            </div>
            <CardDescription>
              Selecione o tipo de evento e envie os dados históricos para o seu novo Pixel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex gap-4">
              <Button 
                variant={eventType === 'Purchase' ? 'default' : 'outline'}
                onClick={() => setEventType('Purchase')}
                className="flex-1 h-16 flex-col gap-1"
                disabled={isProcessing}
              >
                <ShoppingBag className="w-5 h-5" />
                <span>Vendas (Purchase)</span>
              </Button>
              <Button 
                variant={eventType === 'InitiateCheckout' ? 'default' : 'outline'}
                onClick={() => setEventType('InitiateCheckout')}
                className="flex-1 h-16 flex-col gap-1"
                disabled={isProcessing}
              >
                <Zap className="w-5 h-5" />
                <span>Checkouts (IC)</span>
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Eventos Disponíveis</p>
                <p className="text-3xl font-bold">{isLoading ? "..." : filteredOrders.length}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Tipo Selecionado</p>
                <div className="flex items-center gap-2 justify-end">
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                    {eventType}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-code" className="text-xs uppercase tracking-widest text-muted-foreground">Test Event Code (Opcional)</Label>
              <Input 
                id="test-code"
                placeholder="Ex: TEST12345"
                value={testEventCode}
                onChange={(e) => setTestEventCode(e.target.value)}
                disabled={isProcessing}
                className="bg-background/50"
              />
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span>Progresso</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-center text-xs text-muted-foreground">
                  {processedCount} de {filteredOrders.length} eventos migrados
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button 
                onClick={startMigration} 
                className="flex-1 h-12 gap-2 text-sm font-bold bg-success hover:bg-success/90 text-success-foreground"
                disabled={isProcessing || isLoading || filteredOrders.length === 0}
              >
                {isProcessing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isProcessing ? "Pausar Processo" : "Iniciar Migração Completa"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => { setProcessedCount(0); setProgress(0); setLogs([]); }}
                className="h-12 w-12 p-0 border-border/50"
                disabled={isProcessing}
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Logs de Execução
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-background/80 rounded-lg p-3 h-[400px] overflow-y-auto border border-border/50 font-mono text-[10px] space-y-1.5 custom-scrollbar">
              {logs.length === 0 && (
                <p className="text-muted-foreground/40 italic text-center py-20">Nenhuma atividade registrada.</p>
              )}
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground/50 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                  <span className={log.includes('❌') ? 'text-destructive' : log.includes('✅') ? 'text-success' : 'text-foreground/80'}>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
