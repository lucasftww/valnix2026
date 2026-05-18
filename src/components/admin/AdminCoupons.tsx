import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeFunction } from '@/lib/apiHelper';
import { requireAdminToken } from '@/lib/adminAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Edit, Trash2, Loader2, Tag } from 'lucide-react';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'percent' | 'fixed';
  value: number;
  min_order: number;
  max_discount: number | null;
  max_uses: number | null;
  uses_count: number;
  max_uses_per_user: number | null;
  first_purchase_only: boolean;
  expires_at: string | null;
  starts_at: string | null;
  is_active: boolean;
  applies_to_category: string | null;
}

interface FormState {
  code: string;
  description: string;
  type: 'percent' | 'fixed';
  value: string;
  min_order: string;
  max_discount: string;
  max_uses: string;
  max_uses_per_user: string;
  first_purchase_only: boolean;
  expires_at: string;
  is_active: boolean;
  applies_to_category: string;
}

const emptyForm: FormState = {
  code: '', description: '', type: 'percent', value: '', min_order: '0',
  max_discount: '', max_uses: '', max_uses_per_user: '1',
  first_purchase_only: false, expires_at: '', is_active: true,
  applies_to_category: '',
};

function formatBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AdminCoupons() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { data: coupons = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-coupons'],
    queryFn: async (): Promise<Coupon[]> => {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'coupons' },
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.coupons ?? []) as Coupon[];
    },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({
      code: c.code,
      description: c.description ?? '',
      type: c.type,
      value: String(c.value),
      min_order: String(c.min_order),
      max_discount: c.max_discount != null ? String(c.max_discount) : '',
      max_uses: c.max_uses != null ? String(c.max_uses) : '',
      max_uses_per_user: c.max_uses_per_user != null ? String(c.max_uses_per_user) : '',
      first_purchase_only: c.first_purchase_only,
      expires_at: c.expires_at ? c.expires_at.slice(0, 16) : '',
      is_active: c.is_active,
      applies_to_category: c.applies_to_category ?? '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = useCallback(async () => {
    if (!form.code.trim() || !form.value) {
      toast({ title: 'Preencha código e valor', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const token = requireAdminToken();
      const payload: Record<string, unknown> = {
        code: form.code.trim().toUpperCase(),
        description: form.description || null,
        type: form.type,
        value: Number(form.value),
        min_order: Number(form.min_order) || 0,
        max_discount: form.max_discount ? Number(form.max_discount) : null,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        max_uses_per_user: form.max_uses_per_user ? Number(form.max_uses_per_user) : null,
        first_purchase_only: form.first_purchase_only,
        expires_at: form.expires_at || null,
        is_active: form.is_active,
        applies_to_category: form.applies_to_category || null,
      };
      const method = editing ? 'PUT' : 'POST';
      const body = editing ? { id: editing.id, ...payload } : payload;
      const res = await invokeFunction('admin-data', {
        method,
        queryParams: { resource: 'coupons' },
        headers: { 'x-admin-token': token },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast({ title: editing ? 'Cupom atualizado' : 'Cupom criado' });
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-coupons'] });
      refetch();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [form, editing, queryClient, refetch, toast]);

  const handleDelete = useCallback(async (c: Coupon) => {
    if (!confirm(`Excluir cupom ${c.code}? Histórico de redenções é preservado.`)) return;
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'DELETE',
        queryParams: { resource: 'coupons', id: c.id },
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `Cupom ${c.code} excluído` });
      refetch();
    } catch (e: any) {
      toast({ title: 'Erro ao excluir', description: e.message, variant: 'destructive' });
    }
  }, [refetch, toast]);

  const handleToggle = useCallback(async (c: Coupon) => {
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'PUT',
        queryParams: { resource: 'coupons' },
        headers: { 'x-admin-token': token },
        body: { id: c.id, is_active: !c.is_active },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      refetch();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  }, [refetch, toast]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {coupons.length} cupom(s) — clientes aplicam no carrinho ou checkout.
        </p>
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> Novo cupom
        </Button>
      </div>

      {coupons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Tag className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Nenhum cupom criado ainda.</p>
            <p className="text-xs mt-1">Crie um cupom para oferecer descontos.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {coupons.map((c) => {
            const expired = c.expires_at && new Date(c.expires_at) < new Date();
            const exhausted = c.max_uses != null && c.uses_count >= c.max_uses;
            return (
              <Card key={c.id} className={!c.is_active || expired ? 'opacity-60' : ''}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-base font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                        {c.code}
                      </code>
                      <span className="text-sm font-semibold">
                        {c.type === 'percent' ? `${c.value}% OFF` : `${formatBRL(c.value)} OFF`}
                      </span>
                      {c.first_purchase_only && <Badge variant="secondary" className="text-[10px]">1ª compra</Badge>}
                      {expired && <Badge variant="destructive" className="text-[10px]">Expirado</Badge>}
                      {exhausted && <Badge variant="destructive" className="text-[10px]">Esgotado</Badge>}
                      {!c.is_active && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground truncate">{c.description}</p>}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {c.min_order > 0 && <span>Mín: {formatBRL(c.min_order)}</span>}
                      <span>Usos: {c.uses_count}{c.max_uses != null ? ` / ${c.max_uses}` : ''}</span>
                      {c.max_uses_per_user && <span>{c.max_uses_per_user}× por cliente</span>}
                      {c.applies_to_category && <span>Categoria: {c.applies_to_category}</span>}
                      {c.expires_at && <span>Expira: {new Date(c.expires_at).toLocaleDateString('pt-BR')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch checked={c.is_active} onCheckedChange={() => handleToggle(c)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}><Edit className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar cupom ${editing.code}` : 'Novo cupom'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-code">Código *</Label>
                <Input id="c-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PRIMEIRA5" className="uppercase font-mono" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="c-type">Tipo *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as 'percent' | 'fixed' })}>
                  <SelectTrigger id="c-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentual (%)</SelectItem>
                    <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="c-desc">Descrição</Label>
              <Input id="c-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex.: 5% OFF na primeira compra" maxLength={200} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="c-value">Valor *</Label>
                <Input id="c-value" type="number" step="0.01" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percent' ? '5' : '10.00'} />
              </div>
              <div>
                <Label htmlFor="c-min">Pedido mín. (R$)</Label>
                <Input id="c-min" type="number" step="0.01" min="0" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} />
              </div>
              {form.type === 'percent' && (
                <div>
                  <Label htmlFor="c-cap">Desc. máx. (R$)</Label>
                  <Input id="c-cap" type="number" step="0.01" min="0" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} placeholder="Opcional" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-maxuses">Usos totais</Label>
                <Input id="c-maxuses" type="number" min="1" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="Ilimitado" />
              </div>
              <div>
                <Label htmlFor="c-peruser">Por cliente</Label>
                <Input id="c-peruser" type="number" min="1" value={form.max_uses_per_user} onChange={(e) => setForm({ ...form, max_uses_per_user: e.target.value })} placeholder="1" />
              </div>
            </div>
            <div>
              <Label htmlFor="c-expires">Expira em (opcional)</Label>
              <Input id="c-expires" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="c-cat">Categoria (opcional)</Label>
              <Input id="c-cat" value={form.applies_to_category} onChange={(e) => setForm({ ...form, applies_to_category: e.target.value })} placeholder="valorant, roblox, league-of-legends ou vazio (todas)" />
            </div>
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch id="c-active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label htmlFor="c-active" className="cursor-pointer">Ativo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="c-first" checked={form.first_purchase_only} onCheckedChange={(v) => setForm({ ...form, first_purchase_only: v })} />
                <Label htmlFor="c-first" className="cursor-pointer">Só 1ª compra</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
