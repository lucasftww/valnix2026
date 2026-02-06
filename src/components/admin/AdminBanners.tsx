import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Image, GripVertical, Upload, X, Eye, EyeOff, RefreshCw } from "lucide-react";
import { AdminCard } from "./AdminCard";
import { AdminEmptyState } from "./AdminEmptyState";
import { AdminPageHeader } from "./AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import imageCompression from "browser-image-compression";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Banner {
  id: string;
  image_url: string;
  alt_text: string;
  is_active: boolean;
  display_order: number;
}

export function AdminBanners() {
  const { toast } = useToast();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDialog, setPreviewDialog] = useState<string | null>(null);
  
  const [newBanner, setNewBanner] = useState({
    image_url: "",
    alt_text: "Banner promocional",
    is_active: true,
    display_order: 0
  });

  useEffect(() => {
    loadBanners();
  }, []);

  const loadBanners = async () => {
    setLoading(true);
    try {
      console.log("🔄 Carregando banners...");
      
      const { data, error } = await supabase
        .from("site_banners")
        .select("*")
        .order("display_order", { ascending: true });

      if (error) {
        console.error("❌ Erro ao carregar banners:", error);
        throw error;
      }
      
      console.log("✅ Banners carregados:", data?.length || 0);
      setBanners(data || []);
    } catch (error: any) {
      console.error("❌ Erro ao carregar banners:", error);
      toast({
        title: "Erro ao carregar banners",
        description: error.message || "Verifique sua conexão",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validar tipo
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Formato inválido",
        description: "Use JPG, PNG ou WEBP",
        variant: "destructive"
      });
      return;
    }

    // Validar tamanho (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "Máximo 20MB",
        variant: "destructive"
      });
      return;
    }

    setSubmitting(true);
    setUploadProgress("Otimizando imagem...");

    try {
      // Comprimir para WebP
      const compressedFile = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: "image/webp" as const,
        onProgress: (p) => setUploadProgress(`Otimizando: ${Math.round(p)}%`)
      });

      setUploadProgress("Enviando...");

      // Gerar nome único
      const fileName = `banners/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

      // Upload
      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, compressedFile, {
          cacheControl: '31536000',
          upsert: false,
          contentType: 'image/webp'
        });

      if (error) throw error;

      // Pegar URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      setNewBanner(prev => ({ ...prev, image_url: publicUrl }));
      setPreviewImage(publicUrl);
      
      toast({
        title: "Imagem enviada!",
        description: `Economizou ${Math.round((file.size - compressedFile.size) / 1024)}KB`
      });

    } catch (error: any) {
      console.error("Erro no upload:", error);
      toast({
        title: "Erro no upload",
        description: error.message || "Tente novamente",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const handleAddBanner = async () => {
    if (!newBanner.image_url) {
      toast({
        title: "Imagem obrigatória",
        description: "Faça upload de uma imagem primeiro",
        variant: "destructive"
      });
      return;
    }

    setSubmitting(true);
    try {
      // Calcular próxima ordem
      const nextOrder = banners.length > 0 
        ? Math.max(...banners.map(b => b.display_order)) + 1 
        : 0;

      console.log("🔄 Inserindo banner:", { ...newBanner, display_order: nextOrder });

      const { data, error } = await supabase
        .from("site_banners")
        .insert([{ 
          ...newBanner, 
          display_order: nextOrder,
          alt_text: newBanner.alt_text || "Banner promocional"
        }])
        .select()
        .single();

      if (error) {
        console.error("❌ Erro no insert:", error);
        throw error;
      }

      if (!data) {
        console.error("❌ Nenhum dado retornado - possível problema de RLS");
        throw new Error("Falha ao salvar - verifique suas permissões de admin");
      }

      console.log("✅ Banner inserido com sucesso:", data);

      toast({
        title: "Banner adicionado!",
        description: "Já está visível na home"
      });
      
      // Reset form
      setNewBanner({
        image_url: "",
        alt_text: "Banner promocional",
        is_active: true,
        display_order: 0
      });
      setPreviewImage(null);
      setShowAddForm(false);
      loadBanners();
      
    } catch (error: any) {
      console.error("❌ Erro ao adicionar banner:", error);
      toast({
        title: "Erro ao salvar banner",
        description: error.message || "Verifique se você tem permissão de administrador",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("site_banners")
        .update({ is_active: !currentStatus })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: currentStatus ? "Banner desativado" : "Banner ativado"
      });
      loadBanners();
    } catch (error) {
      console.error("Erro:", error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar",
        variant: "destructive"
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este banner?")) return;

    try {
      const { error } = await supabase
        .from("site_banners")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({ title: "Banner excluído" });
      loadBanners();
    } catch (error) {
      console.error("Erro:", error);
      toast({
        title: "Erro ao excluir",
        variant: "destructive"
      });
    }
  };

  const handleUpdateOrder = async (id: string, newOrder: number) => {
    try {
      const { error } = await supabase
        .from("site_banners")
        .update({ display_order: newOrder })
        .eq("id", id);

      if (error) throw error;
      loadBanners();
    } catch (error) {
      console.error("Erro:", error);
    }
  };

  const clearNewBanner = () => {
    setNewBanner({
      image_url: "",
      alt_text: "Banner promocional",
      is_active: true,
      display_order: 0
    });
    setPreviewImage(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Carregando banners...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        description={`${banners.length} banner${banners.length !== 1 ? 's' : ''} • ${banners.filter(b => b.is_active).length} ativo${banners.filter(b => b.is_active).length !== 1 ? 's' : ''}`}
        action={{
          label: showAddForm ? "Cancelar" : "Novo Banner",
          icon: showAddForm ? X : Plus,
          onClick: () => {
            setShowAddForm(!showAddForm);
            if (showAddForm) clearNewBanner();
          },
          variant: showAddForm ? "outline" : "default"
        }}
      />

      {/* Formulário de Adicionar */}
      {showAddForm && (
        <AdminCard
          title="Novo Banner"
          description="Tamanho ideal: 1920x600px (proporção 3.2:1)"
          icon={Plus}
        >
          <div className="space-y-6">
            {/* Upload Zone */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Imagem do Banner *</Label>
              
              {previewImage ? (
                <div className="space-y-3">
                  <div className="relative group rounded-xl overflow-hidden border-2 border-primary/30 bg-muted">
                    <img
                      src={previewImage}
                      alt="Preview"
                      className="w-full h-48 object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "/placeholder.svg";
                      }}
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setPreviewDialog(previewImage)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Ver
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={clearNewBanner}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remover
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-green-500 flex items-center gap-1">
                    ✓ Imagem pronta para salvar
                  </p>
                </div>
              ) : (
                <label className={cn(
                  "flex flex-col items-center justify-center gap-4 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all",
                  submitting 
                    ? "border-primary bg-primary/5 cursor-wait" 
                    : "border-border hover:border-primary hover:bg-primary/5"
                )}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    disabled={submitting}
                    className="hidden"
                  />
                  
                  {submitting ? (
                    <>
                      <Loader2 className="h-12 w-12 animate-spin text-primary" />
                      <p className="text-sm text-primary font-medium">{uploadProgress}</p>
                    </>
                  ) : (
                    <>
                      <div className="p-4 bg-primary/10 rounded-full">
                        <Upload className="h-8 w-8 text-primary" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium">Clique para fazer upload</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          JPG, PNG ou WEBP • Máx 20MB
                        </p>
                        <p className="text-xs text-green-500 mt-2">
                          ✓ Conversão automática para WebP
                        </p>
                      </div>
                    </>
                  )}
                </label>
              )}
            </div>

            {/* Opções */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="alt_text">Texto Alternativo</Label>
                <Input
                  id="alt_text"
                  value={newBanner.alt_text}
                  onChange={(e) => setNewBanner({ ...newBanner, alt_text: e.target.value })}
                  placeholder="Descrição do banner"
                />
              </div>
              <div className="flex items-center gap-4 pt-7">
                <Switch
                  id="is_active"
                  checked={newBanner.is_active}
                  onCheckedChange={(checked) => setNewBanner({ ...newBanner, is_active: checked })}
                />
                <Label htmlFor="is_active" className="cursor-pointer">
                  Ativar imediatamente
                </Label>
              </div>
            </div>

            {/* Botões */}
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={handleAddBanner} 
                disabled={submitting || !newBanner.image_url}
                className="flex-1"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar Banner
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowAddForm(false);
                  clearNewBanner();
                }}
                size="lg"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Lista de Banners */}
      <AdminCard
        title="Banners Cadastrados"
        description="Clique no switch para ativar/desativar"
        icon={Image}
        headerAction={
          <Button variant="ghost" size="sm" onClick={loadBanners}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      >
        {banners.length === 0 ? (
          <AdminEmptyState
            icon={Image}
            title="Nenhum banner"
            description="Adicione banners para exibir no carrossel da home"
            actionLabel="Criar Primeiro Banner"
            onAction={() => setShowAddForm(true)}
          />
        ) : (
          <div className="space-y-3">
            {banners.map((banner, index) => (
              <div
                key={banner.id}
                className={cn(
                  "flex flex-col md:flex-row gap-4 p-4 rounded-xl border transition-all",
                  banner.is_active 
                    ? "bg-card border-border hover:shadow-md" 
                    : "bg-muted/30 border-border/50 opacity-70"
                )}
              >
                {/* Ordem e Preview */}
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                    <Badge variant="outline" className="text-xs font-mono">
                      {index + 1}
                    </Badge>
                  </div>
                  
                  <div 
                    className="w-40 h-24 rounded-lg overflow-hidden border bg-muted cursor-pointer hover:ring-2 ring-primary transition-all"
                    onClick={() => setPreviewDialog(banner.image_url)}
                  >
                    <img
                      src={banner.image_url}
                      alt={banner.alt_text}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "/placeholder.svg";
                      }}
                    />
                  </div>
                </div>
                
                {/* Info */}
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={banner.is_active ? "default" : "secondary"}>
                      {banner.is_active ? (
                        <><Eye className="h-3 w-3 mr-1" /> Ativo</>
                      ) : (
                        <><EyeOff className="h-3 w-3 mr-1" /> Inativo</>
                      )}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Ordem: {banner.display_order}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{banner.alt_text}</p>
                  <p className="text-xs text-muted-foreground/60 truncate font-mono">
                    {banner.image_url}
                  </p>
                </div>
                
                {/* Ações */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={banner.is_active}
                      onCheckedChange={() => handleToggleActive(banner.id, banner.is_active)}
                    />
                  </div>
                  <Input
                    type="number"
                    value={banner.display_order}
                    onChange={(e) => handleUpdateOrder(banner.id, parseInt(e.target.value) || 0)}
                    className="w-16 text-center"
                    min={0}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(banner.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Dialog de Preview */}
      <Dialog open={!!previewDialog} onOpenChange={() => setPreviewDialog(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview do Banner</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg overflow-hidden">
            {previewDialog && (
              <img
                src={previewDialog}
                alt="Preview"
                className="w-full h-auto"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
