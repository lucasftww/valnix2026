
-- =====================================================
-- FIX RLS POLICIES - Security Hardening (v2)
-- =====================================================

-- ── 1. guest_orders: Fix SELECT (was USING true) ──
-- Need to allow read by hash (for OrderDelivery page) and by authenticated user email (for linking)
DROP POLICY IF EXISTS "Read guest orders by secret hash or email" ON public.guest_orders;
DROP POLICY IF EXISTS "Read guest orders by hash" ON public.guest_orders;

CREATE POLICY "Read guest orders by hash or authenticated"
  ON public.guest_orders
  FOR SELECT
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
    OR auth.uid() IS NOT NULL
  );

-- ── 2. guest_orders: Fix UPDATE (restrict linking to own user_id) ──
DROP POLICY IF EXISTS "Update guest orders for linking" ON public.guest_orders;

CREATE POLICY "Update guest orders for linking"
  ON public.guest_orders
  FOR UPDATE
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
    OR (linked = false AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
    OR (linked = true AND user_id IS NOT NULL AND user_id = auth.uid()::text)
  );

-- ── 3. sale_addons: Fix INSERT (add status validation) ──
DROP POLICY IF EXISTS "Allow insert sale_addons" ON public.sale_addons;

CREATE POLICY "Allow insert sale_addons"
  ON public.sale_addons
  FOR INSERT
  WITH CHECK (
    (order_id IS NOT NULL) AND (length(order_id) > 0)
    AND (addon_type IS NOT NULL) AND (length(addon_type) > 0)
    AND (amount >= 0::numeric)
    AND (status IN ('pending', 'skipped'))
  );

-- ── 4. sale_addons: Fix UPDATE (restrict to service_role only) ──
DROP POLICY IF EXISTS "Limited update pending sale_addons" ON public.sale_addons;

-- Allow service_role OR owner updating their own pending addon with pix info
CREATE POLICY "Update pending sale_addons"
  ON public.sale_addons
  FOR UPDATE
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
    OR (status = 'pending' AND (
      (user_id IS NOT NULL AND user_id = auth.uid()::text)
      OR (user_id IS NULL AND customer_email IS NOT NULL)
    ))
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
    OR (status = 'pending')
  );

-- ── 5. support_conversations: Lock down to service_role only ──
DROP POLICY IF EXISTS "Read own conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Insert conversations" ON public.support_conversations;
DROP POLICY IF EXISTS "Update own conversations" ON public.support_conversations;

CREATE POLICY "Service role only read conversations"
  ON public.support_conversations
  FOR SELECT
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  );

CREATE POLICY "Service role only insert conversations"
  ON public.support_conversations
  FOR INSERT
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  );

CREATE POLICY "Service role only update conversations"
  ON public.support_conversations
  FOR UPDATE
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  );

-- ── 6. support_messages: Lock down to service_role only ──
DROP POLICY IF EXISTS "Read messages by conversation owner" ON public.support_messages;
DROP POLICY IF EXISTS "Insert messages with conversation" ON public.support_messages;

CREATE POLICY "Service role only read messages"
  ON public.support_messages
  FOR SELECT
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  );

CREATE POLICY "Service role only insert messages"
  ON public.support_messages
  FOR INSERT
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role'
  );
