-- ========================================
-- FIX SUPPORT TABLES RLS POLICIES
-- Remove overly permissive policies and add proper visitor_id scoping
-- ========================================

-- Drop existing overly permissive policies on support_conversations
DROP POLICY IF EXISTS "Visitantes podem ver suas conversas" ON public.support_conversations;
DROP POLICY IF EXISTS "Visitantes podem criar conversas" ON public.support_conversations;
DROP POLICY IF EXISTS "Sistema pode atualizar conversas" ON public.support_conversations;

-- Drop existing overly permissive policies on support_messages
DROP POLICY IF EXISTS "Visitantes podem ver mensagens de suas conversas" ON public.support_messages;
DROP POLICY IF EXISTS "Visitantes podem criar mensagens" ON public.support_messages;

-- Create a function to get the visitor_id from a session cookie or generate one
-- This will be passed by the client in the request
CREATE OR REPLACE FUNCTION public.get_visitor_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_setting('request.headers', true)::json->>'x-visitor-id',
    ''
  )
$$;

-- ========================================
-- NEW POLICIES FOR support_conversations
-- ========================================

-- Visitors can only see their own conversations (matched by visitor_id header)
CREATE POLICY "Visitors can view own conversations" 
ON public.support_conversations 
FOR SELECT 
USING (
  visitor_id = get_visitor_id() 
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Visitors can create conversations with their own visitor_id
CREATE POLICY "Visitors can create own conversations" 
ON public.support_conversations 
FOR INSERT 
WITH CHECK (
  visitor_id IS NOT NULL 
  AND length(visitor_id) >= 10 
  AND length(visitor_id) <= 64
);

-- Only admins and service role can update conversations
CREATE POLICY "Only admins can update conversations" 
ON public.support_conversations 
FOR UPDATE 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR auth.role() = 'service_role'
);

-- ========================================
-- NEW POLICIES FOR support_messages
-- ========================================

-- Visitors can only see messages from their own conversations
CREATE POLICY "Visitors can view own conversation messages" 
ON public.support_messages 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM support_conversations sc
    WHERE sc.id = conversation_id
    AND (sc.visitor_id = get_visitor_id() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

-- Visitors can create messages only in their own conversations
CREATE POLICY "Visitors can create messages in own conversations" 
ON public.support_messages 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM support_conversations sc
    WHERE sc.id = conversation_id
    AND sc.visitor_id = get_visitor_id()
  )
  OR auth.role() = 'service_role'
  OR has_role(auth.uid(), 'admin'::app_role)
);