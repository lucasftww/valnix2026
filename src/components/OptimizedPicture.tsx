import { useState } from "react";

interface OptimizedPictureProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  width?: number;
  height?: number;
  priority?: boolean;
}

export const OptimizedPicture = ({
  src,
  alt,
  className = "",
  loading = "lazy",
  width,
  height,
  priority = false,
}: OptimizedPictureProps) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  if (imageError) {
    return (
      <div className={`flex flex-col items-center justify-center bg-secondary/30 border-2 border-dashed border-border ${className}`}>
        <div className="text-center p-4">
          <div className="text-4xl mb-2">🖼️</div>
          <p className="text-xs text-muted-foreground font-medium">Imagem indisponível</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">Faça upload novamente</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {imageLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary/50">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : loading}
        decoding="async"
        width={width}
        height={height}
        onLoad={() => setImageLoading(false)}
        onError={() => {
          setImageError(true);
          setImageLoading(false);
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          imageLoading ? "opacity-0" : "opacity-100"
        }`}
      />
    </div>
  );
};
