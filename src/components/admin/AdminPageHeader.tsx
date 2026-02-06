import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface AdminPageHeaderProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  badge?: { label: string; variant?: "default" | "secondary" | "destructive" | "outline" };
  action?: {
    label: string;
    icon?: LucideIcon;
    onClick: () => void;
    variant?: "default" | "outline" | "secondary";
  };
  secondaryAction?: {
    label: string;
    icon?: LucideIcon;
    onClick: () => void;
  };
  className?: string;
}

export function AdminPageHeader({
  title,
  description,
  icon: Icon,
  badge,
  action,
  secondaryAction,
  className,
}: AdminPageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6", className)}>
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        )}
        <div>
          {title && (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              {badge && (
                <Badge variant={badge.variant || "secondary"} className="text-xs">
                  {badge.label}
                </Badge>
              )}
            </div>
          )}
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {secondaryAction && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={secondaryAction.onClick}
            className="gap-2"
          >
            {secondaryAction.icon && <secondaryAction.icon className="h-4 w-4" />}
            {secondaryAction.label}
          </Button>
        )}
        {action && (
          <Button 
            variant={action.variant || "default"} 
            size="sm" 
            onClick={action.onClick}
            className="gap-2"
          >
            {action.icon && <action.icon className="h-4 w-4" />}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}