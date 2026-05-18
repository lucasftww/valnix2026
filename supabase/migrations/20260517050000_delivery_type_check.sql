-- ============================================================================
-- Enforce delivery_type values. The admin form previously had a buggy
-- "automatic" option that would silently break auto-delivery (the rest of
-- the system only checks for 'auto'). A CHECK constraint stops the next
-- regression from making it past Postgres.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_delivery_type_chk') then
    alter table public.products
      add constraint products_delivery_type_chk
      check (delivery_type is null or delivery_type in ('manual', 'auto'));
  end if;
exception when others then null;
end $$;
