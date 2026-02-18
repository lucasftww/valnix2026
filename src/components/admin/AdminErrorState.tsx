import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AdminErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function AdminErrorState({
  title = "Erro ao carregar dados",
  message = "Não foi possível carregar os dados. Verifique sua conexão e tente novamente.",
  onRetry,
  retrying = false,
}: AdminErrorStateProps) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-5">{message}</p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="gap-2 border-destructive/30 hover:bg-destructive/10"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Tentando..." : "Tentar novamente"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
