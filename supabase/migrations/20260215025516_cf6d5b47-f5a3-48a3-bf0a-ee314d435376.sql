
-- Fix: Allow frontend to update pix_code/flowpay_charge_id on pending addons
-- but prevent status manipulation
DROP POLICY IF EXISTS "Service role update sale_addons" ON public.sale_addons;

-- Service role can do anything
CREATE POLICY "Service role update sale_addons"
ON public.sale_addons
FOR UPDATE
USING ((auth.jwt() ->> 'role') = 'service_role');

-- Frontend can only update pending addons and cannot change status to 'paid'
CREATE POLICY "Limited update pending sale_addons"
ON public.sale_addons
FOR UPDATE
USING (status = 'pending')
WITH CHECK (status = 'pending');
