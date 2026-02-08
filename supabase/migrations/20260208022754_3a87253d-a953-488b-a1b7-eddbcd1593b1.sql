
-- Fix: All existing policies are RESTRICTIVE which blocks all access.
-- Drop them and recreate as PERMISSIVE.

-- post_payment_pages
DROP POLICY IF EXISTS "Anyone can read active post_payment_pages" ON public.post_payment_pages;
DROP POLICY IF EXISTS "Anyone can update post_payment_pages" ON public.post_payment_pages;
DROP POLICY IF EXISTS "Anyone can insert post_payment_pages" ON public.post_payment_pages;
DROP POLICY IF EXISTS "Anyone can delete post_payment_pages" ON public.post_payment_pages;

CREATE POLICY "Allow read post_payment_pages"
  ON public.post_payment_pages FOR SELECT
  USING (true);

CREATE POLICY "Allow insert post_payment_pages"
  ON public.post_payment_pages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow update post_payment_pages"
  ON public.post_payment_pages FOR UPDATE
  USING (true);

CREATE POLICY "Allow delete post_payment_pages"
  ON public.post_payment_pages FOR DELETE
  USING (true);

-- sale_addons
DROP POLICY IF EXISTS "Anyone can read sale_addons" ON public.sale_addons;
DROP POLICY IF EXISTS "Anyone can insert sale_addons" ON public.sale_addons;
DROP POLICY IF EXISTS "Anyone can update sale_addons" ON public.sale_addons;

CREATE POLICY "Allow read sale_addons"
  ON public.sale_addons FOR SELECT
  USING (true);

CREATE POLICY "Allow insert sale_addons"
  ON public.sale_addons FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow update sale_addons"
  ON public.sale_addons FOR UPDATE
  USING (true);

-- analytics_events
DROP POLICY IF EXISTS "Service role full access" ON public.analytics_events;

CREATE POLICY "Allow read analytics_events"
  ON public.analytics_events FOR SELECT
  USING (true);

CREATE POLICY "Allow insert analytics_events"
  ON public.analytics_events FOR INSERT
  WITH CHECK (true);
