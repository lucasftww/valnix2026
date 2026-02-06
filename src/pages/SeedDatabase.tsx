import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { seedFirestore } from "@/scripts/seedFirestore";
import { Database, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SeedDatabase = () => {
  const [isSeeding, setIsSeeding] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    data?: Record<string, number>;
  } | null>(null);
  const navigate = useNavigate();

  const handleSeed = async () => {
    setIsSeeding(true);
    setResult(null);

    try {
      const data = await seedFirestore();
      setResult({
        success: true,
        message: "Dados inseridos com sucesso!",
        data,
      });
    } catch (error: any) {
      console.error("Erro ao popular Firestore:", error);
      setResult({
        success: false,
        message: error.message || "Erro desconhecido ao popular banco de dados",
      });
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Popular Firestore</CardTitle>
          <CardDescription>
            Clique no botão abaixo para inserir dados de exemplo no Firebase Firestore
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleSeed}
            disabled={isSeeding}
            className="w-full"
            size="lg"
          >
            {isSeeding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Populando...
              </>
            ) : (
              <>
                <Database className="mr-2 h-4 w-4" />
                Popular Banco de Dados
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
                      <li>✓ {result.data.categories} categorias</li>
                      <li>✓ {result.data.products} produtos</li>
                      <li>✓ {result.data.banners} banners</li>
                      <li>✓ {result.data.reviews} reviews</li>
                      <li>✓ {result.data.activationSteps} passos de ativação</li>
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
            ⚠️ Execute apenas uma vez. Executar novamente irá sobrescrever os dados existentes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SeedDatabase;
