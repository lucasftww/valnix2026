import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { migrateSupabaseToFirebase, MigrationResult } from "@/scripts/migrateToFirebase";
import { Database, Loader2, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const MigrateDatabase = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    data?: MigrationResult;
  } | null>(null);
  const navigate = useNavigate();

  const handleMigrate = async () => {
    setIsMigrating(true);
    setResult(null);

    try {
      const data = await migrateSupabaseToFirebase({ clearExisting: true });
      setResult({
        success: true,
        message: "Migração concluída com sucesso!",
        data,
      });
    } catch (error: any) {
      console.error("Erro na migração:", error);
      setResult({
        success: false,
        message: error.message || "Erro desconhecido na migração",
      });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Migrar para Firebase</CardTitle>
          <CardDescription>
            Migra seus dados reais do Supabase (produtos, categorias, banners, reviews) para o Firebase
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleMigrate}
            disabled={isMigrating}
            className="w-full"
            size="lg"
          >
            {isMigrating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Migrando dados...
              </>
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" />
                Migrar Meus Dados
              </>
            )}
          </Button>

          {result && (
            <div
              className={`p-4 rounded-lg ${
                result.success
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}
            >
              <div className="flex items-start gap-3">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                )}
                <div className="flex-1">
                  <p
                    className={`font-medium ${
                      result.success ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {result.message}
                  </p>
                  {result.data && (
                    <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                      <li>✓ {result.data.categories} categorias migradas</li>
                      <li>✓ {result.data.products} produtos migrados</li>
                      <li>✓ {result.data.banners} banners migrados</li>
                      <li>✓ {result.data.reviews} reviews migrados</li>
                      <li>✓ {result.data.activationSteps} passos de ativação migrados</li>
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {result?.success && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/")}
            >
              Ir para a Home
            </Button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            ⚠️ Isso vai limpar o catálogo atual (categorias/produtos/banners/reviews/passos) no Firebase e importar seus dados reais.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default MigrateDatabase;
