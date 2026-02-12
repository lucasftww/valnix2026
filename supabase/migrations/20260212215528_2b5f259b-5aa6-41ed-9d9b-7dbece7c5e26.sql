
-- Table for password reset tokens (used by request-password-reset and verify-reset-token edge functions)
CREATE TABLE public.password_reset_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  used BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast token lookups
CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens(token);

-- Enable RLS
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (edge functions use service_role)
CREATE POLICY "Service role full access password_reset_tokens"
ON public.password_reset_tokens
FOR ALL
USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);

-- Table for API rate limiting (used by verify-reset-token edge function)
CREATE TABLE public.api_rate_limit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast rate limit lookups
CREATE INDEX idx_api_rate_limit_lookup ON public.api_rate_limit(endpoint, ip_address, window_start);

-- Enable RLS
ALTER TABLE public.api_rate_limit ENABLE ROW LEVEL SECURITY;

-- Only service_role can access
CREATE POLICY "Service role full access api_rate_limit"
ON public.api_rate_limit
FOR ALL
USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);

-- Auto-cleanup old tokens (older than 24h) and rate limits (older than 1h)
CREATE OR REPLACE FUNCTION public.cleanup_expired_reset_data()
RETURNS void AS $$
BEGIN
  DELETE FROM public.password_reset_tokens WHERE expires_at < now() - interval '24 hours';
  DELETE FROM public.api_rate_limit WHERE window_start < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
