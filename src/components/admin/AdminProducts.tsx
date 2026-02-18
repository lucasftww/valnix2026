import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { invokeFunction } from "@/lib/apiHelper";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Video, Image as ImageIcon, Copy, Search, Filter, ChevronLeft, ChevronRight, ChevronDown, Package } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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

export const AdminProducts = () => {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: products = [], isLoading: loadingProducts, refetch: refetchProducts } = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => {
      const token = requireAdminToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'products' },
        headers: { 'x-admin-token': token },
      });
      if (!response.ok) throw new Error('Failed to fetch products');
      const data = await response.json();
      return (data.products || []).sort((a: any, b: any) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
    },
    enabled: isAdmin && !authLoading,
    staleTime: 60000,
    retry: false,
  });

  const { data: categories = [], refetch: refetchCategories } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => {
      const token = requireAdminToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'categories' },
        headers: { 'x-admin-token': token },
      });
      if (!response.ok) throw new Error('Failed to fetch categories');
      const data = await response.json();
      return (data.categories || [])
        .filter((c: any) => c.is_active !== false)
        .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
    },
    enabled: isAdmin && !authLoading,
    staleTime: 120000,
    retry: false,
  });

  const loading = loadingProducts;
  const fetchProducts = useCallback(() => { refetchProducts(); }, [refetchProducts]);
  const fetchCategories = useCallback(() => { refetchCategories(); }, [refetchCategories]);

  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterActive, setFilterActive] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 12;

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
      const token = requireAdminToken();
      if (editingProduct) {
        const res = await invokeFunction('admin-data', {
          method: 'PUT',
          queryParams: { resource: 'products' },
          headers: { 'x-admin-token': token },
          body: { id: editingProduct.id, ...productData },
        });
        if (!res.ok) throw new Error('Failed to update product');
      } else {
        const newId = crypto.randomUUID();
        const res = await invokeFunction('admin-data', {
          method: 'POST',
          queryParams: { resource: 'products' },
          headers: { 'x-admin-token': token },
          body: { id: newId, ...productData, created_at: now },
        });
        if (!res.ok) throw new Error('Failed to create product');
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

      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'POST',
        queryParams: { resource: 'products' },
        headers: { 'x-admin-token': token },
        body: { id: newId, ...duplicatedProduct },
      });
      if (!res.ok) throw new Error('Failed to duplicate product');

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
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'DELETE',
        queryParams: { resource: 'products', id },
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error('Failed to delete product');

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

  const handleToggleActive = async (productId: string, currentActive: boolean) => {
    if (togglingIds.has(productId)) return;
    const newActive = !currentActive;
    setTogglingIds(prev => new Set(prev).add(productId));
    queryClient.setQueryData(['admin-products'], (prev: Product[] | undefined) => (prev || []).map(p => p.id === productId ? { ...p, is_active: newActive } : p));
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'PUT',
        queryParams: { resource: 'products' },
        headers: { 'x-admin-token': token },
        body: { id: productId, is_active: newActive, updated_at: new Date().toISOString() },
      });
      if (!res.ok) throw new Error('Failed to toggle active');
      invalidateQueries();
    } catch (error: any) {
      queryClient.setQueryData(['admin-products'], (prev: Product[] | undefined) => (prev || []).map(p => p.id === productId ? { ...p, is_active: currentActive } : p));
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } finally {
      setTogglingIds(prev => { const next = new Set(prev); next.delete(productId); return next; });
    }
  };

  const handleToggleFeatured = async (productId: string, currentFeatured: boolean) => {
    if (togglingIds.has(productId)) return;
    const newFeatured = !currentFeatured;
    setTogglingIds(prev => new Set(prev).add(productId));
    queryClient.setQueryData(['admin-products'], (prev: Product[] | undefined) => (prev || []).map(p => p.id === productId ? { ...p, featured: newFeatured } : p));
    try {
      const token = requireAdminToken();
      const res = await invokeFunction('admin-data', {
        method: 'PUT',
        queryParams: { resource: 'products' },
        headers: { 'x-admin-token': token },
        body: { id: productId, featured: newFeatured, updated_at: new Date().toISOString() },
      });
      if (!res.ok) throw new Error('Failed to toggle featured');
      invalidateQueries();
    } catch (error: any) {
      queryClient.setQueryData(['admin-products'], (prev: Product[] | undefined) => (prev || []).map(p => p.id === productId ? { ...p, featured: currentFeatured } : p));
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } finally {
      setTogglingIds(prev => { const next = new Set(prev); next.delete(productId); return next; });
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

  const filteredProducts = useMemo(() => {
    let result = products;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term)
      );
    }
    if (filterCategory !== "all") result = result.filter(p => p.category === filterCategory);
    if (filterActive === "active") result = result.filter(p => p.is_active);
    else if (filterActive === "inactive") result = result.filter(p => !p.is_active);
    return result;
  }, [products, searchTerm, filterCategory, filterActive]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, filterCategory, filterActive]);

  const hasActiveFilters = searchTerm || filterCategory !== "all" || filterActive !== "all";

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between">
          <div className="h-10 w-48 bg-muted animate-pulse rounded" />
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
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
                <TabsList className="grid w-full grid-cols-5 bg-muted border border-border/30">
                  <TabsTrigger value="basic" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Básico</TabsTrigger>
                  <TabsTrigger value="delivery" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Entrega</TabsTrigger>
                  <TabsTrigger value="description" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Descrição</TabsTrigger>
                  <TabsTrigger value="extra" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Instruções</TabsTrigger>
                  <TabsTrigger value="media" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Mídia</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome do Produto *</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Ex: 1200 VP Valorant" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="price">Preço (R$) *</Label>
                      <Input id="price" type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="old_price">Preço Antigo (R$)</Label>
                      <Input id="old_price" type="number" step="0.01" value={formData.old_price} onChange={(e) => setFormData({ ...formData, old_price: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="discount">Desconto (%)</Label>
                      <Input id="discount" type="number" value={formData.discount} onChange={(e) => setFormData({ ...formData, discount: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Categoria *</Label>
                      <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {categories.map((c: Category) => (
                            <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sold">Vendidos</Label>
                      <Input id="sold" type="number" value={formData.sold} onChange={(e) => setFormData({ ...formData, sold: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="display_order">Ordem de Exibição</Label>
                      <Input id="display_order" type="number" value={formData.display_order} onChange={(e) => setFormData({ ...formData, display_order: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={formData.featured} onCheckedChange={(v) => setFormData({ ...formData, featured: v })} />
                    <Label>Destaque na Home</Label>
                  </div>
                </TabsContent>

                <TabsContent value="delivery" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Tipo de Entrega</Label>
                    <Select value={formData.delivery_type} onValueChange={(v) => setFormData({ ...formData, delivery_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="automatic">Automática</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.delivery_type === 'automatic' && (
                    <div className="space-y-2">
                      <Label>Códigos de Entrega (um por linha)</Label>
                      <Textarea
                        value={formData.auto_delivery_codes.join('\n')}
                        onChange={(e) => setFormData({ ...formData, auto_delivery_codes: e.target.value.split('\n').filter(Boolean) })}
                        placeholder="Insira os códigos, um por linha"
                        className="min-h-[120px]"
                      />
                      <p className="text-xs text-muted-foreground">{formData.auto_delivery_codes.length} código(s) cadastrado(s)</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="description" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Descrição Simples</Label>
                    <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Descrição curta do produto" />
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição Rica (HTML)</Label>
                    <Textarea value={formData.rich_description} onChange={(e) => setFormData({ ...formData, rich_description: e.target.value })} placeholder="<p>Descrição com HTML</p>" className="min-h-[200px] font-mono text-xs" />
                  </div>
                </TabsContent>

                <TabsContent value="extra" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Instruções de Uso (HTML)</Label>
                    <Textarea value={formData.instructions} onChange={(e) => setFormData({ ...formData, instructions: e.target.value })} placeholder="<p>Como usar o produto</p>" className="min-h-[150px] font-mono text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label>Termos e Condições (HTML)</Label>
                    <Textarea value={formData.terms_conditions} onChange={(e) => setFormData({ ...formData, terms_conditions: e.target.value })} placeholder="<p>Termos de uso</p>" className="min-h-[150px] font-mono text-xs" />
                  </div>
                </TabsContent>

                <TabsContent value="media" className="space-y-4">
                  <div className="space-y-2">
                    <Label>Imagem Principal</Label>
                    <ImageUploader currentImageUrl={formData.image_url} onImageUploaded={(url) => setFormData({ ...formData, image_url: url })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Ícone</Label>
                    <ImageUploader currentImageUrl={formData.icon_url} onImageUploaded={(url) => setFormData({ ...formData, icon_url: url })} />
                  </div>
                  <div className="space-y-2">
                    <Label>URL do Vídeo</Label>
                    <Input value={formData.video_url} onChange={(e) => setFormData({ ...formData, video_url: e.target.value })} placeholder="https://youtube.com/..." />
                  </div>
                </TabsContent>
              </Tabs>

              <Button type="submit" className="w-full">
                {editingProduct ? "Salvar Alterações" : "Criar Produto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar produtos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]"><Filter className="w-3.5 h-3.5 mr-1.5" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {categories.map((c: Category) => (
              <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterActive} onValueChange={setFilterActive}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(""); setFilterCategory("all"); setFilterActive("all"); }}>
            Limpar filtros
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">{filteredProducts.length} produto(s)</span>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paginatedProducts.map((product: Product) => (
          <Card key={product.id} className={`overflow-hidden transition-all ${!product.is_active ? 'opacity-50' : ''}`}>
            <CardContent className="p-0">
              <div className="flex gap-3 p-4">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-16 h-16 object-contain rounded-lg bg-muted/30 shrink-0" loading="lazy" />
                ) : (
                  <div className="w-16 h-16 bg-muted/30 rounded-lg flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">{product.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{product.category}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm font-bold text-primary">R$ {product.price.toFixed(2).replace('.', ',')}</span>
                    {product.old_price && product.old_price > product.price && (
                      <span className="text-xs text-muted-foreground line-through">R$ {product.old_price.toFixed(2).replace('.', ',')}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-2 border-t border-border/30 bg-muted/10">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={product.is_active}
                    onCheckedChange={() => handleToggleActive(product.id, product.is_active)}
                    disabled={togglingIds.has(product.id)}
                  />
                  <span className="text-[10px] text-muted-foreground">{product.is_active ? 'Ativo' : 'Inativo'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggleFeatured(product.id, product.featured)} title={product.featured ? 'Remover destaque' : 'Destacar'}>
                    <span className={`text-sm ${product.featured ? 'text-yellow-500' : 'text-muted-foreground'}`}>★</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDuplicate(product)} title="Duplicar">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(product)} title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(product.id)} title="Excluir">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
