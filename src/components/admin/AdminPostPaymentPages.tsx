import { useState, useEffect } from "react";
import { requireAdminToken } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Star, Zap, Shield, TrendingUp, DollarSign, Eye, SkipForward, Link2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PageConfig {
  id: string;
  addon_type: string;
  title: string;
  subtitle: string | null;
  badge_text: string | null;
  badge_color: string;
  benefits: string[];
  price: number;
  original_price: number | null;
  button_accept_text: string;
  button_skip_text: string;
  next_route: string;
  is_active: boolean;
  display_order: number;
}

interface AddonStats {
  total: number;
  paid: number;
  skipped: number;
  revenue: number;
}

const iconMap: Record<string, typeof Star> = {
  premium_benefits: Star,
  delivery_priority: Zap,
  data_swap_warranty: Shield,
};

const labelMap: Record<string, string> = {
  premium_benefits: "Benefícios Premium",
  delivery_priority: "Entrega Prioritária",
  data_swap_warranty: "Proteção Total",
};

const routeMap: Record<string, string> = {
  premium_benefits: "/painel-pagar",
  delivery_priority: "/entrega-prioritaria",
  data_swap_warranty: "/protecao-total",
};

async function callAdminPostPayment(method: string, body?: any, queryParams?: Record<string, string>) {
  const { invokeFunction } = await import("@/lib/apiHelper");
  const token = requireAdminToken();
  const res = await invokeFunction("admin-post-payment", {
    method,
    body,
    queryParams,
    headers: { "x-admin-token": token || "" },
  });
  return res.json();
}

