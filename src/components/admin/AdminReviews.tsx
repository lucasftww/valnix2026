import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabaseHelper";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import { useCategories } from "@/hooks/firebase";

interface Review {
  id: string;
  product_id: string | null;
  category: string;
  customer_name: string;
  rating: number;
  comment: string;
  display_order: number;
}

const AdminReviews = () => {
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  
  const [formData, setFormData] = useState({
    category: "",
    customer_name: "",
    rating: 5,
    comment: "",
    display_order: 0,
  });

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .from("product_reviews")
        .select("*")
        .order("display_order", { ascending: true });

      if (error) throw error;
      setReviews(data || []);
    } catch (error) {
      console.error("Erro ao buscar avaliações:", error);
      toast({
        title: "Erro",
        description: "Erro ao carregar avaliações",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getCategoryName = (categorySlug: string) => {
    const category = categories.find(c => c.slug === categorySlug);
    return category?.name || categorySlug;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingReview) {
        const { error } = await supabase
          .from("product_reviews")
          .update(formData)
          .eq("id", editingReview.id);

        if (error) throw error;
        toast({
          title: "Sucesso",
          description: "Avaliação atualizada!"
        });
      } else {
        const { error } = await supabase
          .from("product_reviews")
          .insert([formData]);

        if (error) throw error;
        toast({
          title: "Sucesso",
          description: "Avaliação criada!"
        });
      }

      setDialogOpen(false);
      resetForm();
      fetchReviews();
    } catch (error) {
      console.error("Erro ao salvar avaliação:", error);
      toast({
        title: "Erro",
        description: "Erro ao salvar avaliação",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (review: Review) => {
    setEditingReview(review);
    setFormData({
      category: review.category,
      customer_name: review.customer_name,
      rating: review.rating,
      comment: review.comment,
      display_order: review.display_order,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta avaliação?")) return;

    try {
      const { error } = await supabase
        .from("product_reviews")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast({
        title: "Sucesso",
        description: "Avaliação excluída!"
      });
      fetchReviews();
    } catch (error) {
      console.error("Erro ao excluir avaliação:", error);
      toast({
        title: "Erro",
        description: "Erro ao excluir avaliação",
        variant: "destructive"
      });
    }
  };

  const resetForm = () => {
    setEditingReview(null);
    setFormData({
      category: "",
      customer_name: "",
      rating: 5,
      comment: "",
      display_order: 0,
    });
  };

  if (loading) return <p>Carregando...</p>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Gerenciar Avaliações</h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Nova Avaliação
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingReview ? "Editar Avaliação" : "Nova Avaliação"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category">Categoria *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value })
                  }
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma categoria" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.slug}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Esta avaliação aparecerá em todos os produtos desta categoria
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="customer_name">Nome do Cliente *</Label>
                <Input
                  id="customer_name"
                  value={formData.customer_name}
                  onChange={(e) =>
                    setFormData({ ...formData, customer_name: e.target.value })
                  }
                  placeholder="Ex: João Silva"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rating">Avaliação (Estrelas) *</Label>
                <Select
                  value={formData.rating.toString()}
                  onValueChange={(value) =>
                    setFormData({ ...formData, rating: parseInt(value) })
                  }
                  required
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 4, 3, 2, 1].map((stars) => (
                      <SelectItem key={stars} value={stars.toString()}>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: stars }).map((_, i) => (
                            <Star key={i} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                          ))}
                          {Array.from({ length: 5 - stars }).map((_, i) => (
                            <Star key={i} className="w-4 h-4 text-muted-foreground" />
                          ))}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comment">Comentário *</Label>
                <Textarea
                  id="comment"
                  value={formData.comment}
                  onChange={(e) =>
                    setFormData({ ...formData, comment: e.target.value })
                  }
                  placeholder="Ex: Produto excelente, entrega rápida!"
                  rows={4}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="display_order">Ordem de Exibição</Label>
                <Input
                  id="display_order"
                  type="number"
                  value={formData.display_order}
                  onChange={(e) =>
                    setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })
                  }
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  Menor número aparece primeiro
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit">
                  {editingReview ? "Atualizar" : "Criar"} Avaliação
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {reviews.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">
              Nenhuma avaliação cadastrada ainda.
            </p>
          </Card>
        ) : (
          reviews.map((review) => (
            <Card key={review.id} className="p-6">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold">{review.customer_name}</h3>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= review.rating
                              ? 'fill-yellow-500 text-yellow-500'
                              : 'text-muted-foreground'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong>Categoria:</strong> {getCategoryName(review.category)}
                  </p>
                  <p className="text-sm">{review.comment}</p>
                  <p className="text-xs text-muted-foreground">
                    Ordem: {review.display_order}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleEdit(review)}
                    aria-label="Editar avaliação"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleDelete(review.id)}
                    aria-label="Excluir avaliação"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminReviews;