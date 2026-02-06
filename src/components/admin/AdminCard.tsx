import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface AdminCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
}

export function AdminCard({
  title,
  description,
  icon: Icon,
  iconColor = "text-primary",
  children,
  className,
  headerAction,
}: AdminCardProps) {
  return (
    <Card className={cn("bg-card/50 backdrop-blur-sm border-border/50 shadow-sm", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center",
                "bg-gradient-to-br from-primary/10 to-primary/5"
              )}>
                <Icon className={cn("h-5 w-5", iconColor)} />
              </div>
            )}
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              {description && (
                <CardDescription className="mt-0.5">{description}</CardDescription>
              )}
            </div>
          </div>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}