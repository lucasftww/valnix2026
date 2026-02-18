-- Fix avatars bucket: tighten INSERT and UPDATE policies to require authentication
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;

-- Recreate with proper auth checks
CREATE POLICY "Authenticated users can upload avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Ensure no one can delete avatars except service_role (no policy = blocked by RLS)
-- Banners: already secure (SELECT only, writes blocked by RLS default)

-- Add DELETE protection for banners (prevent accidental policy additions)
-- No changes needed - RLS default blocks all operations without explicit policies