-- Migration 0025: order merge (RestoraPOS gap roadmap, Wave 3 gap 3).
--
-- orders.merged_into_id records where a merged-away order went. The
-- merge itself runs in ONE SECURITY DEFINER RPC so the multi-row move
-- (items, payments, totals, statuses, table release) is atomic — a
-- half-merged order must never exist.
--
-- Rules (v1, per the approved design):
-- * same restaurant; both orders open (not DRAFT, not terminal).
-- * delivery orders are refused (a dispatch row would be orphaned).
-- * orders with a coupon or a loyalty redemption are refused
--   (redemption rows point at the source order; re-pointing them is
--   a v2 problem). Loyalty EARN needs no handling: points are earned
--   at completion, and completed orders cannot merge.
-- * money is NEVER recomputed: item snapshots move as-is and the
--   target's stored money columns gain the source's, column by
--   column (both were validated when placed).
-- * stock does NOT move: deduction already happened per item, the
--   items keep their identity under the target, and cancelling the
--   merged order later restocks everything from the combined list.
-- * the source becomes CANCELLED by DIRECT write — never through
--   the cancel path, which would restock the moved items.
-- * when a manager PIN is set (migration 0024) the merge asks for
--   it, verified here exactly like cancel/refund.

alter table public.orders
  add column if not exists merged_into_id uuid references public.orders(id);

create or replace function public.merge_orders(
  p_source_id uuid,
  p_target_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_source public.orders%rowtype;
  v_target public.orders%rowtype;
  v_hash text;
begin
  if p_source_id = p_target_id then
    raise exception 'merge_same_order';
  end if;

  select * into v_source from public.orders where id = p_source_id;
  select * into v_target from public.orders where id = p_target_id;
  if v_source.id is null or v_target.id is null
     or v_source.restaurant_id <> public.current_restaurant_id()
     or v_target.restaurant_id <> v_source.restaurant_id then
    raise exception 'not_allowed';
  end if;

  if v_source.status in ('DRAFT', 'COMPLETED', 'CANCELLED', 'REFUNDED')
     or v_target.status in ('DRAFT', 'COMPLETED', 'CANCELLED', 'REFUNDED') then
    raise exception 'merge_invalid_status';
  end if;

  if v_source.type = 'delivery' or v_target.type = 'delivery'
     or exists (
       select 1 from public.delivery_orders d
       where d.order_id in (p_source_id, p_target_id)
     ) then
    raise exception 'merge_delivery_not_supported';
  end if;

  if v_source.coupon_id is not null or v_target.coupon_id is not null
     or coalesce(v_source.loyalty_points_redeemed, 0) > 0
     or coalesce(v_target.loyalty_points_redeemed, 0) > 0 then
    raise exception 'merge_loyalty_coupon_not_supported';
  end if;

  select s.manager_pin_hash into v_hash
  from public.restaurant_secrets s
  where s.restaurant_id = v_source.restaurant_id;
  if v_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      raise exception 'pin_required';
    end if;
    if encode(digest(v_source.restaurant_id::text || ':' || p_pin, 'sha256'), 'hex') <> v_hash then
      raise exception 'pin_incorrect';
    end if;
  end if;

  update public.order_items
  set order_id = p_target_id
  where order_id = p_source_id;

  update public.order_payments
  set order_id = p_target_id
  where order_id = p_source_id;

  update public.orders
  set subtotal = subtotal + v_source.subtotal,
      discount_amount = discount_amount + v_source.discount_amount,
      tax_amount = tax_amount + v_source.tax_amount,
      service_charge_amount = service_charge_amount + v_source.service_charge_amount,
      total_amount = total_amount + v_source.total_amount
  where id = p_target_id;

  update public.orders
  set status = 'CANCELLED', merged_into_id = p_target_id
  where id = p_source_id;

  insert into public.order_status_history
    (id, order_id, from_status, to_status, changed_by, note)
  values
    (gen_random_uuid(), p_source_id, v_source.status, 'CANCELLED',
     auth.uid(),
     'Merged into order #' || v_target.order_number
       || case when v_hash is not null then ' (PIN verified)' else '' end);

  insert into public.order_status_history
    (id, order_id, from_status, to_status, changed_by, note)
  values
    (gen_random_uuid(), p_target_id, v_target.status, v_target.status,
     auth.uid(),
     'Order #' || v_source.order_number || ' merged into this order');

  if v_source.table_id is not null
     and v_source.table_id is distinct from v_target.table_id then
    if not exists (
      select 1 from public.orders
      where table_id = v_source.table_id
        and status not in ('COMPLETED', 'CANCELLED', 'REFUNDED')
    ) then
      update public.tables
      set status = 'available'
      where id = v_source.table_id;
    end if;
  end if;
end;
$$;

grant execute on function public.merge_orders(uuid, uuid, text) to authenticated;
