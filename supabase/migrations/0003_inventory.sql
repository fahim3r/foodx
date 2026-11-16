-- ============================================================================
-- FoodX — Phase 3 (Inventory)
-- Migration 0003: stock, recipes, suppliers, purchases, movements
-- ============================================================================
-- Tables added (6): inventory_items, product_recipes, stock_movements,
-- suppliers, purchase_orders, purchase_order_items.
--
-- ISOLATION MODEL — same as 0001/0002: every restaurant-scoped row
-- carries a restaurant_id and policies allow a signed-in user to touch
-- only rows whose restaurant_id matches profiles.restaurant_id via
-- public.current_restaurant_id(). Child rows (product_recipes,
-- purchase_order_items) are scoped through their parent row with
-- EXISTS — they never query profiles directly and never query their own
-- table. stock_movements is scoped through its inventory item.
--
-- STOCK RULES (the heart of this phase — read before changing):
--   - Stock quantities change ONLY through stock_movements, applied by
--     the SECURITY DEFINER function apply_stock_movement(), which
--     inserts the movement row and updates the item's current_quantity
--     in one step. The app never updates current_quantity directly:
--     the item edit form has no quantity field, and the service layer
--     excludes current_quantity from its update patch type.
--   - stock_movements is append-only: SELECT policy only. No INSERT /
--     UPDATE / DELETE policy — rows can only be created by the two
--     functions below (which run as the function owner and bypass RLS).
--     Corrections go through a new ADJUSTMENT / WASTE movement, never
--     by editing or removing a movement row. The foreign key from
--     stock_movements to inventory_items is ON DELETE RESTRICT, so an
--     item with any movement history cannot be deleted at all.
--   - A SALE at the counter must never be blocked: deduct_stock_for_
--     order() allows current_quantity to go negative. Negative stock is
--     a data signal (highlighted in the stock list), not an error —
--     it means purchases were not recorded, or a recipe is wrong.
--   - deduct_stock_for_order() is IDEMPOTENT: if SALE movements already
--     exist for the order, it does nothing, so a retried POS placement
--     cannot double-deduct.
--   - Receiving a purchase order is FULL receipt only: every line is
--     received at its ordered quantity. Partial receiving is NOT
--     implemented (the service + UI say so); do not fake it.
--   - Cancelling an order does NOT restock ingredients (not
--     implemented) — the deduction stands as a SALE movement.
--
-- PURCHASE ORDER STATE MACHINE (enforced in the service layer; the
-- CHECK below only restricts `status` to the valid set):
--   DRAFT → ORDERED → RECEIVED
--   CANCELLED from DRAFT or ORDERED only
--   A RECEIVED order is final; a wrong receipt is corrected by an
--   ADJUSTMENT movement, never by editing the order.
--
-- Money is numeric(12,2), never float. Quantities are numeric(12,3)
-- (grams / millilitres need 3 decimals). Prices are NOT snapshotted on
-- purchase order items: a purchase order records what was agreed with
-- the supplier (unit_cost at order time), and receiving uses those same
-- lines — there is no customer-facing price to protect here.
--
-- IDEMPOTENT where practical (CREATE TABLE IF NOT EXISTS, DROP POLICY IF
-- EXISTS, CREATE INDEX IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- Requires Postgres 13+ and the Supabase auth schema (as 0001 does).
-- ============================================================================

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.inventory_items (
  id                   uuid          primary key default gen_random_uuid(),
  restaurant_id        uuid          not null references public.restaurants (id) on delete cascade,
  name                 text          not null,
  unit                 text          not null,
  current_quantity     numeric(12,3) not null default 0,
  low_stock_threshold  numeric(12,3) not null default 0,
  cost_price           numeric(12,2) not null default 0 check (cost_price >= 0),
  is_active            boolean       not null default true,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  unique (restaurant_id, name)
);

create table if not exists public.product_recipes (
  id                 uuid          primary key default gen_random_uuid(),
  restaurant_id      uuid          not null references public.restaurants (id) on delete cascade,
  product_id         uuid          not null references public.products (id) on delete cascade,
  inventory_item_id  uuid          not null references public.inventory_items (id) on delete cascade,
  quantity_per_unit  numeric(12,3) not null check (quantity_per_unit > 0),
  created_at         timestamptz   not null default now(),
  unique (product_id, inventory_item_id)
);

create table if not exists public.stock_movements (
  id              uuid          primary key default gen_random_uuid(),
  restaurant_id   uuid          not null references public.restaurants (id) on delete cascade,
  inventory_item_id uuid        not null references public.inventory_items (id) on delete restrict,
  movement_type   text          not null
    check (movement_type in (
      'PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT'
    )),
  -- Signed: positive = stock in, negative = stock out.
  quantity_change numeric(12,3) not null check (quantity_change <> 0),
  reference_type  text,
  reference_id    uuid,
  reason          text,
  created_by      uuid,
  created_at      timestamptz   not null default now()
);

create table if not exists public.suppliers (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  name          text        not null,
  phone         text,
  email         text,
  address       text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists public.purchase_orders (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  supplier_id   uuid          not null references public.suppliers (id) on delete restrict,
  status        text          not null default 'DRAFT'
    check (status in ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED')),
  order_date    date          not null default current_date,
  total_amount  numeric(12,2) not null default 0 check (total_amount >= 0),
  notes         text,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create table if not exists public.purchase_order_items (
  id                uuid          primary key default gen_random_uuid(),
  purchase_order_id uuid          not null references public.purchase_orders (id) on delete cascade,
  inventory_item_id uuid          not null references public.inventory_items (id) on delete restrict,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit_cost         numeric(12,2) not null check (unit_cost >= 0),
  received_quantity numeric(12,3) not null default 0 check (received_quantity >= 0),
  unique (purchase_order_id, inventory_item_id)
);

-- ----------------------------------------------------------------------------
-- updated_at triggers (all tables that have an updated_at column)
-- set_updated_at() is defined in 0001_foundation.sql.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Functions (stock movements — the only writers of stock_movements)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- apply_stock_movement(): the single way stock changes.
-- Inserts one stock_movements row and adjusts the item's
-- current_quantity by the same delta, in one step. Returns the new
-- quantity. Verifies the item belongs to the caller's restaurant;
-- raises otherwise. Negative results are allowed (see header).
-- ----------------------------------------------------------------------------
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
  if p_type not in ('PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT') then
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

-- ----------------------------------------------------------------------------
-- deduct_stock_for_order(): deduct recipe ingredients for one order.
-- Reads the order's items + product_recipes, aggregates the needed
-- quantity per ingredient, and applies one SALE movement per ingredient
-- (reference_type 'order'). IDEMPOTENT: if SALE movements already exist
-- for this order, it returns without deducting again. Raises when the
-- order does not exist or belongs to another restaurant.
-- ----------------------------------------------------------------------------
create or replace function public.deduct_stock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_number integer;
  v_already_deducted boolean;
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

  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  ) into v_already_deducted;
  if v_already_deducted then
    return;
  end if;

  for r in
    select pr.inventory_item_id as item_id,
           sum(oi.quantity * pr.quantity_per_unit) as total_needed
    from public.order_items oi
    join public.product_recipes pr on pr.product_id = oi.product_id
    where oi.order_id = p_order_id
    group by pr.inventory_item_id
  loop
    perform public.apply_stock_movement(
      r.item_id, 'SALE', -r.total_needed,
      'Sale — order #' || v_order_number, 'order', p_order_id
    );
  end loop;
end;
$$;

grant execute on function public.apply_stock_movement(uuid, text, numeric, text, text, uuid) to authenticated;
revoke execute on function public.apply_stock_movement(uuid, text, numeric, text, text, uuid) from anon;

grant execute on function public.deduct_stock_for_order(uuid) to authenticated;
revoke execute on function public.deduct_stock_for_order(uuid) from anon;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.inventory_items      enable row level security;
alter table public.product_recipes      enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.suppliers            enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;

-- --- inventory_items ---------------------------------------------------------
-- The app never updates current_quantity directly (see header): the
-- service excludes it from the update patch, and the only writer is
-- apply_stock_movement(). RLS does not enforce that split — it follows
-- the codebase pattern that the service is the gate (as with the
-- "table has active orders" rule in Phase 2).
drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- product_recipes ---------------------------------------------------------
-- Scoped through the parent product's restaurant AND the linked
-- inventory item's restaurant, so a recipe can never join a product to
-- another restaurant's ingredient. The row's own restaurant_id must
-- also match the caller's restaurant.
drop policy if exists product_recipes_select on public.product_recipes;
create policy product_recipes_select on public.product_recipes
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists product_recipes_insert on public.product_recipes;
create policy product_recipes_insert on public.product_recipes
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and exists (
      select 1 from public.products p
      where p.id = product_recipes.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
    and exists (
      select 1 from public.inventory_items i
      where i.id = product_recipes.inventory_item_id
        and i.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_recipes_update on public.product_recipes;
create policy product_recipes_update on public.product_recipes
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists product_recipes_delete on public.product_recipes;
create policy product_recipes_delete on public.product_recipes
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- stock_movements ---------------------------------------------------------
-- Append-only: SELECT policy only, no INSERT / UPDATE / DELETE policy.
-- Movement rows are created exclusively by apply_stock_movement() and
-- deduct_stock_for_order() (SECURITY DEFINER, bypasses RLS). A wrong
-- movement is corrected by a new ADJUSTMENT / WASTE movement, never by
-- editing or removing the row.
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- suppliers ---------------------------------------------------------------
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- purchase_orders ---------------------------------------------------------
drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete on public.purchase_orders
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- purchase_order_items ----------------------------------------------------
-- Scoped through the parent purchase order. UPDATE only while the parent
-- order is DRAFT or ORDERED: receiving sets received_quantity while the
-- order is still ORDERED, and a RECEIVED order is final.
drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists purchase_order_items_insert on public.purchase_order_items;
create policy purchase_order_items_insert on public.purchase_order_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists purchase_order_items_update on public.purchase_order_items;
create policy purchase_order_items_update on public.purchase_order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
        and po.status in ('DRAFT', 'ORDERED')
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
        and po.status in ('DRAFT', 'ORDERED')
    )
  );

drop policy if exists purchase_order_items_delete on public.purchase_order_items;
create policy purchase_order_items_delete on public.purchase_order_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.restaurant_id = public.current_restaurant_id()
    )
  );

-- ============================================================================
-- Indexes
-- ============================================================================
create index if not exists idx_inventory_items_restaurant_id
  on public.inventory_items (restaurant_id);

create index if not exists idx_inventory_items_restaurant_name
  on public.inventory_items (restaurant_id, name);

create index if not exists idx_product_recipes_restaurant_id
  on public.product_recipes (restaurant_id);

create index if not exists idx_product_recipes_product_id
  on public.product_recipes (product_id);

create index if not exists idx_product_recipes_item_id
  on public.product_recipes (inventory_item_id);

create index if not exists idx_stock_movements_restaurant_id
  on public.stock_movements (restaurant_id);

create index if not exists idx_stock_movements_restaurant_created
  on public.stock_movements (restaurant_id, created_at desc);

create index if not exists idx_stock_movements_item_id
  on public.stock_movements (inventory_item_id);

create index if not exists idx_stock_movements_item_created
  on public.stock_movements (inventory_item_id, created_at desc);

create index if not exists idx_stock_movements_reference
  on public.stock_movements (reference_type, reference_id);

create index if not exists idx_suppliers_restaurant_id
  on public.suppliers (restaurant_id);

create index if not exists idx_purchase_orders_restaurant_id
  on public.purchase_orders (restaurant_id);

create index if not exists idx_purchase_orders_supplier_id
  on public.purchase_orders (supplier_id);

create index if not exists idx_purchase_orders_restaurant_status
  on public.purchase_orders (restaurant_id, status);

create index if not exists idx_purchase_order_items_order_id
  on public.purchase_order_items (purchase_order_id);

create index if not exists idx_purchase_order_items_item_id
  on public.purchase_order_items (inventory_item_id);
