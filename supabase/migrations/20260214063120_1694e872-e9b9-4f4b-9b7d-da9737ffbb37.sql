-- Allow public SELECT on sale_addons so admin panel can read upsell stats
-- The admin panel is already protected by Firebase auth on the frontend
CREATE POLICY "Allow read sale_addons"
  ON public.sale_addons
  FOR SELECT
  USING (true);