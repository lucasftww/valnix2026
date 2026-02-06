/**
 * Otimiza URLs de imagens do Supabase Storage
 * Retorna a URL original (transformações Pro requerem configuração adicional no bucket)
 */

interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'origin';
}

export function optimizeSupabaseImage(
  imageUrl: string | null | undefined,
  _options: ImageOptimizationOptions = {}
): string {
  return imageUrl || '';
}

// Presets para diferentes usos (preparado para quando Pro for ativado)
export const imagePresets = {
  productCard: { width: 400, quality: 80, format: 'webp' as const },
  thumbnail: { width: 200, quality: 75, format: 'webp' as const },
  productDetail: { width: 600, quality: 85, format: 'webp' as const },
  banner: { width: 1200, quality: 85, format: 'webp' as const },
  categoryIcon: { width: 300, quality: 80, format: 'webp' as const },
} as const;
