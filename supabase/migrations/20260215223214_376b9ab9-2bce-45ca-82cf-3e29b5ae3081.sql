
-- FIX 1: guest_orders SELECT — remove the weak guest_session_id condition
DROP POLICY IF EXISTS "Read guest orders secure" ON public.guest_orders;

CREATE POLICY "Read guest orders secure"
ON public.guest_orders
FOR SELECT
USING (
  (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  OR ((auth.uid() IS NOT NULL) AND (user_id = (auth.uid())::text))
);

-- FIX 2: sale_addons UPDATE — remove email-based bypass
DROP POLICY IF EXISTS "Update pending sale_addons" ON public.sale_addons;

CREATE POLICY "Update pending sale_addons"
ON public.sale_addons
FOR UPDATE
USING (
  (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  OR ((status = 'pending') AND (user_id IS NOT NULL) AND (user_id = (auth.uid())::text))
)
WITH CHECK (
  (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  OR (status = 'pending')
);
