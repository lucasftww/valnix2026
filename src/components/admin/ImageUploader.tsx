import { useState, useRef, useEffect } from "react";
import { Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storage } from "@/integrations/firebase/config";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useToast } from "@/hooks/use-toast";
import imageCompression from "browser-image-compression";

type ImagePreset = 'product' | 'banner' | 'icon';

interface ImageUploaderProps {
  currentImageUrl?: string;
  onImageUploaded: (url: string) => void;
  folder?: string;
  preset?: ImagePreset;
}

const presetConfig = {
  product: { maxSizeMB: 0.5, maxWidthOrHeight: 800 },
  banner: { maxSizeMB: 1, maxWidthOrHeight: 1400 },
  icon: { maxSizeMB: 0.2, maxWidthOrHeight: 400 },
};

export const ImageUploader = ({ 
  currentImageUrl, 
  onImageUploaded,
  folder = "products",
  preset = "product"
}: ImageUploaderProps) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPreviewUrl(currentImageUrl || null);
  }, [currentImageUrl]);

  const compressImage = async (file: File): Promise<File> => {
    const config = presetConfig[preset];
    const options = {
      maxSizeMB: config.maxSizeMB,
      maxWidthOrHeight: config.maxWidthOrHeight,
      useWebWorker: true,
      fileType: "image/webp" as const,
      onProgress: (progress: number) => {
        setCompressionProgress(`Otimizando: ${Math.round(progress)}%`);
      },
    };

    try {
      setCompressionProgress("Iniciando otimização...");
      const compressedFile = await imageCompression(file, options);
      
      // Log para debug - confirmar conversão WebP
      console.log(`✅ Imagem otimizada: ${file.name} (${file.type}) → WebP`);
      console.log(`   Tamanho: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`);
      console.log(`   Tipo final: ${compressedFile.type}`);
      
      setCompressionProgress(null);
      return compressedFile;
    } catch (error) {
      console.error("Erro ao comprimir imagem:", error);
      setCompressionProgress(null);
      return file; // Retorna original se falhar
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validar tipo de arquivo
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Erro",
        description: "Formato não suportado. Use JPG, PNG, WEBP ou AVIF",
        variant: "destructive"
      });
      return;
    }

    // Aumentar limite para 20MB (será comprimido depois)
    if (file.size > 20971520) {
      toast({
        title: "Erro",
        description: "Imagem muito grande. Máximo 20MB",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);

    try {
      // Comprimir imagem automaticamente
      const compressedFile = await compressImage(file);
      
      // Criar nome único para o arquivo (sempre .webp)
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;

      // Upload para Firebase Storage
      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, compressedFile, {
        contentType: 'image/webp',
        customMetadata: { cacheControl: '31536000' }
      });

      // Obter URL pública
      const downloadUrl = await getDownloadURL(storageRef);

      setPreviewUrl(downloadUrl);
      onImageUploaded(downloadUrl);
      
      const savedKB = ((file.size - compressedFile.size) / 1024).toFixed(0);
      toast({
        title: "Sucesso",
        description: `Imagem otimizada e enviada! Economizou ${savedKB}KB`
      });

    } catch (error) {
      console.error("Erro ao fazer upload:", error);
      toast({
        title: "Erro",
        description: "Erro ao enviar imagem",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setCompressionProgress(null);
    }
  };

  const removeImage = () => {
    setPreviewUrl(null);
    onImageUploaded("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/avif"
        onChange={handleFileSelect}
        className="hidden"
      />

      {previewUrl ? (
        <div className="space-y-2">
          <div className="relative group">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full max-h-48 object-contain rounded-lg border-2 border-border bg-muted/20"
              onError={(e) => {
                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='14' fill='%23999'%3EImagem indisponível%3C/text%3E%3C/svg%3E";
              }}
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={removeImage}
              aria-label="Remover imagem"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={removeImage}
          >
            <X className="h-4 w-4 mr-2" />
            Limpar e fazer novo upload
          </Button>
        </div>
      ) : (
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 hover:border-primary cursor-pointer transition-colors bg-muted/20"
        >
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            {uploading ? (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {compressionProgress || "Enviando imagem..."}
                </p>
              </>
            ) : (
              <>
                <div className="p-3 bg-primary/10 rounded-full">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Clique para fazer upload</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    JPG, PNG, WEBP ou AVIF (máx. 20MB)
                  </p>
                  <p className="text-xs text-green-500 mt-1">
                    ✓ Otimização automática para WebP
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded">
          <ImageIcon className="h-4 w-4" />
          <span className="truncate flex-1">{previewUrl}</span>
        </div>
      )}
    </div>
  );
};
