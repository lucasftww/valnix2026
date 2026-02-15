-- Drop all tables that have been migrated to Firestore
-- All edge functions now use Firestore REST API instead of these tables

-- Drop dependent views first
DROP VIEW IF EXISTS public.utmify_success_rate;

-- Drop function used by utmify
DROP FUNCTION IF EXISTS public.acquire_utmify_lock;

-- Drop all migrated tables
DROP TABLE IF EXISTS public.support_messages;
DROP TABLE IF EXISTS public.support_conversations;
DROP TABLE IF EXISTS public.site_banners;
DROP TABLE IF EXISTS public.utmify_event_log;
DROP TABLE IF EXISTS public.capi_event_log;
DROP TABLE IF EXISTS public.analytics_events;
DROP TABLE IF EXISTS public.sale_addons;
DROP TABLE IF EXISTS public.post_payment_pages;
DROP TABLE IF EXISTS public.guest_orders;
