import { Skeleton } from "./ui/skeleton";
import { Card } from "./ui/card";

export const ProductSkeleton = () => {
  return (
    <Card className="overflow-hidden group hover:shadow-xl transition-all duration-300 border-border/50 rounded-md md:rounded-2xl">
      <div className="relative aspect-[4/5] overflow-hidden bg-secondary/30">
        <Skeleton className="w-full h-full" />
      </div>
      
      <div className="bg-card p-1 md:p-4 space-y-1 md:space-y-2">
        <Skeleton className="h-3 md:h-5 w-3/4" />
        <Skeleton className="h-2 md:h-4 w-16" />
        <Skeleton className="h-4 md:h-6 w-20" />
      </div>
    </Card>
  );
};
