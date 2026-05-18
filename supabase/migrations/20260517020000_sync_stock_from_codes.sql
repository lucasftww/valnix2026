-- ============================================================================
-- Keep `products.stock` in sync with `cardinality(auto_delivery_codes)`
-- whenever delivery_type='auto'. This way the storefront (which can no longer
-- read auto_delivery_codes thanks to the column-level REVOKE) still gets an
-- accurate inventory count via the public `stock` column.
--
-- For delivery_type<>'auto', stock is left to the admin (manual delivery
-- inventory is opaque to the system; admin sets it explicitly).
-- ============================================================================

create or replace function public.sync_stock_from_codes()
returns trigger
language plpgsql
as $$
begin
  if new.delivery_type = 'auto' then
    new.stock := coalesce(array_length(new.auto_delivery_codes, 1), 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_sync_stock on public.products;
create trigger trg_products_sync_stock
  before insert or update of auto_delivery_codes, delivery_type
  on public.products
  for each row
  execute function public.sync_stock_from_codes();

-- One-time backfill: bring existing rows in sync.
update public.products
   set stock = coalesce(array_length(auto_delivery_codes, 1), 0)
 where delivery_type = 'auto';
