import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isChunkError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    const isChunkError = 
      error.name === 'ChunkLoadError' || 
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('Importing a module script failed');
      
    return { hasError: true, isChunkError };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Uncaught error:", error, errorInfo);
    }
  }

  private handleReload = () => {
    // Para ChunkLoadErrors, uma recarga limpa geralmente resolve se foi instabilidade temporária.
    // Se for um bloqueador de anúncios persistente que quebrou a estrutura de dependência,
    // o usuário terá que recarregar de qualquer maneira ou desativar o bloqueador.
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center shadow-lg">
            <h1 className="text-2xl font-bold text-foreground mb-4">
              {this.state.isChunkError ? "Erro de Conexão" : "Ops! Algo deu errado."}
            </h1>
            <p className="text-muted-foreground mb-6">
              {this.state.isChunkError 
                ? "Tivemos um problema ao carregar esta página. Isso pode ter sido causado por uma falha de rede temporária ou por um bloqueador de anúncios agressivo (Adblock)."
                : "Encontramos um erro inesperado. Nossa equipe já foi notificada."}
            </p>
            <Button onClick={this.handleReload} size="lg" className="w-full gap-2">
              <RefreshCcw className="w-4 h-4" />
              Recarregar Página
            </Button>
            
            {this.state.isChunkError && (
              <p className="text-xs text-muted-foreground/60 mt-6">
                Se o erro persistir, desative momentaneamente o seu bloqueador de anúncios para esta página.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
