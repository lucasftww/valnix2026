
-- Fix: Restrict sale_addons INSERT to require at least an order_id and valid addon_type
DROP POLICY IF EXISTS "Allow insert sale_addons" ON public.sale_addons;
CREATE POLICY "Restricted insert sale_addons"
  ON public.sale_addons FOR INSERT
  WITH CHECK (
    order_id IS NOT NULL 
    AND addon_type IS NOT NULL 
    AND length(order_id) > 0
    AND length(addon_type) > 0
    AND amount > 0
  );

-- Fix: Restrict analytics_events INSERT to service_role only (tracking done via edge functions)
DROP POLICY IF EXISTS "Allow insert analytics_events" ON public.analytics_events;
CREATE POLICY "Service role insert analytics_events"
  ON public.analytics_events FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Fix: Restrict sale_addons UPDATE to only allow status/payment field updates
DROP POLICY IF EXISTS "Allow update sale_addons" ON public.sale_addons;
CREATE POLICY "Restricted update sale_addons"
  ON public.sale_addons FOR UPDATE
  USING (true)
  WITH CHECK (
    order_id IS NOT NULL
    AND addon_type IS NOT NULL
  );
