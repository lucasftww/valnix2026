import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Plus, Edit, Trash2, GripVertical, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { ImageUploader } from "./ImageUploader";
import type { Category } from "@/types";

interface CategoryNode extends Category {
  children: CategoryNode[];
}

export const CategoryManager = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [parentCategory, setParentCategory] = useState<Category | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    is_active: true,
    show_on_homepage: true,
    image_url: "",
    parent_id: null as string | null,
  });

  // Load categories from Firestore
  const loadCategories = async () => {
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, "categories"));
      const allCats = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Category[];

      // Build tree
      const map = new Map<string, CategoryNode>();
      const roots: CategoryNode[] = [];

      allCats
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .forEach((c) => map.set(c.id, { ...c, children: [] }));

      allCats.forEach((c) => {
        const node = map.get(c.id)!;
        if (c.parent_id && map.has(c.parent_id)) {
          map.get(c.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      setCategories(roots);
    } catch (err) {
      console.error("Error loading categories:", err);
      toast({ title: "Erro", description: "Falha ao carregar categorias", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    loadCategories();
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORIES] });
    loadCategories();
  };

  const openDialog = (category?: Category, parent?: Category) => {
    if (category) {
      setEditingCategory(category);
      setParentCategory(null);
      setFormData({
        name: category.name,
        slug: category.slug,
        is_active: category.is_active,
        show_on_homepage: category.show_on_homepage ?? true,
        image_url: category.image_url || "",
        parent_id: category.parent_id,
      });
    } else if (parent) {
      setEditingCategory(null);
      setParentCategory(parent);
      setFormData({
        name: "",
        slug: "",
        is_active: true,
        show_on_homepage: true,
        image_url: "",
        parent_id: parent.id,
      });
    } else {
      setEditingCategory(null);
      setParentCategory(null);
      setFormData({
        name: "",
        slug: "",
        is_active: true,
        show_on_homepage: true,
        image_url: "",
        parent_id: null,
      });
    }
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingCategory(null);
    setParentCategory(null);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.slug) {
      toast({ title: "Erro", description: "Nome e Slug são obrigatórios", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const data: any = {
        name: formData.name,
        slug: formData.slug,
        is_active: formData.is_active,
        show_on_homepage: formData.show_on_homepage,
        image_url: formData.image_url || null,
        parent_id: formData.parent_id,
      };

      if (editingCategory) {
        await updateDoc(doc(db, "categories", editingCategory.id), {
          ...data,
          updated_at: new Date().toISOString(),
        });
        toast({ title: "Sucesso", description: "Categoria atualizada!" });
      } else {
        const newRef = doc(collection(db, "categories"));
        await setDoc(newRef, {
          ...data,
          display_order: categories.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          icon_url: null,
          description: null,
        });
        toast({ title: "Sucesso", description: "Categoria criada!" });
      }

      closeDialog();
      invalidate();
    } catch (err: any) {
      console.error("Error saving category:", err);
      toast({ title: "Erro", description: err.message || "Falha ao salvar", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta categoria?")) return;
    try {
      await deleteDoc(doc(db, "categories", id));
      toast({ title: "Sucesso", description: "Categoria excluída!" });
      invalidate();
    } catch (err) {
      toast({ title: "Erro", description: "Falha ao excluir categoria", variant: "destructive" });
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const items = [...categories];
    const [removed] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, removed);
    setCategories(items);

    try {
      const batch = writeBatch(db);
      items.forEach((item, index) => {
        batch.update(doc(db, "categories", item.id), { display_order: index });
      });
      await batch.commit();
      toast({ title: "Sucesso", description: "Ordem atualizada!" });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORIES] });
    } catch (err) {
      console.error("Error reordering:", err);
      toast({ title: "Erro", description: "Falha ao reordenar", variant: "destructive" });
    }
  };

  const toggleExpanded = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(categoryId) ? next.delete(categoryId) : next.add(categoryId);
      return next;
    });
  };

  const renderCategory = (category: CategoryNode, level: number = 0, index?: number, providedProps?: any) => {
    const hasChildren = category.children.length > 0;
    const isExpanded = expandedCategories.has(category.id);

    return (
      <div key={category.id}>
        <Card
          ref={providedProps?.innerRef}
          {...providedProps?.draggableProps}
          className="overflow-hidden hover:shadow-md transition-shadow mb-3"
          style={{ marginLeft: `${level * 24}px`, ...providedProps?.draggableProps?.style }}
        >
          <div className="flex items-center gap-3 p-4">
            <div {...providedProps?.dragHandleProps} className="cursor-grab active:cursor-grabbing">
              <GripVertical className="h-5 w-5 text-muted-foreground" />
            </div>

            {hasChildren ? (
              <Button variant="ghost" size="sm" onClick={() => toggleExpanded(category.id)} className="h-8 w-8 p-0">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            ) : (
              <div className="w-8" />
            )}

            {category.image_url && (
              <div className="flex-shrink-0">
                <img src={category.image_url} alt="" className="h-10 w-10 object-contain rounded" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground flex items-center gap-2">
                {category.name}
                {level > 0 && <span className="text-xs text-muted-foreground">(Sub)</span>}
              </div>
              <div className="text-sm text-muted-foreground truncate">{category.slug}</div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-col items-end gap-1">
                <Switch checked={category.is_active} disabled />
                <span className="text-xs text-muted-foreground">{category.is_active ? "Ativa" : "Inativa"}</span>
              </div>

              {level === 0 && (
                <Button variant="outline" size="sm" onClick={() => openDialog(undefined, category)} className="h-9 gap-2">
                  <Plus className="h-4 w-4" />
                  Sub
                </Button>
              )}

              <Button variant="ghost" size="sm" onClick={() => openDialog(category)} className="h-9 w-9 p-0">
                <Edit className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(category.id)}
                className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        {hasChildren && isExpanded && (
          <div className="ml-6">
            {category.children.map((child) => renderCategory(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Organize as categorias da sua loja</p>
        <Button onClick={() => openDialog()} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Categoria
        </Button>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="categories">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
              {categories.map((category, index) => (
                <Draggable key={category.id} draggableId={category.id} index={index}>
                  {(dragProvided) => renderCategory(category, 0, index, dragProvided)}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {categories.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhuma categoria encontrada.</p>
          <p className="text-sm mt-1">Crie a primeira categoria para começar.</p>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingCategory
                ? "Editar Categoria"
                : parentCategory
                  ? `Nova Subcategoria de "${parentCategory.name}"`
                  : "Nova Categoria"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setFormData({ ...formData, name, slug: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") });
                }}
              />
            </div>

            <div>
              <Label htmlFor="slug">Slug *</Label>
              <Input id="slug" value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value })} />
            </div>

            <div>
              <Label>Imagem da Categoria</Label>
              <ImageUploader
                currentImageUrl={formData.image_url}
                onImageUploaded={(url) => setFormData({ ...formData, image_url: url })}
                folder="categories"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch id="is_active" checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
              <Label htmlFor="is_active">Ativa</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="show_on_homepage" checked={formData.show_on_homepage} onCheckedChange={(checked) => setFormData({ ...formData, show_on_homepage: checked })} />
              <Label htmlFor="show_on_homepage">Mostrar na Tela Inicial</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingCategory ? "Atualizar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
