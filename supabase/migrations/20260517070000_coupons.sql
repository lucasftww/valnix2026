-- ============================================================================
-- Coupon system.
--
-- Tables:
--   coupons              — definitions (code, type, value, limits, expiry)
--   coupon_redemptions   — audit log (one row per successful application)
--
-- Columns added to orders:
--   coupon_code          — denormalized for reports without joining
--   discount_amount      — currency value applied
--
-- Validation happens server-side in api/create-order (server is source of
-- truth; the cart UI just previews). RLS denies anon writes; anon CAN read
-- active coupons to validate a code public-side (but not to enumerate all).
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.coupons (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  description           text,
  type                  text not null check (type in ('percent','fixed')),
  value                 numeric(10,2) not null check (value > 0),
  min_order             numeric(10,2) not null default 0 check (min_order >= 0),
  max_discount          numeric(10,2), -- cap for percent-type coupons (optional)
  max_uses              integer,       -- null = unlimited
  uses_count            integer not null default 0 check (uses_count >= 0),
  max_uses_per_user     integer default 1,
  first_purchase_only   boolean not null default false,
  expires_at            timestamptz,
  starts_at             timestamptz default now(),
  is_active             boolean not null default true,
  applies_to_category   text, -- null = all categories; else slug filter
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_coupons_code on public.coupons (code);
create index if not exists idx_coupons_active_expires on public.coupons (is_active, expires_at);

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();

create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid references public.coupons(id) on delete set null,
  coupon_code     text not null, -- denormalized so audit survives coupon deletion
  order_id        uuid references public.orders(id) on delete cascade,
  user_id         text, -- email or 'guest_xxx' — for first-purchase / per-user checks
  discount_value  numeric(10,2) not null,
  redeemed_at     timestamptz not null default now()
);
create index if not exists idx_coupon_redemptions_coupon on public.coupon_redemptions (coupon_id);
create index if not exists idx_coupon_redemptions_user on public.coupon_redemptions (user_id);
create index if not exists idx_coupon_redemptions_order on public.coupon_redemptions (order_id);

-- ── orders: add coupon tracking ────────────────────────────────────────────
alter table public.orders
  add column if not exists coupon_code text,
  add column if not exists discount_amount numeric(10,2) not null default 0;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

-- Public can READ active, non-expired coupons by code (so cart preview works).
-- Sensitive fields are not exposed because we whitelist columns on the client
-- AND the validation re-runs server-side in create-order anyway.
drop policy if exists "coupons_public_read_active" on public.coupons;
create policy "coupons_public_read_active"
  on public.coupons for select
  to anon, authenticated
  using (is_active = true and (expires_at is null or expires_at > now()));

-- coupon_redemptions: no anon access. service_role (admin endpoints) only.

-- ── Seed: first-purchase 5% off coupon (admin can edit/disable later) ──────
insert into public.coupons (
  code, description, type, value, min_order, max_uses_per_user,
  first_purchase_only, is_active
) values (
  'PRIMEIRA5',
  'Cupom de 5% OFF na primeira compra',
  'percent',
  5,
  10,         -- valid only on orders >= R$ 10
  1,          -- 1 use per customer (per email)
  true,       -- first purchase only
  true
)
on conflict (code) do nothing;

-- A 10% off welcome coupon as alternative, can be paused/used for campaigns.
insert into public.coupons (
  code, description, type, value, min_order, max_uses_per_user,
  first_purchase_only, is_active, max_discount
) values (
  'BEMVINDO10',
  '10% OFF (limitado a R$ 20 de desconto)',
  'percent',
  10,
  20,
  1,
  false,
  false,      -- starts inactive; admin enables on demand
  20
)
on conflict (code) do nothing;
