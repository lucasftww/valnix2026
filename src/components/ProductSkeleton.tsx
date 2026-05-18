import { memo } from "react";
import { Skeleton } from "./ui/skeleton";
import { Card } from "./ui/card";

/**
 * Realistic ProductCard placeholder — mimics the actual ProductCard
 * geometry (aspect-[4/5] image + line-clamp-2 title + stars row + price)
 * so the swap from skeleton to real card has zero layout shift.
 */
const ProductSkeletonComponent = () => {
  return (
    <Card
      className="relative overflow-hidden border border-border/10 bg-card h-full rounded-2xl"
      style={{ contain: 'layout' }}
    >
      {/* Image area — same aspect-ratio + shimmer */}
      <div
        className="relative w-full aspect-[4/5] overflow-hidden bg-muted/30"
        style={{ aspectRatio: '4 / 5' }}
      >
        <Skeleton className="absolute inset-0 w-full h-full" />
      </div>

      {/* Info area — matches ProductCard p-3 md:p-4 space-y-2 */}
      <div className="p-3 md:p-4 space-y-2">
        {/* Title — 2 lines, mirrors line-clamp-2 min-height */}
        <div className="space-y-1.5 min-h-[2.5rem] sm:min-h-0">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>

        {/* Star + review-count row */}
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-2.5 w-16" />
        </div>

        {/* Price area */}
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </Card>
  );
};

export const ProductSkeleton = memo(ProductSkeletonComponent);
