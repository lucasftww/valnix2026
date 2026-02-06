import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { z } from "zod";

const newsletterSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "Por favor, insira um email válido" })
    .max(255, { message: "Email muito longo" }),
});

interface NewsletterFormProps {
  showTitle?: boolean;
}

export const NewsletterForm = ({ showTitle = true }: NewsletterFormProps) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Verificar se está logado
    if (!user) {
      toast({
        title: "Você deve logar primeiro",
        description: "Faça login para assinar nossa newsletter",
        variant: "destructive",
      });
      return;
    }
    
    // Validar email
    const validation = newsletterSchema.safeParse({ email });
    
    if (!validation.success) {
      toast({
        title: "Email inválido",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase
        .from("newsletter_subscribers")
        .insert([{ email: validation.data.email }]);

      if (error) {
        // Email já existe
        if (error.code === "23505") {
          toast({
            title: "Email já cadastrado",
            description: "Este email já está inscrito na nossa newsletter!",
          });
        } else {
          throw error;
        }
      } else {
        toast({
          title: "Obrigado pela assinatura!",
          description: "Você receberá nossas novidades em breve 🎉",
        });
        setEmail("");
      }
    } catch (error) {
      console.error("Erro ao inscrever na newsletter:", error);
      toast({
        title: "Erro ao se inscrever",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {showTitle && (
        <h3 className="text-red-500 font-bold text-sm uppercase tracking-wider">
          NEWSLETTER
        </h3>
      )}
      <p className="text-muted-foreground text-sm">
        Assine nossa newsletter e receba as melhores ofertas DE GRAÇA!
      </p>
      <form onSubmit={handleSubmit} className="flex items-end gap-2" aria-label="Formulário de newsletter">
        <div className="flex-1 relative">
          <Input
            type="email"
            placeholder="Seu e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            className="bg-transparent border-0 border-b-2 border-red-500 rounded-none text-foreground text-sm focus:border-red-500 focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors placeholder:text-muted-foreground/50 px-0 h-12"
            required
            aria-label="Endereço de e-mail para newsletter"
          />
        </div>
        <Button
          type="submit"
          disabled={isLoading}
          className="bg-red-500 hover:bg-red-600 text-white font-bold px-8 py-2 uppercase text-xs tracking-wider transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm h-12 min-w-[100px]"
          aria-label={isLoading ? "Processando assinatura" : "Assinar newsletter"}
        >
          {isLoading ? "..." : "Assinar"}
        </Button>
      </form>
    </div>
  );
};
