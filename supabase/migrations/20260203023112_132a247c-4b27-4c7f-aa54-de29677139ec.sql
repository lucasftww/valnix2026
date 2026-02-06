-- Allow the public client roles to read catalog tables (required for the REST API)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.categories, public.products, public.site_banners, public.product_reviews TO anon, authenticated;
GRANT ALL ON TABLE public.categories, public.products, public.site_banners, public.product_reviews TO service_role;

-- Align categories columns with frontend expectations
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id UUID;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS show_on_homepage BOOLEAN NOT NULL DEFAULT true;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_home ON public.categories(show_on_homepage, display_order);

-- Request REST schema cache reload (harmless if already current)
SELECT pg_notify('pgrst', 'reload schema');