-- ============================================================================
-- VALNIX — Security hardening migration (2026-05-17)
-- ============================================================================
-- Run after the initial schema. Idempotent.
--
-- 1. pop_delivery_code() — atomic pop of the first auto-delivery code for a
--    product. Serializes concurrent pops via FOR UPDATE so the same code is
--    never handed to two customers (fix for the read-then-write race in the
--    old process-delivery logic).
-- 2. push_back_delivery_code() — for rollback when item-update fails after
--    a successful pop, so we don't permanently lose a code.
-- 3. Partial unique index on order_items.delivery_code — defense in depth:
--    even if logic regresses, the DB refuses to assign the same code twice.
-- 4. sale_addons uniqueness on (order_id, addon_type) — needed for the
--    upsert in dice-pix?action=create when an upsell PIX is generated.
-- 5. post_payment_pages.addon_type enum-ish check.
-- ============================================================================

-- ── 1. Atomic pop of first delivery code ────────────────────────────────────
create or replace function public.pop_delivery_code(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  -- FOR UPDATE serializes concurrent pops on the same product. Each waiting
  -- transaction sees the post-update state and picks the next code (or null).
  perform 1 from public.products where id = p_product_id for update;

  select coalesce(auto_delivery_codes[1], null) into v_code
  from public.products
  where id = p_product_id;

  if v_code is not null then
    update public.products
    set auto_delivery_codes = coalesce(auto_delivery_codes[2:], '{}'::text[])
    where id = p_product_id;
  end if;

  return v_code;
end;
$$;

revoke all on function public.pop_delivery_code(uuid) from public;
grant execute on function public.pop_delivery_code(uuid) to service_role;

-- ── 2. Push a code back to the front (rollback path) ────────────────────────
create or replace function public.push_back_delivery_code(p_product_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is null or p_code = '' then
    return;
  end if;
  perform 1 from public.products where id = p_product_id for update;
  update public.products
  set auto_delivery_codes = array_prepend(p_code, coalesce(auto_delivery_codes, '{}'::text[]))
  where id = p_product_id;
end;
$$;

revoke all on function public.push_back_delivery_code(uuid, text) from public;
grant execute on function public.push_back_delivery_code(uuid, text) to service_role;

-- ── 3. Defense-in-depth: a code can only be assigned to one item ────────────
-- Partial index allows NULL (most items start undelivered) but enforces
-- uniqueness across all non-null codes globally. If you ever sell the same
-- code intentionally (you shouldn't), drop or scope this.
create unique index if not exists ux_order_items_delivery_code
  on public.order_items (delivery_code)
  where delivery_code is not null;

-- ── 4. sale_addons uniqueness for upsert by (order_id, addon_type) ──────────
-- Needed because dice-pix?action=create now upserts the sale_addons row when
-- generating the upsell PIX (instead of the old public addon-create endpoint).
create unique index if not exists ux_sale_addons_order_addon
  on public.sale_addons (order_id, addon_type)
  where order_id is not null;

-- ── 5. addon_type whitelist on sale_addons & post_payment_pages ────────────
-- Soft enforcement via CHECK; values match the storefront's known upsell types.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_addons_addon_type_chk') then
    alter table public.sale_addons
      add constraint sale_addons_addon_type_chk
      check (addon_type in ('premium_benefits', 'delivery_priority', 'data_swap_warranty'));
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'post_payment_pages_addon_type_chk') then
    alter table public.post_payment_pages
      add constraint post_payment_pages_addon_type_chk
      check (addon_type in ('premium_benefits', 'delivery_priority', 'data_swap_warranty'));
  end if;
exception when others then null;
end $$;

-- ── 6. orders.payment_method check (only 'pix' is supported post-Dice migration) ──
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_chk') then
    alter table public.orders
      add constraint orders_payment_method_chk
      check (payment_method is null or payment_method in ('pix'));
  end if;
exception when others then null;
end $$;
