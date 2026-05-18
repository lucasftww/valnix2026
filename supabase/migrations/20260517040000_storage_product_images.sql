-- ============================================================================
-- Storage bucket for admin-uploaded product/category images.
--
-- During the Lovable→Supabase migration the storefront kept consuming the
-- existing R2 URLs already in `products.image_url`, but the admin upload
-- flow (ImageUploader) still POSTs to `/api/upload-r2` which was never
-- ported. Result: admins can't add new products with images.
--
-- This sets up a Supabase Storage bucket so the new `/api/admin-data?resource=
-- upload-image` route (added in parallel) can upload via the service_role key
-- and return a public URL.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true, -- public-read so the storefront can hotlink the resulting URLs
  5 * 1024 * 1024, -- 5 MB cap (compressed images should be well under)
  array['image/webp', 'image/avif', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public READ policy. Writes go through service_role (admin API), so we don't
-- need anon write/update/delete.
drop policy if exists "product-images_public_read" on storage.objects;
create policy "product-images_public_read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'product-images');
