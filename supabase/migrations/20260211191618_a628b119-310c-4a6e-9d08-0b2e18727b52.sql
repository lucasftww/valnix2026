-- Enable required extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create monitoring view for UTMify event success rates
CREATE OR REPLACE VIEW public.utmify_success_rate AS
SELECT 
  date(created_at) as day,
  status,
  count(*) as event_count,
  avg(attempt_count) as avg_attempts
FROM public.utmify_event_log
GROUP BY 1, 2
ORDER BY 1 DESC, 2;