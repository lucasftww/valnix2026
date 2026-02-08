
-- 1. analytics_events: restrict SELECT to service_role only (admin edge function bypasses RLS)
DROP POLICY IF EXISTS "Allow read analytics_events" ON public.analytics_events;
CREATE POLICY "Service role read analytics_events"
  ON public.analytics_events FOR SELECT
  USING (auth.jwt()->>'role' = 'service_role');

-- 2. post_payment_pages: keep SELECT public, restrict writes to service_role
DROP POLICY IF EXISTS "Allow insert post_payment_pages" ON public.post_payment_pages;
DROP POLICY IF EXISTS "Allow update post_payment_pages" ON public.post_payment_pages;
DROP POLICY IF EXISTS "Allow delete post_payment_pages" ON public.post_payment_pages;

CREATE POLICY "Service role write post_payment_pages"
  ON public.post_payment_pages FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role update post_payment_pages"
  ON public.post_payment_pages FOR UPDATE
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role delete post_payment_pages"
  ON public.post_payment_pages FOR DELETE
  USING (auth.jwt()->>'role' = 'service_role');

-- 3. sale_addons: restrict SELECT to service_role, restrict UPDATE to service_role
DROP POLICY IF EXISTS "Allow read sale_addons" ON public.sale_addons;
DROP POLICY IF EXISTS "Allow update sale_addons" ON public.sale_addons;

CREATE POLICY "Service role read sale_addons"
  ON public.sale_addons FOR SELECT
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role update sale_addons"
  ON public.sale_addons FOR UPDATE
  USING (auth.jwt()->>'role' = 'service_role');
