-- ============================================================================
-- PIX expiration sweeper.
--
-- Orders sit at payment_status='pending' forever if the gateway never sends
-- an EXPIRED webhook (or if it does and we miss it). They pollute admin lists,
-- skew analytics, and look indistinguishable from real pending orders.
--
-- This migration:
-- 1. Adds `expire_pending_pix_orders()` — marks orders pending past their
--    pix_expires_at (with a 5-min grace) as 'expired'. Idempotent.
-- 2. Schedules it every 10 min via pg_cron (Supabase enables this extension).
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.expire_pending_pix_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.orders
       set payment_status = 'expired'
     where payment_status = 'pending'
       and (
         (pix_expires_at is not null and pix_expires_at < now() - interval '5 minutes')
         -- Safety net for orders missing pix_expires_at: anything created >2h
         -- ago and still pending is almost certainly abandoned.
         or (pix_expires_at is null and created_at < now() - interval '2 hours')
       )
    returning 1
  )
  select count(*) into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.expire_pending_pix_orders() from public;
grant execute on function public.expire_pending_pix_orders() to service_role;

-- Schedule every 10 min. Unschedule first so re-running this migration is safe.
do $$
begin
  perform cron.unschedule('expire_pending_pix_orders');
exception when others then null;
end $$;

select cron.schedule(
  'expire_pending_pix_orders',
  '*/10 * * * *',
  $$select public.expire_pending_pix_orders();$$
);
