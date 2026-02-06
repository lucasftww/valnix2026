import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminEmptyState } from "./AdminEmptyState";
import { Send, MessageCircle, RefreshCw, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Conversation {
  id: string;
  visitor_id: string;
  visitor_name: string | null;
  status: string;
  last_message_at: string;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  is_from_human: boolean;
  created_at: string;
}

export const AdminSupport = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  const { data: conversations, isLoading: loadingConversations, refetch: refetchConversations } = useQuery({
    queryKey: ["admin-support-conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_conversations")
        .select("*")
        .order("last_message_at", { ascending: false });

      if (error) throw error;
      return data as Conversation[];
    },
    refetchInterval: 10000,
  });

  // Fetch messages for selected conversation
  const { data: messages, isLoading: loadingMessages } = useQuery({
    queryKey: ["admin-support-messages", selectedConversation],
    queryFn: async () => {
      if (!selectedConversation) return [];

      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", selectedConversation)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as Message[];
    },
    enabled: !!selectedConversation,
    refetchInterval: 5000,
  });

  // Send admin reply
  const sendReplyMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedConversation) throw new Error("No conversation selected");

      const { error } = await supabase.from("support_messages").insert({
        conversation_id: selectedConversation,
        role: "admin",
        content,
        is_from_human: true,
      });

      if (error) throw error;

      await supabase
        .from("support_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", selectedConversation);
    },
    onSuccess: () => {
      setReplyInput("");
      queryClient.invalidateQueries({ queryKey: ["admin-support-messages", selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ["admin-support-conversations"] });
    },
    onError: () => {
      toast({
        title: "Erro ao enviar",
        description: "Não foi possível enviar a mensagem",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-support-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-support-messages", selectedConversation] });
          queryClient.invalidateQueries({ queryKey: ["admin-support-conversations"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation, queryClient]);

  const handleSendReply = () => {
    if (!replyInput.trim()) return;
    sendReplyMutation.mutate(replyInput.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Ativo</Badge>;
      case "waiting_human":
        return <Badge className="bg-yellow-500">Aguardando</Badge>;
      case "closed":
        return <Badge variant="secondary">Fechado</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
      {/* Conversations List */}
      <Card className="lg:col-span-1 flex flex-col h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Conversas</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => refetchConversations()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {loadingConversations ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : conversations?.length === 0 ? (
            <AdminEmptyState
              icon={MessageCircle}
              title="Nenhuma conversa"
              description="As conversas de suporte aparecerão aqui"
            />
          ) : (
            <ScrollArea className="flex-1 -mx-2">
              <div className="px-2 space-y-2">
                {conversations?.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedConversation === conv.id
                        ? "bg-primary/10 border border-primary"
                        : "bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">
                          {conv.visitor_name || conv.visitor_id.slice(0, 12)}...
                        </span>
                      </div>
                      {getStatusBadge(conv.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(conv.last_message_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Chat Window */}
      <Card className="lg:col-span-2 flex flex-col h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Chat</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {!selectedConversation ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Selecione uma conversa para visualizar</p>
              </div>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 -mx-2 px-2" ref={scrollRef}>
                <div className="space-y-4 py-4">
                  {loadingMessages ? (
                    <div className="flex justify-center">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    messages?.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                            message.role === "user"
                              ? "bg-muted text-foreground"
                              : message.is_from_human
                              ? "bg-blue-500 text-white"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          <div className="flex items-center justify-end gap-2 mt-1">
                            <span className="text-[10px] opacity-70">
                              {message.role === "user" ? "Cliente" : message.is_from_human ? "Admin" : "IA"}
                            </span>
                            <span className="text-[10px] opacity-70">
                              {new Date(message.created_at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="pt-4 border-t border-border">
                <div className="flex gap-2">
                  <Input
                    value={replyInput}
                    onChange={(e) => setReplyInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Responder como admin..."
                    disabled={sendReplyMutation.isPending}
                    className="flex-1"
                  />
                  <Button onClick={handleSendReply} disabled={!replyInput.trim() || sendReplyMutation.isPending}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Suas respostas serão marcadas como "Admin"
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
