-- 0035_partial_po_receiving.sql
-- Partial PO receiving: a purchase order can now be received in
-- several receipts over days, and closed off when the remainder
-- will never arrive (design: PARTIAL_PO_RECEIVING_DESIGN.md §4.1).
--
-- Three schema gaps blocked this, all fixed here:
--  1. The purchase_orders.status CHECK (0003, created inline on the
--     column, so Postgres named it purchase_orders_status_check)
--     rejects the two new statuses: PARTIALLY_RECEIVED (some goods
--     in, some outstanding) and CLOSED (some in, remainder written
--     off by decision). RECEIVED keeps its exact meaning — every
--     ordered item arrived.
--  2. The purchase_order_items_update RLS policy (0003) allows line
--     updates only while the parent PO is DRAFT or ORDERED. Once a
--     PO sits in PARTIALLY_RECEIVED, every further received_quantity
--     update would be silently RLS-blocked — the policy is widened
--     to include PARTIALLY_RECEIVED in USING and WITH CHECK.
--  3. Over-receipt was only a UI hope. A CHECK now guarantees
--     received_quantity <= quantity at the database (§3-Q4: hard
--     block, no override in v1).
--
-- received_amount is the maintained money value of what has
-- actually arrived (sum of received_quantity * unit_cost over the
-- PO's lines), kept by the receive service on every receipt. The
-- money consumers (day totals, P&L, supplier payables, purchase
-- report) count received_amount for RECEIVED / PARTIALLY_RECEIVED /
-- CLOSED orders instead of equating RECEIVED with the full
-- total_amount. The backfill below sets every existing RECEIVED
-- order's received_amount to its total_amount exactly, so no
-- historical figure moves the day this lands.

-- --- received_amount ---------------------------------------------------------
alter table public.purchase_orders
  add column if not exists received_amount numeric(12,2) not null default 0;

-- --- widen the status CHECK ----------------------------------------------------
-- Drop by its expected name, then defensively drop any other CHECK
-- on purchase_orders whose definition is the status enum (mentions
-- the DRAFT literal), in case a database named it differently.
alter table public.purchase_orders
  drop constraint if exists purchase_orders_status_check;

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'purchase_orders'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''DRAFT''%'
  loop
    execute format(
      'alter table public.purchase_orders drop constraint %I',
      con.conname
    );
  end loop;
end;
$$;

alter table public.purchase_orders
  add constraint purchase_orders_status_check
  check (status in (
    'DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED',
    'RECEIVED', 'CLOSED', 'CANCELLED'
  ));

-- --- backfill received_amount --------------------------------------------------
-- RECEIVED orders: exactly total_amount (full receipt set every
-- line's received_quantity = quantity, so the two are identical by
-- construction — pinning it keeps historical figures bit-exact).
update public.purchase_orders
  set received_amount = total_amount
  where status = 'RECEIVED';

-- Everything else: what has arrived so far, from the lines.
update public.purchase_orders po
  set received_amount = coalesce((
    select round(sum(poi.received_quantity * poi.unit_cost), 2)
    from public.purchase_order_items poi
    where poi.purchase_order_id = po.id
  ), 0)
  where po.status <> 'RECEIVED';

-- --- over-receipt hard block -----------------------------------------------------
alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_received_within_quantity;

alter table public.purchase_order_items
  add constraint purchase_order_items_received_within_quantity
  check (received_quantity <= quantity);

-- --- widen the line-update RLS policy --------------------------------------------
-- Same shape as 0003, with PARTIALLY_RECEIVED added to both clauses
-- so a PO stays receivable across as many receipts as it takes.
drop policy if exists purchase_order_items_update on public.purchase_order_items;
create policy purchase_order_items_update on public.purchase_order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
        and po.status in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED')
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
        and po.status in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED')
    )
  );
