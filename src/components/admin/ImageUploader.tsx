import { useState, useRef, useEffect } from "react";
import { Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import imageCompression from "browser-image-compression";
import { invokeFunction } from "@/lib/apiHelper";
import { requireAdminToken } from "@/lib/adminAuth";

type ImagePreset = 'product' | 'icon';

interface ImageUploaderProps {
  currentImageUrl?: string;
  onImageUploaded: (url: string) => void;
  folder?: string;
  preset?: ImagePreset;
}

const presetConfig = {
  product: { maxSizeMB: 0.15, maxWidthOrHeight: 600 },
  icon: { maxSizeMB: 0.08, maxWidthOrHeight: 300 },
};

/** Check if browser supports AVIF encoding via canvas */
const supportsAvif = (() => {
  let result: boolean | null = null;
  return () => {
    if (result !== null) return result;
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      result = c.toDataURL('image/avif').startsWith('data:image/avif');
    } catch { result = false; }
    return result;
  };
})();

/** Convert a File/Blob to base64 string (without the data: prefix) */
const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip "data:…;base64,"
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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

  const compressImage = async (file: File): Promise<{ compressed: File; outputType: string }> => {
    const config = presetConfig[preset];
    const useAvif = supportsAvif();
    const outputType = useAvif ? "image/avif" : "image/webp";
    const options = {
      maxSizeMB: config.maxSizeMB,
      maxWidthOrHeight: config.maxWidthOrHeight,
      useWebWorker: true,
      fileType: outputType as any,
      initialQuality: 0.75,
      onProgress: (progress: number) => {
        setCompressionProgress(`Otimizando (${useAvif ? 'AVIF' : 'WebP'}): ${Math.round(progress)}%`);
      },
    };

    try {
      setCompressionProgress("Iniciando otimização...");
      let compressedFile = await imageCompression(file, options);
      
      // If AVIF attempt produced larger file or failed, fallback to WebP
      if (useAvif && compressedFile.size > file.size * 0.9) {
        const webpOptions = { ...options, fileType: "image/webp" as const };
        const webpFile = await imageCompression(file, webpOptions);
        if (webpFile.size < compressedFile.size) {
          compressedFile = webpFile;
          return { compressed: compressedFile, outputType: "image/webp" };
        }
      }
      
      if (import.meta.env.DEV) {
        console.log(`✅ Imagem otimizada: ${file.name} → ${useAvif ? 'AVIF' : 'WebP'}`);
        console.log(`   Tamanho: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`);
      }
      
      setCompressionProgress(null);
      return { compressed: compressedFile, outputType };
    } catch (error) {
      if (import.meta.env.DEV) console.error("Erro ao comprimir imagem:", error);
      setCompressionProgress(null);
      return { compressed: file, outputType: "image/webp" };
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Erro",
        description: "Formato não suportado. Use JPG, PNG, WEBP ou AVIF",
        variant: "destructive"
      });
      return;
    }

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
      // Compress
      const { compressed, outputType } = await compressImage(file);
      const ext = outputType === 'image/avif' ? 'avif' : 'webp';

      // Build unique file name (path-safe — server rejects anything else).
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

      setCompressionProgress("Enviando para Supabase Storage...");

      const token = requireAdminToken();

      // Convert to base64 and upload via the admin-data endpoint, which uploads
      // to the Supabase Storage bucket "product-images" using service_role.
      // Replaces the never-built /api/upload-r2 endpoint.
      const base64 = await fileToBase64(compressed);

      const response = await invokeFunction("admin-data", {
        method: "POST",
        queryParams: { resource: "upload-image" },
        body: { fileBase64: base64, fileName, contentType: outputType },
        headers: { "x-admin-token": token },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Falha no upload");
      }

      const { url } = await response.json();

      setPreviewUrl(url);
      onImageUploaded(url);
      
      const savedKB = ((file.size - compressed.size) / 1024).toFixed(0);
      toast({
        title: "Sucesso",
        description: `Imagem enviada em ${ext.toUpperCase()}! Economizou ${savedKB}KB`
      });

    } catch (error) {
      if (import.meta.env.DEV) console.error("Erro ao fazer upload:", error);
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro ao enviar imagem",
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
                    <p className="text-xs text-primary mt-1">
                      ✓ Otimização automática AVIF/WebP → Supabase Storage
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

      {/* URL manual — útil para reusar imagens já hospedadas (ex: R2 antigo) */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground select-none">
          Ou colar URL externa (avançado)
        </summary>
        <div className="mt-2 flex gap-2">
          <input
            type="url"
            placeholder="https://exemplo.com/imagem.webp"
            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
            defaultValue={previewUrl || ''}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== previewUrl && /^https?:\/\//.test(v)) {
                setPreviewUrl(v);
                onImageUploaded(v);
              }
            }}
          />
        </div>
      </details>
    </div>
  );
};
