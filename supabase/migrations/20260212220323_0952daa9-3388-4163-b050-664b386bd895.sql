
-- Fix: capi_event_log has NO RLS policies (security hole)
ALTER TABLE public.capi_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access capi_event_log"
ON public.capi_event_log
FOR ALL
USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);

-- Cleanup: remove orphaned password reset infrastructure
DROP TABLE IF EXISTS public.password_reset_tokens;
DROP TABLE IF EXISTS public.api_rate_limit;
DROP FUNCTION IF EXISTS public.cleanup_expired_reset_data();
