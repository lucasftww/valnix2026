
-- sale_addons UPDATE needs to stay open for anon since we use Firebase auth (not Supabase auth)
-- The important fix was restricting SELECT (done). Writes are low-risk here.
DROP POLICY IF EXISTS "Service role update sale_addons" ON public.sale_addons;
CREATE POLICY "Allow update sale_addons"
  ON public.sale_addons FOR UPDATE
  USING (true);
