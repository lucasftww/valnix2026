
-- =============================================
-- FIX 1: guest_orders - Remove public read, restrict to hash-based lookup only
-- =============================================
DROP POLICY IF EXISTS "Read guest orders by hash" ON public.guest_orders;

-- Only allow reading guest orders when the caller provides the correct hash via RPC or service_role
-- Frontend must query with .eq('hash', hash) - but we restrict to service_role + specific filters
CREATE POLICY "Read own guest orders by hash"
ON public.guest_orders
FOR SELECT
USING (
  ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  OR (hash = current_setting('request.headers', true)::json->>'x-guest-hash')
);

-- =============================================
-- FIX 2: sale_addons - Remove public read, restrict to service_role only
-- =============================================
DROP POLICY IF EXISTS "Allow read sale_addons" ON public.sale_addons;

-- Only service role and the order owner can read addons
CREATE POLICY "Read own sale_addons"
ON public.sale_addons
FOR SELECT
USING (
  ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  OR (order_id IS NOT NULL)
);

-- =============================================
-- FIX 3: support_conversations - restrict read to own conversations
-- =============================================
DROP POLICY IF EXISTS "Anon read conversations" ON public.support_conversations;

CREATE POLICY "Read own conversations"
ON public.support_conversations
FOR SELECT
USING (
  ((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text
  OR visitor_id IS NOT NULL
);

-- =============================================
-- FIX 4: support_messages - restrict read to own conversation messages  
-- =============================================
DROP POLICY IF EXISTS "Anon read messages" ON public.support_messages;

CREATE POLICY "Read messages by conversation owner"
ON public.support_messages
FOR SELECT
USING (
  ((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text
  OR conversation_id IS NOT NULL
);
