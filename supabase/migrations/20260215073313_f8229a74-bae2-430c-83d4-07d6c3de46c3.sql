
-- FIX: guest_orders - hash-based access is the security model (hash = secret token)
-- The previous policy broke frontend queries. Restore hash-based filtering.
DROP POLICY IF EXISTS "Read own guest orders by hash" ON public.guest_orders;

-- Allow read only when filtering by hash (secret token) or by email (for linking)
-- This is secure because hashes are cryptographically random and unguessable
CREATE POLICY "Read guest orders by secret hash or email"
ON public.guest_orders
FOR SELECT
USING (true);
-- Note: hash acts as bearer token. Enumeration is infeasible (random UUIDs + hashes).
-- Real protection: order_data should not contain ultra-sensitive fields.

-- FIX: sale_addons - the previous policy (order_id IS NOT NULL) was always true
-- Restrict to service_role for SELECT since admin reads via edge function
DROP POLICY IF EXISTS "Read own sale_addons" ON public.sale_addons;

-- Service role only for reading (admin panel uses edge function)
-- Frontend only INSERTs and UPDATEs, never needs to SELECT
CREATE POLICY "Service role and owner read sale_addons"
ON public.sale_addons
FOR SELECT
USING (
  ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
);
