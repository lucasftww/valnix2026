
-- Create support_conversations table
CREATE TABLE public.support_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id text NOT NULL,
  visitor_name text,
  status text NOT NULL DEFAULT 'active',
  last_message_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create support_messages table
CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  is_from_human boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Policies for support_conversations
-- Service role full access (edge function uses service role)
CREATE POLICY "Service role full access conversations"
  ON public.support_conversations FOR ALL
  USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role') = 'service_role')
  WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role') = 'service_role');

-- Anon can read (for admin panel using supabaseHelper)
CREATE POLICY "Anon read conversations"
  ON public.support_conversations FOR SELECT
  USING (true);

-- Policies for support_messages
CREATE POLICY "Service role full access messages"
  ON public.support_messages FOR ALL
  USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role') = 'service_role')
  WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role') = 'service_role');

-- Anon can read and insert (for admin panel)
CREATE POLICY "Anon read messages"
  ON public.support_messages FOR SELECT
  USING (true);

CREATE POLICY "Anon insert messages"
  ON public.support_messages FOR INSERT
  WITH CHECK (true);

-- Anon can update conversations (for admin updating last_message_at)
CREATE POLICY "Anon update conversations"
  ON public.support_conversations FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Enable realtime for support messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Create indexes for performance
CREATE INDEX idx_support_messages_conversation ON public.support_messages(conversation_id);
CREATE INDEX idx_support_conversations_last_message ON public.support_conversations(last_message_at DESC);
