-- Fix security issues: orders and order_items data exposure

-- ISSUE 1: Orders table - Block unauthenticated access to customer PII
-- Add explicit policy to ensure only authenticated users can access orders
-- (The existing policies already require auth.uid() = user_id, but adding explicit block for safety)

-- First, let's ensure unauthenticated users are explicitly blocked
DROP POLICY IF EXISTS "Block unauthenticated access to orders" ON public.orders;
CREATE POLICY "Block unauthenticated access to orders"
ON public.orders
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- ISSUE 2: Order items - Ensure delivery codes are only visible for PAID orders
-- Update the policy to be more restrictive

-- Drop the existing policy that may allow access to unpaid order items
DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;

-- Recreate with stricter check - only paid orders can see delivery codes
CREATE POLICY "Users can view own paid order items"
ON public.order_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND orders.user_id = auth.uid()
    AND orders.payment_status = 'paid'
  )
);

-- Also block unauthenticated access explicitly
DROP POLICY IF EXISTS "Block unauthenticated access to order_items" ON public.order_items;
CREATE POLICY "Block unauthenticated access to order_items"
ON public.order_items
FOR SELECT
USING (auth.uid() IS NOT NULL);