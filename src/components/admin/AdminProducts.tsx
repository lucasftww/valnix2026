import { useState, useEffect, lazy, Suspense } from "react";
import { auth } from "@/integrations/firebase/config";
import { invokeFunction } from "@/lib/apiHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Video, Image as ImageIcon, Copy } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
const ReactQuill = lazy(() => import('react-quill'));
import 'react-quill/dist/quill.snow.css';
import { ImageUploader } from "./ImageUploader";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/constants";

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  rich_description: string | null;
  video_url: string | null;
  price: number;
  old_price: number | null;
  discount: number | null;
  category: string;
  image_url: string | null;
  icon_url: string | null;
  stock: number;
  sold: number;
  is_active: boolean;
  featured: boolean;
  display_order: number;
  is_featured_in_category: boolean;
  delivery_type: string;
  auto_delivery_codes: string[] | null;
  instructions?: string | null;
  terms_conditions?: string | null;
}

const getFirebaseToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
};

export const AdminProducts = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    rich_description: "",
    instructions: "",
    terms_conditions: "",
    video_url: "",
    price: "",
    old_price: "",
    discount: "",
    category: "",
    image_url: "",
    icon_url: "",
    sold: "0",
    display_order: "0",
    featured: false,
    delivery_type: "manual",
    auto_delivery_codes: [] as string[],
  });

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const token = await getFirebaseToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'categories' },
        headers: { 'x-firebase-token': token },
      });
      if (!response.ok) throw new Error('Failed to fetch categories');
      const data = await response.json();
      const categoriesData = (data.categories || [])
        .filter((c: any) => c.is_active !== false)
        .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
      setCategories(categoriesData);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar categorias",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const fetchProducts = async () => {
    try {
      const token = await getFirebaseToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'products' },
        headers: { 'x-firebase-token': token },
      });
      if (!response.ok) throw new Error('Failed to fetch products');
      const data = await response.json();
      const productsData = (data.products || [])
        .sort((a: any, b: any) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });
      setProducts(productsData);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar produtos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.BEST_SELLING] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.CATEGORY_PRODUCTS] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const now = new Date().toISOString();
    const productData = {
      name: formData.name,
      description: formData.description || null,
      rich_description: formData.rich_description || null,
      instructions: formData.instructions || null,
      terms_conditions: formData.terms_conditions || null,
      video_url: formData.video_url || null,
      price: parseFloat(formData.price),
      old_price: formData.old_price ? parseFloat(formData.old_price) : null,
      discount: formData.discount ? parseInt(formData.discount) : null,
      category: formData.category,
      image_url: formData.image_url || null,
      icon_url: formData.icon_url || null,
      stock: 999999,
      sold: parseInt(formData.sold),
      display_order: parseInt(formData.display_order),
      featured: formData.featured,
      is_active: true,
      is_featured_in_category: false,
      delivery_type: formData.delivery_type,
      auto_delivery_codes: formData.auto_delivery_codes.length > 0 ? formData.auto_delivery_codes : null,
      updated_at: now,
    };

    try {
      const token = await getFirebaseToken();
      if (editingProduct) {
        const res = await invokeFunction('admin-data', {
          method: 'PUT',
          queryParams: { resource: 'products' },
          headers: { 'x-firebase-token': token },
          body: { id: editingProduct.id, ...productData },
        });
        if (!res.ok) throw new Error('Failed to update product');
        
        toast({
          title: "Produto atualizado!",
          description: "O produto foi atualizado com sucesso.",
        });
      } else {
        const newId = crypto.randomUUID();
        const res = await invokeFunction('admin-data', {
          method: 'POST',
          queryParams: { resource: 'products' },
          headers: { 'x-firebase-token': token },
          body: { id: newId, ...productData, created_at: now },
        });
        if (!res.ok) throw new Error('Failed to create product');
        
        toast({
          title: "Produto criado!",
          description: "O produto foi adicionado com sucesso.",
        });
      }

      setDialogOpen(false);
      resetForm();
      fetchProducts();
      invalidateQueries();
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name || "",
      description: product.description || "",
      rich_description: product.rich_description || "",
      instructions: product.instructions || "",
      terms_conditions: product.terms_conditions || "",
      video_url: product.video_url || "",
      price: product.price != null ? product.price.toString() : "",
      old_price: product.old_price != null ? product.old_price.toString() : "",
      discount: product.discount != null ? product.discount.toString() : "",
      category: product.category || "",
      image_url: product.image_url || "",
      icon_url: product.icon_url || "",
      sold: product.sold != null ? product.sold.toString() : "0",
      display_order: product.display_order != null ? product.display_order.toString() : "0",
      featured: product.featured || false,
      delivery_type: product.delivery_type || "manual",
      auto_delivery_codes: product.auto_delivery_codes || [],
    });
    setDialogOpen(true);
  };

  const handleDuplicate = async (product: Product) => {
    try {
      const now = new Date().toISOString();
      const newId = crypto.randomUUID();
      const duplicatedProduct = {
        name: `${product.name} - Cópia`,
        description: product.description,
        rich_description: product.rich_description,
        video_url: product.video_url,
        price: product.price,
        old_price: product.old_price,
        discount: product.discount,
        category: product.category,
        image_url: product.image_url,
        icon_url: product.icon_url,
        stock: 999999,
        sold: 0,
        display_order: product.display_order,
        featured: false,
        is_active: true,
        is_featured_in_category: false,
        delivery_type: product.delivery_type,
        auto_delivery_codes: product.auto_delivery_codes,
        instructions: product.instructions,
        terms_conditions: product.terms_conditions,
        created_at: now,
        updated_at: now,
      };

      const token = await getFirebaseToken();
      const res = await invokeFunction('admin-data', {
        method: 'POST',
        queryParams: { resource: 'products' },
        headers: { 'x-firebase-token': token },
        body: { id: newId, ...duplicatedProduct },
      });
      if (!res.ok) throw new Error('Failed to duplicate product');

      toast({
        title: "Produto duplicado!",
        description: "O produto foi duplicado com sucesso.",
      });

      const newProduct = { id: newId, ...duplicatedProduct } as Product;
      handleEdit(newProduct);
      
      fetchProducts();
      invalidateQueries();
    } catch (error: any) {
      toast({
        title: "Erro ao duplicar",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;

    try {
      const token = await getFirebaseToken();
      const res = await invokeFunction('admin-data', {
        method: 'DELETE',
        queryParams: { resource: 'products', id },
        headers: { 'x-firebase-token': token },
      });
      if (!res.ok) throw new Error('Failed to delete product');

      toast({
        title: "Produto excluído!",
        description: "O produto foi removido com sucesso.",
      });

      fetchProducts();
      invalidateQueries();
    } catch (error: any) {
      toast({
        title: "Erro ao excluir",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleFeatured = async (product: Product) => {
    const newFeatured = !product.featured;
    
    // Optimistic update - update only this product locally
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, featured: newFeatured } : p));
    
    try {
      const token = await getFirebaseToken();
      const res = await invokeFunction('admin-data', {
        method: 'PUT',
        queryParams: { resource: 'products' },
        headers: { 'x-firebase-token': token },
        body: { id: product.id, featured: newFeatured, updated_at: new Date().toISOString() },
      });
      if (!res.ok) throw new Error('Failed to toggle featured');
      
      toast({
        title: newFeatured ? "Adicionado aos Mais Vendidos" : "Removido dos Mais Vendidos",
        description: `${product.name} foi ${newFeatured ? "adicionado aos" : "removido de"} Mais Vendidos.`,
      });
      
      invalidateQueries();
    } catch (error: any) {
      // Revert on error
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, featured: product.featured } : p));
      toast({
        title: "Erro ao atualizar",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      rich_description: "",
      instructions: "",
      terms_conditions: "",
      video_url: "",
      price: "",
      old_price: "",
      discount: "",
      category: "",
      image_url: "",
      icon_url: "",
      sold: "0",
      display_order: "0",
      featured: false,
      delivery_type: "manual",
      auto_delivery_codes: [],
    });
    setEditingProduct(null);
  };

  if (loading) {
    return <div>Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Gerencie os produtos da sua loja</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4 mr-2" />
              Novo Produto
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-5 bg-neutral-900 border border-border/30">
                  <TabsTrigger value="basic" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Básico</TabsTrigger>
                  <TabsTrigger value="delivery" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Entrega</TabsTrigger>
                  <TabsTrigger value="description" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Descrição</TabsTrigger>
                  <TabsTrigger value="extra" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Instruções</TabsTrigger>
                  <TabsTrigger value="media" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Mídia</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome do Produto *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ex: 1200 VP Valorant"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Categoria *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({ ...formData, category: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.slug}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="price">Preço (R$) *</Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="old_price">Preço Antigo (R$)</Label>
                      <Input
                        id="old_price"
                        type="number"
                        step="0.01"
                        value={formData.old_price}
                        onChange={(e) => setFormData({ ...formData, old_price: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="discount">Desconto (%)</Label>
                      <Input
                        id="discount"
                        type="number"
                        value={formData.discount}
                        onChange={(e) => setFormData({ ...formData, discount: e.target.value })}
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sold">Vendidos</Label>
                      <Input
                        id="sold"
                        type="number"
                        value={formData.sold}
                        onChange={(e) => setFormData({ ...formData, sold: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="display_order">Ordem de Exibição</Label>
                    <Input
                      id="display_order"
                      type="number"
                      value={formData.display_order}
                      onChange={(e) => setFormData({ ...formData, display_order: e.target.value })}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Menor número aparece primeiro</p>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="featured">Aparecer em Mais Vendidos</Label>
                        <p className="text-xs text-muted-foreground">Exibe na seção da página inicial</p>
                      </div>
                      <Switch
                        id="featured"
                        checked={formData.featured}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, featured: checked })
                        }
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="delivery" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="delivery_type">Tipo de Entrega</Label>
                    <Select
                      value={formData.delivery_type}
                      onValueChange={(value) => setFormData({ ...formData, delivery_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo de entrega" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual - Admin entrega</SelectItem>
                        <SelectItem value="auto_fake">Automática Fake - Códigos aleatórios</SelectItem>
                        <SelectItem value="auto_real">Automática Real - Códigos pré-cadastrados</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {formData.delivery_type === 'manual' && 'Você irá fornecer o código manualmente após a compra'}
                      {formData.delivery_type === 'auto_fake' && 'Sistema gera códigos aleatórios automaticamente (formato: XXXX-XXXX-XXXX-XXXX)'}
                      {formData.delivery_type === 'auto_real' && 'Sistema usa códigos reais cadastrados abaixo'}
                    </p>
                  </div>

                  {formData.delivery_type === 'auto_real' && (
                    <div className="space-y-2">
                      <Label>Códigos de Entrega</Label>
                      <div className="space-y-2">
                        {formData.auto_delivery_codes.map((code, index) => (
                          <div key={index} className="flex gap-2">
                            <Input
                              value={code}
                              onChange={(e) => {
                                const newCodes = [...formData.auto_delivery_codes];
                                newCodes[index] = e.target.value;
                                setFormData({ ...formData, auto_delivery_codes: newCodes });
                              }}
                              placeholder="Digite o código"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              onClick={() => {
                                const newCodes = formData.auto_delivery_codes.filter((_, i) => i !== index);
                                setFormData({ ...formData, auto_delivery_codes: newCodes });
                              }}
                              aria-label="Remover código"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              auto_delivery_codes: [...formData.auto_delivery_codes, '']
                            });
                          }}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Adicionar Código
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Estoque disponível: {formData.auto_delivery_codes.filter(c => c.trim()).length} códigos
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="description" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label className="text-foreground font-semibold">Descrição Completa (Com Imagens)</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Esta é a descrição principal que aparece na aba "Descrição" do produto
                    </p>
                    <div className="border border-border/50 rounded-md bg-neutral-900 overflow-hidden">
                      <Suspense fallback={<div className="min-h-[250px] bg-neutral-800 animate-pulse rounded" />}>
                        <ReactQuill
                          theme="snow"
                          value={formData.rich_description || ""}
                          onChange={(value: string) => { setFormData(prev => ({ ...prev, rich_description: value })); }}
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline', 'strike'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              ['link', 'image'],
                              [{ 'align': [] }],
                              [{ 'color': [] }, { 'background': [] }],
                              ['clean']
                            ]
                          }}
                          className="min-h-[250px] [&_.ql-toolbar]:bg-neutral-800 [&_.ql-toolbar]:border-border/50 [&_.ql-container]:border-border/50 [&_.ql-editor]:text-foreground [&_.ql-editor]:min-h-[200px]"
                          placeholder="Escreva a descrição completa do produto..."
                        />
                      </Suspense>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" />
                      Use o ícone de imagem na barra para adicionar fotos à descrição
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="extra" className="space-y-6 pt-4">
                  <div className="space-y-2">
                    <Label className="text-foreground font-semibold">Instruções de Uso</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Estas instruções aparecem na aba "Instruções" do produto
                    </p>
                    <div className="border border-border/50 rounded-md bg-neutral-900 overflow-hidden">
                      <Suspense fallback={<div className="min-h-[180px] bg-neutral-800 animate-pulse rounded" />}>
                        <ReactQuill
                          theme="snow"
                          value={formData.instructions || ""}
                          onChange={(value: string) => { setFormData(prev => ({ ...prev, instructions: value })); }}
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              ['link'],
                              ['clean']
                            ]
                          }}
                          className="min-h-[180px] [&_.ql-toolbar]:bg-neutral-800 [&_.ql-toolbar]:border-border/50 [&_.ql-container]:border-border/50 [&_.ql-editor]:text-foreground [&_.ql-editor]:min-h-[130px]"
                          placeholder="Ex: 1. Acesse o site oficial. 2. Faça login na sua conta..."
                        />
                      </Suspense>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-foreground font-semibold">Termos e Condições</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Aparece na aba "Terms conditions" do produto (opcional)
                    </p>
                    <div className="border border-border/50 rounded-md bg-neutral-900 overflow-hidden">
                      <Suspense fallback={<div className="min-h-[180px] bg-neutral-800 animate-pulse rounded" />}>
                        <ReactQuill
                          theme="snow"
                          value={formData.terms_conditions || ""}
                          onChange={(value: string) => { setFormData(prev => ({ ...prev, terms_conditions: value })); }}
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              ['link'],
                              ['clean']
                            ]
                          }}
                          className="min-h-[180px] [&_.ql-toolbar]:bg-neutral-800 [&_.ql-toolbar]:border-border/50 [&_.ql-container]:border-border/50 [&_.ql-editor]:text-foreground [&_.ql-editor]:min-h-[130px]"
                          placeholder="Ex: Este produto é apenas para uso pessoal..."
                        />
                      </Suspense>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="media" className="space-y-6">
                  <div className="space-y-2">
                    <Label>Imagem Principal do Produto *</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Esta é a imagem que aparece nos cards de produto
                    </p>
                    <ImageUploader
                      currentImageUrl={formData.image_url}
                      onImageUploaded={(url) => setFormData({ ...formData, image_url: url })}
                      folder="products/main"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      <ImageIcon className="w-4 h-4 inline mr-2" />
                      Imagem Adicional (Opcional)
                    </Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Imagem extra para usar na descrição ou galeria
                    </p>
                    <ImageUploader
                      currentImageUrl={formData.icon_url}
                      onImageUploaded={(url) => setFormData({ ...formData, icon_url: url })}
                      folder="products/extra"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="video_url">
                      <Video className="w-4 h-4 inline mr-2" />
                      Vídeo do Produto (Opcional)
                    </Label>
                    <Input
                      id="video_url"
                      type="url"
                      value={formData.video_url}
                      onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                      placeholder="https://youtube.com/embed/..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Cole o link embed do YouTube (formato: https://youtube.com/embed/VIDEO_ID)
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              <Button type="submit" className="w-full" size="lg">
                {editingProduct ? "Atualizar Produto" : "Criar Produto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {products.map((product) => (
          <Card key={product.id} className="overflow-hidden hover:shadow-lg transition-shadow bg-card border-border/50">
            <CardHeader className="pb-3 bg-neutral-900/50">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-lg line-clamp-2 text-foreground">{product.name}</CardTitle>
                <div className="flex items-center gap-2">
                  {product.featured && (
                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                      DESTAQUE
                    </span>
                  )}
                  <Switch checked={product.is_active} disabled className="data-[state=checked]:bg-green-500" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {product.image_url && (
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-neutral-800 border border-border/30">
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1 bg-neutral-900/50 rounded-lg p-2">
                  <p className="text-muted-foreground text-xs">Preço</p>
                  <p className="font-semibold text-primary">R$ {product.price?.toFixed(2) || "0.00"}</p>
                </div>
                <div className="space-y-1 bg-neutral-900/50 rounded-lg p-2">
                  <p className="text-muted-foreground text-xs">Vendas</p>
                  <p className="font-medium text-foreground">{product.sold || 0}</p>
                </div>
                <div className="space-y-1 bg-neutral-900/50 rounded-lg p-2">
                  <p className="text-muted-foreground text-xs">Categoria</p>
                  <p className="font-medium truncate text-foreground">{product.category}</p>
                </div>
                <div className="space-y-1 bg-neutral-900/50 rounded-lg p-2">
                  <p className="text-muted-foreground text-xs">Ordem</p>
                  <p className="font-medium text-foreground">{product.display_order || 0}</p>
                </div>
              </div>
              
              {/* Toggle Mais Vendidos */}
              <div className="flex items-center justify-between p-2 bg-neutral-900/50 rounded-lg">
                <span className="text-xs text-muted-foreground">Mais Vendidos</span>
                <Switch
                  checked={product.featured || false}
                  onCheckedChange={() => handleToggleFeatured(product)}
                  className="data-[state=checked]:bg-primary"
                />
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(product)}
                  className="flex-1 bg-neutral-900 border-border/50 hover:bg-neutral-800"
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDuplicate(product)}
                  className="flex-1 bg-neutral-900 border-border/50 hover:bg-neutral-800"
                  title="Duplicar produto"
                >
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Duplicar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(product.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
