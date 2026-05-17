import { memo, useState, ImgHTMLAttributes } from 'react';

interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  /** URL to fall back to when the primary src fails to load. */
  fallbackSrc?: string;
}

const DEFAULT_FALLBACK =
  // Inline 1x1 transparent PNG so the browser doesn't render a broken-image icon
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" preserveAspectRatio="xMidYMid meet"><rect width="80" height="80" fill="#141414"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#666" font-family="sans-serif" font-size="10">imagem</text></svg>',
  );

/**
 * Drop-in replacement for `<img>` that swaps to a fallback when the source
 * fails to load. Prevents the broken-image-icon UX when the R2 CDN hiccups
 * or when an admin deletes a product image without updating the URL.
 */
const SafeImageComponent = ({ src, fallbackSrc, alt, ...rest }: SafeImageProps) => {
  const [errored, setErrored] = useState(false);
  const resolved = errored ? (fallbackSrc || DEFAULT_FALLBACK) : src;
  return (
    <img
      {...rest}
      src={resolved}
      alt={alt}
      onError={() => setErrored(true)}
    />
  );
};

export const SafeImage = memo(SafeImageComponent);
