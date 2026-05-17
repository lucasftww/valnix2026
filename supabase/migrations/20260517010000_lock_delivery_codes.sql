-- ============================================================================
-- Defense-in-depth: prevent anon / authenticated roles from reading
-- products.auto_delivery_codes via the Supabase REST API even if a client
-- accidentally `.select('*')`. service_role bypasses these grants.
-- ============================================================================

-- Revoke broad table SELECT, then re-grant SELECT on every column EXCEPT
-- auto_delivery_codes. The RLS row policy (products_public_read_active)
-- still applies on top.
revoke select on public.products from anon, authenticated;

grant select (
  id, name, description, rich_description, price, old_price, discount,
  image_url, icon_url, category, is_active, featured, is_featured_in_category,
  display_order, stock, sold, delivery_type, delivery_info,
  instructions, terms_conditions, video_url, product_type, offer_hash,
  created_at, updated_at
) on public.products to anon, authenticated;
