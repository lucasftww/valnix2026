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

/**
 * App-level error boundary. ChunkLoadError gets a quiet auto-recovery
 * (one-shot reload via main.tsx's chunk-error handler) — we do NOT show
 * the alarming "Erro de Conexão / Adblock" modal for those, since the
 * reload usually succeeds and the user never notices.
 *
 * The fallback UI only appears for actual JS exceptions that persist
 * beyond a reload — real bugs, not transient network/CDN hiccups.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isChunkError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    const msg = error.message || '';
    const isChunkError =
      error.name === 'ChunkLoadError' ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed');

    // For chunk errors: skip the UI entirely. main.tsx already attaches a
    // window error handler that triggers a one-shot location.reload() with
    // a sessionStorage flag so we don't get into a reload loop. By the time
    // the user would have seen anything, the reload has already started.
    if (isChunkError) {
      return { hasError: false, isChunkError: true };
    }

    return { hasError: true, isChunkError: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Uncaught error:", error, errorInfo);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center shadow-lg">
            <h1 className="text-2xl font-bold text-foreground mb-4">Ops! Algo deu errado.</h1>
            <p className="text-muted-foreground mb-6">
              Encontramos um erro inesperado. Tente recarregar a página — se persistir, entre em
              contato pelo nosso WhatsApp.
            </p>
            <Button onClick={this.handleReload} size="lg" className="w-full gap-2">
              <RefreshCcw className="w-4 h-4" />
              Recarregar página
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
