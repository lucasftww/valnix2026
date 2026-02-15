
-- Fix critical security vulnerability: guest_orders SELECT policy has "OR true" making all data public
DROP POLICY IF EXISTS "Read guest orders" ON public.guest_orders;

-- New policy: service_role can read all, authenticated users can read their own, or read by hash
CREATE POLICY "Read guest orders secure" 
ON public.guest_orders 
FOR SELECT 
USING (
  (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  OR (auth.uid() IS NOT NULL AND user_id = (auth.uid())::text)
  OR (auth.uid() IS NOT NULL AND guest_session_id IS NOT NULL)
);
