-- Fix password_reset_tokens RLS policies for defense in depth

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Sistema pode criar tokens de reset" ON password_reset_tokens;

-- Keep the existing correct SELECT policy (blocks all access)
-- "Tokens não são públicos" USING (false) - already correct

-- Create proper INSERT policy restricted to service_role only
CREATE POLICY "Service role creates tokens" 
ON password_reset_tokens FOR INSERT 
WITH CHECK (auth.role() = 'service_role');

-- Add UPDATE policy restricted to service_role (for marking tokens as used)
CREATE POLICY "Service role updates tokens" 
ON password_reset_tokens FOR UPDATE 
USING (auth.role() = 'service_role');

-- Add DELETE policy restricted to service_role (for cleanup function)
CREATE POLICY "Service role deletes tokens" 
ON password_reset_tokens FOR DELETE 
USING (auth.role() = 'service_role');