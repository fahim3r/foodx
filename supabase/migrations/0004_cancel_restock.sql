-- ============================================================================
-- FoodX migration 0004 — restock on order cancel.
--
-- Cancelling an order now returns the stock its sale deducted: one
-- RESTOCK movement per item, exactly reversing the SALE movements that
-- deduct_stock_for_order() wrote. Refunds do NOT restock — a refunded
-- order was already served, the food is gone.
--
-- Changes:
--   1. stock_movements.movement_type CHECK gains 'RESTOCK'.
--   2. apply_stock_movement() allows 'RESTOCK' (it hardcodes the list).
--   3. New SECURITY DEFINER function restock_for_order(p_order_id):
--      no-op when nothing was deducted, idempotent (never restocks the
--      same order twice), restaurant-scoped like deduct_stock_for_order.
-- ============================================================================

-- --- 1. widen the movement_type check ---------------------------------------
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.stock_movements'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%movement_type%';
  if cname is not null then
    execute format('alter table public.stock_movements drop constraint %I', cname);
  end if;
end $$;

alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in (
    'PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESTOCK'
  ));

-- --- 2. apply_stock_movement(): allow 'RESTOCK' ------------------------------
-- (Full redefinition — the only change from 0003 is the added type.)
create or replace function public.apply_stock_movement(
  p_item_id uuid,
  p_type text,
  p_delta numeric,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_new_quantity numeric;
begin
  if p_type not in ('PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESTOCK') then
    raise exception 'invalid movement type: %', p_type;
  end if;
  if p_delta = 0 then
    raise exception 'movement quantity must not be zero';
  end if;

  select restaurant_id into v_restaurant_id
  from public.inventory_items
  where id = p_item_id;
  if v_restaurant_id is null then
    raise exception 'inventory item not found';
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'inventory item belongs to another restaurant';
  end if;

  insert into public.stock_movements
    (restaurant_id, inventory_item_id, movement_type, quantity_change,
     reference_type, reference_id, reason, created_by)
  values
    (v_restaurant_id, p_item_id, p_type, p_delta,
     p_reference_type, p_reference_id, p_reason, auth.uid());

  update public.inventory_items
  set current_quantity = current_quantity + p_delta
  where id = p_item_id
  returning current_quantity into v_new_quantity;

  return v_new_quantity;
end;
$$;

-- --- 3. restock_for_order(): reverse an order's SALE movements --------------
create or replace function public.restock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_number integer;
  v_has_sale boolean;
  v_has_restock boolean;
  r record;
begin
  select restaurant_id, order_number into v_restaurant_id, v_order_number
  from public.orders
  where id = p_order_id;
  if v_restaurant_id is null then
    raise exception 'order not found';
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'order belongs to another restaurant';
  end if;

  -- Only restock stock that was actually deducted.
  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  ) into v_has_sale;
  if not v_has_sale then
    return;
  end if;

  -- Idempotent: never restock the same order twice.
  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'RESTOCK'
  ) into v_has_restock;
  if v_has_restock then
    return;
  end if;

  -- Reverse each SALE movement exactly (one per item, as deducted).
  for r in
    select inventory_item_id as item_id, quantity_change
    from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  loop
    perform public.apply_stock_movement(
      r.item_id, 'RESTOCK', -r.quantity_change,
      'Restock — order #' || v_order_number || ' cancelled', 'order', p_order_id
    );
  end loop;
end;
$$;

grant execute on function public.restock_for_order(uuid) to authenticated;
revoke execute on function public.restock_for_order(uuid) from anon;
