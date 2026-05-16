-- ============================================================================
-- VALNIX — Initial schema (Firestore → Supabase migration)
-- ============================================================================
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh DB.
-- Idempotent where possible (IF NOT EXISTS); RLS policies use DROP POLICY IF EXISTS.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "uuid-ossp";

-- ============================================================================
-- categories
-- ============================================================================
create table if not exists public.categories (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  description     text,
  image_url       text,
  icon_url        text,
  parent_id       uuid references public.categories(id) on delete set null,
  is_active       boolean not null default true,
  display_order   integer not null default 0,
  show_on_homepage boolean default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_categories_slug on public.categories(slug);
create index if not exists idx_categories_active_order on public.categories(is_active, display_order);
create index if not exists idx_categories_parent on public.categories(parent_id);

-- ============================================================================
-- products
-- ============================================================================
create table if not exists public.products (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  description                 text,
  rich_description            text,
  price                       numeric(10,2) not null check (price >= 0),
  old_price                   numeric(10,2) check (old_price is null or old_price >= 0),
  discount                    numeric(5,2) check (discount is null or (discount >= 0 and discount <= 100)),
  image_url                   text,
  icon_url                    text,
  category                    text not null,         -- category slug (denormalized for speed)
  is_active                   boolean not null default true,
  featured                    boolean not null default false,
  is_featured_in_category     boolean not null default false,
  display_order               integer not null default 0,
  stock                       integer,                -- null = unlimited
  sold                        integer default 0,
  delivery_type               text default 'manual',  -- 'manual' | 'auto'
  delivery_info               text,
  auto_delivery_codes         text[],                 -- pool of codes for auto delivery
  instructions                text,
  terms_conditions            text,
  video_url                   text,
  product_type                text,
  offer_hash                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_products_category_active_order on public.products(category, is_active, display_order);
create index if not exists idx_products_featured on public.products(featured) where featured = true;
create index if not exists idx_products_active on public.products(is_active);

-- ============================================================================
-- orders
-- ============================================================================
do $$ begin
  create type public.order_status as enum ('pending', 'processing', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed', 'expired', 'refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text,                            -- guest_xxx or auth.uid()::text
  guest_hash          text unique,                     -- public lookup hash (e.g. for /order/:hash)
  customer_name       text not null,
  customer_email      text,
  customer_phone      text,
  customer_document   text,                            -- CPF digits only
  total_amount        numeric(10,2) not null check (total_amount >= 0),
  status              public.order_status not null default 'pending',
  payment_status      public.payment_status not null default 'pending',
  payment_method      text,                            -- 'pix' | 'card'
  notes               text,
  -- Payment gateway tracking
  flowpay_charge_id   text,
  pix_code            text,
  pix_expires_at      timestamptz,
  -- Marketing attribution
  fbc                 text,
  fbp                 text,
  event_source_url    text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  -- Timestamps
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_payment_status on public.orders(payment_status, created_at desc);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_charge on public.orders(flowpay_charge_id);
create index if not exists idx_orders_guest_hash on public.orders(guest_hash);

-- ============================================================================
-- order_items
-- ============================================================================
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text not null,
  product_image   text,
  quantity        integer not null check (quantity > 0),
  unit_price      numeric(10,2) not null check (unit_price >= 0),
  total_price     numeric(10,2) not null check (total_price >= 0),
  delivery_type   text default 'manual',
  delivery_code   text,                                -- code/key delivered to customer
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_product on public.order_items(product_id);

-- ============================================================================
-- product_reviews (curated/manual reviews shown on category pages)
-- ============================================================================
create table if not exists public.product_reviews (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid references public.products(id) on delete cascade,
  category        text,                                -- category slug, for category-level reviews
  customer_name   text not null,
  rating          integer not null check (rating between 1 and 5),
  comment         text not null,
  display_order   integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_reviews_category_order on public.product_reviews(category, display_order);
create index if not exists idx_reviews_product on public.product_reviews(product_id);

-- ============================================================================
-- post_payment_pages (upsell pages config — premium_benefits, delivery_priority, data_swap_warranty)
-- ============================================================================
create table if not exists public.post_payment_pages (
  id                  uuid primary key default gen_random_uuid(),
  addon_type          text not null unique,            -- 'premium_benefits' | 'delivery_priority' | 'data_swap_warranty'
  title               text not null,
  subtitle            text,
  badge_text          text,
  badge_color         text not null default 'yellow',
  benefits            jsonb not null default '[]'::jsonb,  -- text[]
  price               numeric(10,2) not null check (price >= 0),
  original_price      numeric(10,2) check (original_price is null or original_price >= 0),
  button_accept_text  text not null default 'SIM! EU QUERO!',
  button_skip_text    text not null default 'Não, obrigado',
  next_route          text not null default '/',
  is_active           boolean not null default true,
  display_order       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_post_payment_pages_active on public.post_payment_pages(is_active, display_order);

-- ============================================================================
-- sale_addons (per-order log of addon attempts/conversions)
-- ============================================================================
create table if not exists public.sale_addons (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references public.orders(id) on delete set null,
  user_id             text,
  addon_type          text not null,                   -- matches post_payment_pages.addon_type
  status              text not null default 'pending', -- 'pending' | 'paid' | 'skipped' | 'failed'
  amount              numeric(10,2),
  pix_code            text,
  flowpay_charge_id   text,
  customer_email      text,
  customer_name       text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_sale_addons_order on public.sale_addons(order_id);
create index if not exists idx_sale_addons_addon on public.sale_addons(addon_type, status);

-- ============================================================================
-- post_payment_events (track-view / track-skip from /api/admin-post-payment)
-- ============================================================================
create table if not exists public.post_payment_events (
  id              uuid primary key default gen_random_uuid(),
  order_id        text,
  addon_type      text not null,
  event_type      text not null,                       -- 'view' | 'skip' | 'click'
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_post_payment_events_addon on public.post_payment_events(addon_type, event_type, created_at desc);
create index if not exists idx_post_payment_events_order on public.post_payment_events(order_id);

-- ============================================================================
-- analytics_events (Meta CAPI / server-relay log + replay)
-- ============================================================================
create table if not exists public.analytics_events (
  id              uuid primary key default gen_random_uuid(),
  event_id        text unique,                         -- doc id used for dedup/replay
  event_name      text not null,
  url             text,
  user_data       jsonb,
  custom_data     jsonb,
  source          text default 'server-relay-vercel',
  status          text not null default 'pending',     -- 'pending' | 'relayed' | 'failed'
  status_code     integer,
  error           text,
  meta_response   jsonb,
  timestamp       timestamptz not null default now(),
  updated_at      timestamptz
);
create index if not exists idx_analytics_status_ts on public.analytics_events(status, timestamp desc);
create index if not exists idx_analytics_event_name on public.analytics_events(event_name, timestamp desc);
create index if not exists idx_analytics_ts on public.analytics_events(timestamp desc);

-- ============================================================================
-- newsletter_subscribers
-- ============================================================================
create table if not exists public.newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  user_id     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_newsletter_email on public.newsletter_subscribers(email);

-- ============================================================================
-- store_metrics (front-end events relayed via /api/store-metrics)
-- ============================================================================
create table if not exists public.store_metrics (
  id              uuid primary key default gen_random_uuid(),
  event_name      text not null,
  user_id         text,
  page_url        text,
  device_type     text,
  browser         text,
  value           numeric(10,2),
  currency        text,
  order_id        text,
  content_name    text,
  timestamp       timestamptz not null default now()
);
create index if not exists idx_store_metrics_event_ts on public.store_metrics(event_name, timestamp desc);
create index if not exists idx_store_metrics_order on public.store_metrics(order_id);

-- ============================================================================
-- system_credentials (Meta CAPI tokens, stored server-side only)
-- ============================================================================
create table if not exists public.system_credentials (
  key             text primary key,                    -- e.g. 'meta_capi'
  data            jsonb not null,                      -- { token, pixel_id, ... }
  updated_at      timestamptz not null default now()
);

-- ============================================================================
-- updated_at trigger (generic)
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'categories','products','orders','order_items',
    'post_payment_pages','sale_addons','system_credentials'
  ]) loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- RLS — Row Level Security
-- ============================================================================
-- Strategy:
--   * Public reads (anon role): products, categories, post_payment_pages,
--     product_reviews — only when is_active = true.
--   * Public reads of own order: via guest_hash (passed as param).
--   * All writes: blocked for anon. Server (service_role) bypasses RLS.
--   * No table is exposed for anon writes — all order creation goes through
--     the /api/create-order serverless function using service_role.
-- ============================================================================

alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.product_reviews     enable row level security;
alter table public.post_payment_pages  enable row level security;
alter table public.sale_addons         enable row level security;
alter table public.post_payment_events enable row level security;
alter table public.analytics_events    enable row level security;
alter table public.store_metrics            enable row level security;
alter table public.newsletter_subscribers   enable row level security;
alter table public.system_credentials       enable row level security;

-- Public anon CAN insert into newsletter_subscribers (write-only, no read).
drop policy if exists "newsletter_subscribers_public_insert" on public.newsletter_subscribers;
create policy "newsletter_subscribers_public_insert"
  on public.newsletter_subscribers for insert
  to anon, authenticated
  with check (
    email is not null
    and length(email) <= 320
    and email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

-- Public read: active categories
drop policy if exists "categories_public_read_active" on public.categories;
create policy "categories_public_read_active"
  on public.categories for select
  to anon, authenticated
  using (is_active = true);

-- Public read: active products
drop policy if exists "products_public_read_active" on public.products;
create policy "products_public_read_active"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

-- Public read: active post_payment_pages
drop policy if exists "post_payment_pages_public_read_active" on public.post_payment_pages;
create policy "post_payment_pages_public_read_active"
  on public.post_payment_pages for select
  to anon, authenticated
  using (is_active = true);

-- Public read: product_reviews (no is_active flag — all are curated/manual)
drop policy if exists "product_reviews_public_read" on public.product_reviews;
create policy "product_reviews_public_read"
  on public.product_reviews for select
  to anon, authenticated
  using (true);

-- system_credentials: NO public access at all (only service_role bypasses RLS).
-- Note: no policies = deny all for non-service roles.

-- analytics_events / sale_addons / post_payment_events / orders / order_items:
-- NO anon read. All access goes through serverless functions with service_role.
-- ============================================================================
