/**
 * Shared product utility functions.
 * Single source of truth for deterministic stats generation.
 */

/** Generate deterministic sales and review counts from a product ID */
export const generateConsistentSalesAndReviews = (productId: string): { sold: number; reviewCount: number } => {
  const hash = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);
  const hash2 = productId.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 3) * 7, 0);
  const baseSold = 800 + (hash % 7200);
  const sold = baseSold + (hash2 % 100);
  const reviewRate = 0.05 + ((hash2 % 13) / 100);
  return { sold, reviewCount: Math.floor(sold * reviewRate) };
};
