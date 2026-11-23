-- 0036_kds_station_progress.sql
-- Per-station KDS progress: each order item carries its own kitchen
-- progress (design: PER_STATION_KDS_DESIGN.md §4.1, decision D1), so
-- one station of an order can be Ready while another has not started.
-- The order-level status stays the derived truth every other surface
-- (To Serve, carousel, dashboard, sound watcher) already reads — the
-- KDS service derives it from the per-item states after every station
-- action and writes it through advanceOrderStatus as before.
--
-- Two schema gaps blocked this, both fixed here:
--  1. order_items had no progress column at all. kitchen_status is
--     added with a PENDING default, so every existing insert path
--     (POS service, place_online_order RPC, offline-queue sync) keeps
--     working untouched — no insert names the column.
--  2. The order_items_update RLS policy (0002) allows line updates
--     only while the parent order is DRAFT ("placed orders are
--     history"), which would silently block every kitchen_status
--     write after placement. The policy is widened to the kitchen
--     window (DRAFT / SENT_TO_KITCHEN / PREPARING); items of READY
--     or later orders lock again. The same trap class as migration
--     0035's purchase_order_items_update widening. Stated honestly:
--     an RLS policy cannot be column-scoped, so while an order sits
--     in the kitchen the widened policy technically allows updating
--     other item columns too; the service only ever writes
--     kitchen_status.
--
-- The backfill makes the KDS tell the truth the minute this lands:
-- items of orders already PREPARING become PREPARING, items of READY
-- orders become READY; SENT_TO_KITCHEN items stay PENDING, which is
-- correct by definition. No new table, no realtime publication
-- change (order_items has been in supabase_realtime since 0002), no
-- change to orders.

-- --- per-item kitchen progress column -----------------------------------------
alter table public.order_items
  add column if not exists kitchen_status text not null default 'PENDING';

alter table public.order_items
  drop constraint if exists order_items_kitchen_status_check;

alter table public.order_items
  add constraint order_items_kitchen_status_check
  check (kitchen_status in ('PENDING', 'PREPARING', 'READY'));

-- --- backfill in-flight orders --------------------------------------------------
update public.order_items oi
  set kitchen_status = 'PREPARING'
  from public.orders o
  where o.id = oi.order_id
    and o.status = 'PREPARING';

update public.order_items oi
  set kitchen_status = 'READY'
  from public.orders o
  where o.id = oi.order_id
    and o.status = 'READY';

-- --- widen the line-update RLS policy --------------------------------------------
-- Same shape as 0002, with the kitchen window added to both clauses
-- so a station can record progress while the order is in the kitchen.
drop policy if exists order_items_update on public.order_items;
create policy order_items_update on public.order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and o.status in ('DRAFT', 'SENT_TO_KITCHEN', 'PREPARING')
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and o.status in ('DRAFT', 'SENT_TO_KITCHEN', 'PREPARING')
    )
  );
