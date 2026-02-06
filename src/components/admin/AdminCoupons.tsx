import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, Tag, Percent, DollarSign, Calendar, Users } from "lucide-react";
import { toast } from "sonner";
import { AdminCard } from "./AdminCard";
import { AdminEmptyState } from "./AdminEmptyState";
import { AdminPageHeader } from "./AdminPageHeader";
import { cn } from "@/lib/utils";

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  min_purchase_amount: number;
  max_uses: number | null;
  current_uses: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export const AdminCoupons = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    code: "",
    description: "",
    discount_type: "percentage" as "percentage" | "fixed",
    discount_value: "",
    min_purchase_amount: "0",
    max_uses: "",
    expires_at: "",
    is_active: true,
  });

  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coupons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Coupon[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("coupons").insert({
        code: data.code.toUpperCase(),
        description: data.description || null,
        discount_type: data.discount_type,
        discount_value: parseFloat(data.discount_value),
        min_purchase_amount: parseFloat(data.min_purchase_amount),
        max_uses: data.max_uses ? parseInt(data.max_uses) : null,
        expires_at: data.expires_at || null,
        is_active: data.is_active,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      toast.success("Cupom criado com sucesso!");
      resetForm();
      setIsDialogOpen(false);
    },
    onError: () => {
      toast.error("Erro ao criar cupom");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const { error } = await supabase
        .from("coupons")
        .update({
          code: data.code.toUpperCase(),
          description: data.description || null,
          discount_type: data.discount_type,
          discount_value: parseFloat(data.discount_value),
          min_purchase_amount: parseFloat(data.min_purchase_amount),
          max_uses: data.max_uses ? parseInt(data.max_uses) : null,
          expires_at: data.expires_at || null,
          is_active: data.is_active,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      toast.success("Cupom atualizado com sucesso!");
      resetForm();
      setIsDialogOpen(false);
    },
    onError: () => {
      toast.error("Erro ao atualizar cupom");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coupons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      toast.success("Cupom excluído com sucesso!");
    },
    onError: () => {
      toast.error("Erro ao excluir cupom");
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      description: "",
      discount_type: "percentage",
      discount_value: "",
      min_purchase_amount: "0",
      max_uses: "",
      expires_at: "",
      is_active: true,
    });
    setEditingCoupon(null);
  };

  const handleEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setFormData({
      code: coupon.code,
      description: coupon.description || "",
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value.toString(),
      min_purchase_amount: coupon.min_purchase_amount.toString(),
      max_uses: coupon.max_uses?.toString() || "",
      expires_at: coupon.expires_at ? coupon.expires_at.split("T")[0] : "",
      is_active: coupon.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCoupon) {
      updateMutation.mutate({ id: editingCoupon.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const activeCoupons = coupons.filter(c => c.is_active).length;
  const totalUses = coupons.reduce((sum, c) => sum + c.current_uses, 0);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative">
          <div className="w-12 h-12 border-4 border-primary/20 rounded-full" />
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute top-0" />
        </div>
        <p className="text-muted-foreground mt-4">Carregando cupons...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        description={`${coupons.length} cupons cadastrados`}
        action={{
          label: "Novo Cupom",
          icon: Plus,
          onClick: () => {
            resetForm();
            setIsDialogOpen(true);
          }
        }}
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Tag className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{coupons.length}</p>
            <p className="text-sm text-muted-foreground">Total de Cupons</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20">
          <div className="h-10 w-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Percent className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{activeCoupons}</p>
            <p className="text-sm text-muted-foreground">Cupons Ativos</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20">
          <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Users className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{totalUses}</p>
            <p className="text-sm text-muted-foreground">Total de Usos</p>
          </div>
        </div>
      </div>

      {/* Coupons Table */}
      <AdminCard title="Lista de Cupons" icon={Tag}>
        {coupons.length === 0 ? (
          <AdminEmptyState
            icon={Tag}
            title="Nenhum cupom cadastrado"
            description="Crie cupons promocionais para oferecer descontos aos seus clientes"
            actionLabel="Criar Cupom"
            onAction={() => {
              resetForm();
              setIsDialogOpen(true);
            }}
          />
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Código</TableHead>
                  <TableHead>Desconto</TableHead>
                  <TableHead className="hidden md:table-cell">Mín. Compra</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead className="hidden lg:table-cell">Expira em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon) => (
                  <TableRow key={coupon.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Tag className="w-4 h-4 text-primary" />
                        </div>
                        <span className="font-mono font-bold">{coupon.code}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary" 
                        className={cn(
                          "font-bold",
                          coupon.discount_type === "percentage" 
                            ? "bg-purple-500/10 text-purple-600" 
                            : "bg-green-500/10 text-green-600"
                        )}
                      >
                        {coupon.discount_type === "percentage" ? (
                          <><Percent className="h-3 w-3 mr-1" />{coupon.discount_value}%</>
                        ) : (
                          <><DollarSign className="h-3 w-3 mr-1" />R$ {coupon.discount_value.toFixed(2)}</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      R$ {coupon.min_purchase_amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {coupon.current_uses}/{coupon.max_uses || "∞"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {coupon.expires_at ? (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          {new Date(coupon.expires_at).toLocaleDateString("pt-BR")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Sem expiração</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={coupon.is_active ? "default" : "secondary"}>
                        {coupon.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(coupon)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Tem certeza que deseja excluir este cupom?")) {
                              deleteMutation.mutate(coupon.id);
                            }
                          }}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </AdminCard>

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCoupon ? "Editar Cupom" : "Criar Novo Cupom"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="code">Código do Cupom *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                placeholder="DESCONTO10"
                required
              />
            </div>

            <div>
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="10% de desconto em todos os produtos"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="discount_type">Tipo de Desconto *</Label>
                <Select
                  value={formData.discount_type}
                  onValueChange={(value: "percentage" | "fixed") =>
                    setFormData({ ...formData, discount_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Porcentagem (%)</SelectItem>
                    <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="discount_value">
                  Valor do Desconto * ({formData.discount_type === "percentage" ? "%" : "R$"})
                </Label>
                <Input
                  id="discount_value"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.discount_value}
                  onChange={(e) =>
                    setFormData({ ...formData, discount_value: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="min_purchase_amount">Valor Mínimo de Compra (R$)</Label>
                <Input
                  id="min_purchase_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.min_purchase_amount}
                  onChange={(e) =>
                    setFormData({ ...formData, min_purchase_amount: e.target.value })
                  }
                />
              </div>

              <div>
                <Label htmlFor="max_uses">Máximo de Usos (opcional)</Label>
                <Input
                  id="max_uses"
                  type="number"
                  min="1"
                  value={formData.max_uses}
                  onChange={(e) =>
                    setFormData({ ...formData, max_uses: e.target.value })
                  }
                  placeholder="Ilimitado"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="expires_at">Data de Expiração (opcional)</Label>
              <Input
                id="expires_at"
                type="date"
                value={formData.expires_at}
                onChange={(e) =>
                  setFormData({ ...formData, expires_at: e.target.value })
                }
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
              <Label htmlFor="is_active">Cupom Ativo</Label>
            </div>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingCoupon ? "Atualizar" : "Criar"} Cupom
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm();
                  setIsDialogOpen(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};