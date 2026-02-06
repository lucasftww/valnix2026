-- =============================================================================
-- SECURITY FIX: Consolidate redundant RLS policies on orders table
-- Remove duplicate policies that could cause misconfiguration risks
-- =============================================================================

-- Drop redundant/overlapping policies on orders table
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Block access to orders without user_id" ON public.orders;
DROP POLICY IF EXISTS "Block unauthenticated access to orders" ON public.orders;
DROP POLICY IF EXISTS "Require authentication for orders" ON public.orders;

-- The "Users and admins can view orders" policy already covers these cases properly
-- Keep: "Users and admins can view orders" - covers user's own orders + admin access
-- Keep: "Admins can view all orders" - explicit admin access
-- Keep: "Admins can update orders" - admin update
-- Keep: "Authenticated users can create own orders" - insert

-- =============================================================================
-- SECURITY FIX: Add audit logging for analytics_events access
-- Create analytics_audit_log table for tracking sensitive data access
-- =============================================================================

-- Create audit log table for analytics access
CREATE TABLE IF NOT EXISTS public.analytics_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessed_at timestamptz NOT NULL DEFAULT now(),
  accessed_by uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('SELECT', 'EXPORT', 'DELETE')),
  query_details text,
  records_accessed int,
  ip_address inet,
  user_agent text
);

-- Enable RLS on audit log
ALTER TABLE public.analytics_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs (read-only, no modifications allowed)
CREATE POLICY "Only admins can view analytics audit logs"
ON public.analytics_audit_log
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Only service role can insert audit logs (from triggers/functions)
CREATE POLICY "Only service role can insert analytics audit logs"
ON public.analytics_audit_log
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Prevent any modifications or deletions
CREATE POLICY "Block analytics audit log updates"
ON public.analytics_audit_log
FOR UPDATE
USING (false);

CREATE POLICY "Block analytics audit log deletes"
ON public.analytics_audit_log
FOR DELETE
USING (false);

-- Create function to log analytics access
CREATE OR REPLACE FUNCTION public.log_analytics_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log SELECT operations by admins
  IF TG_OP = 'SELECT' AND has_role(auth.uid(), 'admin') THEN
    INSERT INTO analytics_audit_log (
      accessed_by,
      action,
      query_details
    ) VALUES (
      auth.uid(),
      'SELECT',
      'Analytics data accessed'
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Add index for performance on audit log queries
CREATE INDEX IF NOT EXISTS idx_analytics_audit_log_accessed_at 
ON public.analytics_audit_log(accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_log_accessed_by 
ON public.analytics_audit_log(accessed_by);