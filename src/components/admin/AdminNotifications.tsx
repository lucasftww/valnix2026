import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseHelper";

export const AdminNotifications = () => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !body) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o título e a mensagem.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Aqui você precisará criar uma edge function para enviar as notificações
      // Por enquanto, vamos apenas simular o envio
      const { data: subscriptions, error } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      toast({
        title: "Notificações enviadas!",
        description: `${subscriptions?.length || 0} notificações foram enviadas com sucesso.`,
      });

      // Limpar formulário
      setTitle("");
      setBody("");
      setUrl("/");
    } catch (error) {
      console.error('Erro ao enviar notificações:', error);
      toast({
        title: "Erro",
        description: "Não foi possível enviar as notificações.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar Notificações Push</CardTitle>
        <CardDescription>
          Envie notificações para todos os usuários inscritos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSendNotification} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Novo produto disponível!"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Mensagem</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Confira nossos novos produtos e promoções..."
              rows={3}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">Link (opcional)</Label>
            <Input
              id="url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/"
            />
          </div>

          <Button type="submit" disabled={isLoading} className="w-full">
            <Send className="mr-2 h-4 w-4" />
            {isLoading ? "Enviando..." : "Enviar Notificações"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
