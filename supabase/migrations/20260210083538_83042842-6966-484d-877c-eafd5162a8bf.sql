
-- Drop the restrictive INSERT policy that requires amount > 0
DROP POLICY IF EXISTS "Restricted insert sale_addons" ON public.sale_addons;

-- Create new INSERT policy that allows amount >= 0 (skips have amount = 0)
-- No auth check since project uses Firebase Auth, not Supabase Auth
CREATE POLICY "Allow insert sale_addons"
  ON public.sale_addons
  FOR INSERT
  WITH CHECK (
    order_id IS NOT NULL 
    AND addon_type IS NOT NULL 
    AND length(order_id) > 0 
    AND length(addon_type) > 0 
    AND amount >= 0
  );
