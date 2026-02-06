-- Fix overly permissive RLS policy on analytics_events
-- Change from WITH CHECK (true) to proper service_role check

DROP POLICY IF EXISTS "Service role can insert analytics" ON public.analytics_events;

CREATE POLICY "Service role can insert analytics"
ON public.analytics_events
FOR INSERT
WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
  OR has_role(auth.uid(), 'admin'::app_role)
);