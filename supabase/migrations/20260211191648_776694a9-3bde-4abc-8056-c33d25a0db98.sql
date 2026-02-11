-- Fix security definer warning on the view
DROP VIEW IF EXISTS public.utmify_success_rate;

CREATE VIEW public.utmify_success_rate 
WITH (security_invoker = true) AS
SELECT 
  date(created_at) as day,
  status,
  count(*) as event_count,
  avg(attempt_count) as avg_attempts
FROM public.utmify_event_log
GROUP BY 1, 2
ORDER BY 1 DESC, 2;