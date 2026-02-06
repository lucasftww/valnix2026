import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isTyping?: boolean;
}

const getVisitorId = () => {
  let visitorId = localStorage.getItem("valnix_visitor_id");
  if (!visitorId) {
    visitorId = `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("valnix_visitor_id", visitorId);
  }
  return visitorId;
};

export const SupportChat = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Send welcome message when chat opens for first time
  useEffect(() => {
    if (isOpen && messages.length === 0 && !conversationId) {
      const welcomeMessage: Message = {
        id: "welcome",
        role: "assistant",
        content: "Oi! Eu sou a Ana, da Valnix Store 😊 Como posso te ajudar hoje?",
      };
      simulateTyping(welcomeMessage.content, () => {
        setMessages([welcomeMessage]);
      });
    }
  }, [isOpen]);

  const simulateTyping = (text: string, onComplete: () => void) => {
    setIsTyping(true);
    // Simulate typing delay based on message length (50-100ms per char, max 3s)
    const typingDelay = Math.min(text.length * 30 + 500, 3000);
    setTimeout(() => {
      setIsTyping(false);
      onComplete();
    }, typingDelay);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // Validate input length (max 1000 chars)
    const trimmedInput = input.trim().slice(0, 1000);

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      content: trimmedInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const visitorId = getVisitorId();

    try {
      const { data, error } = await supabase.functions.invoke("support-chat", {
        body: {
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content.slice(0, 1000), // Enforce max length
          })),
          conversationId,
          visitorId,
        },
        headers: {
          "x-visitor-id": visitorId,
        },
      });

      if (error) throw error;

      if (data?.conversationId && !conversationId) {
        setConversationId(data.conversationId);
      }

      if (data?.message) {
        simulateTyping(data.message, () => {
          const aiMessage: Message = {
            id: `ai_${Date.now()}`,
            role: "assistant",
            content: data.message,
          };
          setMessages((prev) => [...prev, aiMessage]);
        });
      }
    } catch (error) {
      console.error("Chat error:", error);
      setIsTyping(false);
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: "assistant",
        content: "Ops, algo deu errado. Tenta de novo? 🙏",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Chat Bubble */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 md:bottom-28 right-6 z-50 h-14 w-14 rounded-full bg-primary shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center animate-bounce"
          style={{ animationDuration: "2s", animationIterationCount: 3 }}
          aria-label="Abrir chat de suporte"
        >
          <MessageCircle className="h-7 w-7 text-primary-foreground" />
          <span className="absolute -top-1 -right-1 h-4 w-4 bg-green-500 rounded-full border-2 border-background" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[350px] max-w-[calc(100vw-32px)] h-[500px] max-h-[calc(100vh-100px)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-primary px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <span className="text-lg">👩‍💻</span>
              </div>
              <div>
                <h3 className="font-semibold text-primary-foreground">Ana - Suporte</h3>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 bg-green-400 rounded-full" />
                  <span className="text-xs text-primary-foreground/80">Online</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 rounded-full hover:bg-primary-foreground/20 flex items-center justify-center transition-colors"
              aria-label="Fechar chat"
            >
              <X className="h-5 w-5 text-primary-foreground" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Digite sua mensagem..."
                disabled={isLoading || isTyping}
                className="flex-1 h-11"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading || isTyping}
                size="icon"
                className="h-11 w-11"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