export function AdminPostPaymentPages() {
  const [pages, setPages] = useState<PageConfig[]>([]);
  const [stats, setStats] = useState<Record<string, AddonStats>>({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [utmParams, setUtmParams] = useState<Record<string, { source: string; medium: string; campaign: string }>>({});
  const { toast } = useToast();

  const getUtm = (addonType: string) => utmParams[addonType] || { source: "", medium: "", campaign: "" };
  const setUtm = (addonType: string, field: string, value: string) => {
    setUtmParams(prev => ({ ...prev, [addonType]: { ...getUtm(addonType), [field]: value } }));
  };
  const buildLink = (addonType: string) => {
    const prodOrigin = "https://www.valnix.com.br";
    const base = `${prodOrigin}${routeMap[addonType] || "/painel-pagar"}`;
    const utm = getUtm(addonType);
    const params = new URLSearchParams();
    if (utm.source) params.set("utm_source", utm.source);
    if (utm.medium) params.set("utm_medium", utm.medium);
    if (utm.campaign) params.set("utm_campaign", utm.campaign);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const result = await callAdminPostPayment("GET");
      if (result.pages) {
        setPages(result.pages.map((d: any) => ({
          ...d,
          benefits: Array.isArray(d.benefits) ? d.benefits as string[] : [],
          price: Number(d.price),
          original_price: d.original_price ? Number(d.original_price) : null,
        })));
      }
      if (result.addons) {
        const s: Record<string, AddonStats> = {};
        for (const row of result.addons) {
          if (!s[row.addon_type]) s[row.addon_type] = { total: 0, paid: 0, skipped: 0, revenue: 0 };
          s[row.addon_type].total++;
          if (row.status === "paid") { s[row.addon_type].paid++; s[row.addon_type].revenue += Number(row.amount); }
          if (row.status === "skipped") s[row.addon_type].skipped++;
        }
        setStats(s);
      }
    } catch (err) {
      console.error("Error loading post-payment data:", err);
    }
    setLoading(false);
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await callAdminPostPayment("POST", { action: "seed" });
      if (result.success || result.message) {
        toast({ title: "Páginas criadas!", description: "As páginas padrão de pós-venda foram configuradas." });
        await fetchData();
      } else {
        toast({ title: "Erro", description: result.error || "Falha ao criar páginas", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Falha na conexão", variant: "destructive" });
    }
    setSeeding(false);
  };

  const handleSave = async (page: PageConfig) => {
    setSaving(page.id);
    try {
      const result = await callAdminPostPayment("PUT", {
        id: page.id,
        title: page.title,
        subtitle: page.subtitle,
        badge_text: page.badge_text,
        badge_color: page.badge_color,
        benefits: page.benefits,
        price: page.price,
        original_price: page.original_price,
        button_accept_text: page.button_accept_text,
        button_skip_text: page.button_skip_text,
        next_route: page.next_route,
        is_active: page.is_active,
      });

      if (result.error) {
        toast({ title: "Erro ao salvar", description: result.error, variant: "destructive" });
      } else {
        toast({ title: "Salvo!", description: `Página "${page.title}" atualizada.` });
      }
    } catch {
      toast({ title: "Erro ao salvar", description: "Falha na conexão", variant: "destructive" });
    }
    setSaving(null);
  };

  const updatePage = (id: string, updates: Partial<PageConfig>) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const totalRevenue = Object.values(stats).reduce((sum, s) => sum + s.revenue, 0);
  const totalPaid = Object.values(stats).reduce((sum, s) => sum + s.paid, 0);
  const totalViews = Object.values(stats).reduce((sum, s) => sum + s.total, 0);

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Zap className="w-12 h-12 text-muted-foreground" />
        <h3 className="text-xl font-bold text-foreground">Nenhuma página configurada</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          As páginas de pós-venda (Entrega Prioritária e Proteção Total) ainda não foram criadas. Clique abaixo para configurar as páginas padrão.
        </p>
        <Button onClick={handleSeed} disabled={seeding} size="lg" className="gap-2">
          {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {seeding ? "Criando..." : "Criar Páginas Padrão"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#111] border border-[#1f1f1f] rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <DollarSign className="w-4 h-4" /> Receita Total
          </div>
          <p className="text-2xl font-bold text-green-500">R$ {totalRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-[#111] border border-[#1f1f1f] rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <TrendingUp className="w-4 h-4" /> Conversões
          </div>
          <p className="text-2xl font-bold text-primary">{totalPaid}</p>
        </div>
        <div className="bg-[#111] border border-[#1f1f1f] rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Eye className="w-4 h-4" /> Visualizações
          </div>
          <p className="text-2xl font-bold text-white">{totalViews}</p>
        </div>
        <div className="bg-[#111] border border-[#1f1f1f] rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <TrendingUp className="w-4 h-4" /> Taxa Conversão
          </div>
          <p className="text-2xl font-bold text-yellow-500">
            {totalViews > 0 ? ((totalPaid / totalViews) * 100).toFixed(1) : "0"}%
          </p>
        </div>
      </div>

      {/* Page Editors */}
      <Tabs defaultValue={pages[0]?.addon_type || "premium_benefits"}>
        <TabsList className="w-full justify-start bg-[#111] border border-[#1f1f1f]">
          {pages.map((page) => {
            const Icon = iconMap[page.addon_type] || Star;
            return (
              <TabsTrigger key={page.addon_type} value={page.addon_type} className="gap-2">
                <Icon className="w-4 h-4" />
                {labelMap[page.addon_type] || page.addon_type}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {pages.map((page) => {
          const addonStats = stats[page.addon_type] || { total: 0, paid: 0, skipped: 0, revenue: 0 };
          return (
            <TabsContent key={page.addon_type} value={page.addon_type}>
              <div className="bg-[#111] border border-[#1f1f1f] rounded-xl p-6 space-y-5">
                {/* Stats for this addon */}
                <div className="flex gap-4 flex-wrap">
                  <Badge variant="outline" className="gap-1">
                    <Eye className="w-3 h-3" /> {addonStats.total} views
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30">
                    <DollarSign className="w-3 h-3" /> {addonStats.paid} vendas
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-gray-400">
                    <SkipForward className="w-3 h-3" /> {addonStats.skipped} pulados
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30">
                    R$ {addonStats.revenue.toFixed(2)}
                  </Badge>
                </div>

                {/* Active toggle */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={page.is_active}
                    onCheckedChange={(v) => updatePage(page.id, { is_active: v })}
                  />
                  <Label className="text-sm">{page.is_active ? "Ativa" : "Desativada"}</Label>
                </div>

                {/* Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-gray-400">Título</Label>
                    <Input value={page.title} onChange={(e) => updatePage(page.id, { title: e.target.value })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Subtítulo</Label>
                    <Input value={page.subtitle || ""} onChange={(e) => updatePage(page.id, { subtitle: e.target.value })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Badge</Label>
                    <Input value={page.badge_text || ""} onChange={(e) => updatePage(page.id, { badge_text: e.target.value })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Cor do Badge</Label>
                    <select
                      value={page.badge_color}
                      onChange={(e) => updatePage(page.id, { badge_color: e.target.value })}
                      className="w-full h-9 rounded-md bg-[#0a0a0a] border border-[#222] px-3 text-sm text-white"
                    >
                      <option value="yellow">Amarelo</option>
                      <option value="orange">Laranja</option>
                      <option value="green">Verde</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Preço (R$)</Label>
                    <Input type="number" step="0.01" value={page.price} onChange={(e) => updatePage(page.id, { price: parseFloat(e.target.value) || 0 })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Preço Original (riscado)</Label>
                    <Input type="number" step="0.01" value={page.original_price || ""} onChange={(e) => updatePage(page.id, { original_price: parseFloat(e.target.value) || null })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                </div>

                {/* Benefits */}
                <div>
                  <Label className="text-xs text-gray-400">Benefícios (um por linha)</Label>
                  <Textarea
                    value={page.benefits.join("\n")}
                    onChange={(e) => updatePage(page.id, { benefits: e.target.value.split("\n").filter(Boolean) })}
                    className="bg-[#0a0a0a] border-[#222] min-h-[100px]"
                  />
                </div>

                {/* Buttons text + next_route */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-gray-400">Texto botão aceitar</Label>
                    <Input value={page.button_accept_text} onChange={(e) => updatePage(page.id, { button_accept_text: e.target.value })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Texto botão pular</Label>
                    <Input value={page.button_skip_text} onChange={(e) => updatePage(page.id, { button_skip_text: e.target.value })} className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs text-gray-400">Próxima rota (next_route)</Label>
                    <Input value={page.next_route || ""} onChange={(e) => updatePage(page.id, { next_route: e.target.value })} placeholder="/protecao-total" className="bg-[#0a0a0a] border-[#222]" />
                  </div>
                </div>

                {/* Standalone Link Generator */}
                <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Link2 className="w-4 h-4" /> Link direto para leads (sem compra)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px] text-gray-500">utm_source</Label>
                      <Input placeholder="ex: instagram" value={getUtm(page.addon_type).source} onChange={(e) => setUtm(page.addon_type, "source", e.target.value)} className="bg-[#111] border-[#222] text-xs h-8" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-gray-500">utm_medium</Label>
                      <Input placeholder="ex: cpc" value={getUtm(page.addon_type).medium} onChange={(e) => setUtm(page.addon_type, "medium", e.target.value)} className="bg-[#111] border-[#222] text-xs h-8" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-gray-500">utm_campaign</Label>
                      <Input placeholder="ex: promo_fev" value={getUtm(page.addon_type).campaign} onChange={(e) => setUtm(page.addon_type, "campaign", e.target.value)} className="bg-[#111] border-[#222] text-xs h-8" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={buildLink(page.addon_type)}
                      className="bg-[#111] border-[#222] text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(buildLink(page.addon_type));
                        toast({ title: "Link copiado!", description: "Envie para o lead." });
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-gray-600">Preencha os UTMs e copie o link. O lead acessa direto a oferta.</p>
                </div>

                {/* Save */}
                <Button onClick={() => handleSave(page)} disabled={saving === page.id} className="w-full md:w-auto">
                  {saving === page.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Salvar Alterações
                </Button>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
