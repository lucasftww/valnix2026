import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { GripVertical, Star } from "lucide-react";
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

interface Product {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
  display_order: number;
  is_featured_in_category: boolean;
  price: number;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

export const AdminProductOrder = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      fetchProducts();
    }
  }, [selectedCategory]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (error) throw error;
      setCategories(data || []);
      if (data && data.length > 0) {
        setSelectedCategory(data[0].slug);
      }
    } catch (error: any) {
      toast({
        title: "Erro ao carregar categorias",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, image_url, display_order, is_featured_in_category, price")
        .eq("category", selectedCategory)
        .order("display_order");

      if (error) throw error;
      setProducts(data || []);
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

  const handleUpdateOrder = async (productId: string, newOrder: number) => {
    try {
      const { error } = await supabase
        .from("products")
        .update({ display_order: newOrder })
        .eq("id", productId);

      if (error) throw error;

      toast({
        title: "Ordem atualizada",
        description: "Ordem do produto atualizada com sucesso!",
      });

      fetchProducts();
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar ordem",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleFeatured = async (productId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from("products")
        .update({ is_featured_in_category: !currentValue })
        .eq("id", productId);

      if (error) throw error;

      toast({
        title: "Destaque atualizado",
        description: `Produto ${!currentValue ? "destacado" : "removido do destaque"} com sucesso!`,
      });

      fetchProducts();
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar destaque",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newProducts = [...products];
    [newProducts[index - 1], newProducts[index]] = [newProducts[index], newProducts[index - 1]];
    
    // Atualizar ordens no banco
    handleUpdateOrder(newProducts[index].id, index);
    handleUpdateOrder(newProducts[index - 1].id, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index === products.length - 1) return;
    const newProducts = [...products];
    [newProducts[index], newProducts[index + 1]] = [newProducts[index + 1], newProducts[index]];
    
    // Atualizar ordens no banco
    handleUpdateOrder(newProducts[index].id, index);
    handleUpdateOrder(newProducts[index + 1].id, index + 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Ordenar Produtos</h2>
        <p className="text-muted-foreground">
          Defina a ordem de exibição dos produtos dentro de cada categoria
        </p>
      </div>

      <div className="max-w-xs">
        <Label>Selecione uma Categoria</Label>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger>
            <SelectValue placeholder="Escolha uma categoria" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.slug}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead className="w-24">Imagem</TableHead>
                <TableHead>Nome do Produto</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead className="w-32">Ordem</TableHead>
                <TableHead className="w-32">Destaque</TableHead>
                <TableHead className="w-32">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum produto encontrado nesta categoria
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product, index) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    </TableCell>
                    <TableCell>
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-16 h-16 object-cover rounded"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
                          <span className="text-2xl">🎮</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>R$ {product.price.toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={product.display_order}
                        onChange={(e) =>
                          handleUpdateOrder(product.id, parseInt(e.target.value) || 0)
                        }
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={product.is_featured_in_category}
                          onCheckedChange={() =>
                            handleToggleFeatured(product.id, product.is_featured_in_category)
                          }
                        />
                        {product.is_featured_in_category && (
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMoveDown(index)}
                          disabled={index === products.length - 1}
                        >
                          ↓
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
