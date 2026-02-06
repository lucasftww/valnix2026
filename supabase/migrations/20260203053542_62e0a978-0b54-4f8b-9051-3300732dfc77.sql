-- Tabela de conversas de suporte
CREATE TABLE public.support_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  visitor_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'waiting_human')),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de mensagens de suporte
CREATE TABLE public.support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
  content TEXT NOT NULL,
  is_from_human BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Políticas para conversas - visitantes podem ver suas próprias conversas
CREATE POLICY "Visitantes podem ver suas conversas" 
ON public.support_conversations 
FOR SELECT 
USING (true);

CREATE POLICY "Visitantes podem criar conversas" 
ON public.support_conversations 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Sistema pode atualizar conversas" 
ON public.support_conversations 
FOR UPDATE 
USING (true);

-- Políticas para mensagens
CREATE POLICY "Visitantes podem ver mensagens de suas conversas" 
ON public.support_messages 
FOR SELECT 
USING (true);

CREATE POLICY "Visitantes podem criar mensagens" 
ON public.support_messages 
FOR INSERT 
WITH CHECK (true);

-- Políticas admin
CREATE POLICY "Admins podem gerenciar conversas" 
ON public.support_conversations 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins podem gerenciar mensagens" 
ON public.support_messages 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger para atualizar updated_at
CREATE TRIGGER update_support_conversations_updated_at
BEFORE UPDATE ON public.support_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Habilitar realtime para mensagens
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;