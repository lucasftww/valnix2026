import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
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
  // Auth removed — newsletter is open to all

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    


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
      const subscribersRef = collection(db, "newsletter_subscribers");
      
      // Write-only: no duplicate check (read is blocked by Firestore rules)
      // Server-side deduplication can be added later if needed
      await addDoc(subscribersRef, {
        email: validation.data.email.toLowerCase(),
        user_id: user.uid,
        created_at: serverTimestamp(),
      });
      toast({
        title: "Obrigado pela assinatura!",
        description: "Você receberá nossas novidades em breve 🎉",
      });
      setEmail("");
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
        <h3 className="text-foreground font-semibold text-sm tracking-wide">
          Newsletter
        </h3>
      )}
      <p className="text-muted-foreground text-sm">
        Receba ofertas exclusivas no seu e-mail.
      </p>
      <form onSubmit={handleSubmit} className="flex items-end gap-2" aria-label="Formulário de newsletter">
        <div className="flex-1 relative">
          <Input
            id="newsletter-email"
            name="email"
            type="email"
            placeholder="Seu e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            className="bg-transparent border-0 border-b border-border/30 rounded-none text-foreground text-sm focus:border-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors placeholder:text-muted-foreground/50 px-0 h-10"
            required
            aria-label="Endereço de e-mail para newsletter"
          />
        </div>
        <Button
          type="submit"
          disabled={isLoading}
          className="bg-foreground hover:bg-foreground/90 text-background font-medium px-6 py-2 text-xs tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed rounded-full h-10 min-w-[90px]"
          aria-label={isLoading ? "Processando assinatura" : "Assinar newsletter"}
        >
          {isLoading ? "..." : "Assinar"}
        </Button>
      </form>
    </div>
  );
};